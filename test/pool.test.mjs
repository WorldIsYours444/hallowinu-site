import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, client, adminClient, clock, cron, S01_START, S01_END, walletPlayer } from './helpers.mjs';
import { split, recordEvent } from '../worker/pool/ledger.js';
import { classify, sourceConfig } from '../worker/pool/solana-adapter.js';

const MID = S01_START + 3 * 86400_000 + 10 * 3600_000;
const CREATOR = 'CreatorWa11etHa11owinu1111111111111111111111';
const SOURCE = 'PumpFeeVau1tHa11owinu11111111111111111111111';
const OTHER = 'RandomSender111111111111111111111111111111111';
const PENV = { CREATOR_WALLET: CREATOR, MAKER_REWARD_SOURCES: SOURCE, SOLANA_RPC_URL: 'https://rpc.test' };
let n = 0;
const sig = () => String(++n).padStart(6, '1').replace(/0/g, 'o') + 'S'.repeat(82);

/* ---------- fake Solana RPC ---------- */
const txs = new Map();         // signature -> getTransaction result (null = not finalized yet)
let rpcCalls = [];
let realFetch;
function tx({ gross = 1_000_000_000, keys = [SOURCE, CREATOR], creatorIdx = 1, err = null, blockTime = Math.floor(MID / 1000) } = {}) {
  const pre = keys.map(() => 5_000_000_000), post = [...pre];
  post[creatorIdx] = pre[creatorIdx] + gross;
  if (creatorIdx !== 0) post[0] = pre[0] - gross;
  return { slot: 123, blockTime, meta: { err, preBalances: pre, postBalances: post }, transaction: { message: { accountKeys: keys } } };
}
function installRpc() {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const body = JSON.parse(init.body);
    rpcCalls.push(body.method);
    assert.equal(body.params[1].commitment, 'finalized', 'only finalized data is used');
    if (body.method === 'getTransaction') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: txs.has(body.params[0]) ? txs.get(body.params[0]) : null }));
    if (body.method === 'getSignaturesForAddress') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: [...txs.keys()].map(s => ({ signature: s, err: txs.get(s)?.meta?.err || null })) }));
    return new Response('{}', { status: 400 });
  };
}

describe('community pool — split math', () => {
  test('80/20 exact integer split, floor to the pool, remainder outside', () => {
    assert.deepEqual(split(1_000_000_000n), { gross: 1_000_000_000n, community: 800_000_000n, remaining: 200_000_000n });
    assert.deepEqual(split(1n), { gross: 1n, community: 0n, remaining: 1n });
    assert.deepEqual(split(7n), { gross: 7n, community: 5n, remaining: 2n });            // 5.6 → 5, never over-credit
    assert.deepEqual(split(123_456_789n), { gross: 123_456_789n, community: 98_765_431n, remaining: 24_691_358n });
    for (const g of [1n, 3n, 9n, 999_999_999n, 9_007_199_254_740_991n]) { const r = split(g); assert.equal(r.community + r.remaining, g); }
    assert.throws(() => split(0)); assert.throws(() => split(-5));
  });
  test('adapter config: inactive until creator wallet + reward sources are set', () => {
    assert.equal(sourceConfig({}).ready, false);
    assert.equal(sourceConfig({ CREATOR_WALLET: CREATOR }).ready, false);
    assert.equal(sourceConfig({ CREATOR_WALLET: CREATOR, MAKER_REWARD_SOURCES: CREATOR }).ready, false, 'wallet cannot be its own source');
    assert.equal(sourceConfig(PENV).ready, true);
  });
  test('classify: only finalized, successful, creator-balance-up txs with a recognized source', () => {
    const cfg = sourceConfig(PENV);
    assert.equal(classify(tx(), cfg).result, 'REWARD');
    assert.equal(classify(tx(), cfg).gross, 1_000_000_000n);
    assert.equal(classify(null, cfg).result, 'PENDING_CONFIRMATION');
    assert.equal(classify(tx({ err: { InstructionError: [0, 'x'] } }), cfg).result, 'FAILED_TX');
    assert.equal(classify(tx({ keys: [OTHER, CREATOR] }), cfg).result, 'NOT_A_REWARD', 'unknown sender is not a maker reward');
    assert.equal(classify(tx({ keys: [SOURCE, OTHER] }), cfg).result, 'NOT_A_REWARD', 'creator wallet not involved');
    assert.equal(classify(tx({ gross: -5 }), cfg).result, 'NOT_A_REWARD', 'outgoing transfer');
    assert.equal(classify(tx({ blockTime: 100 }), { ...cfg, since: 200 }).result, 'NOT_A_REWARD');
  });
});

describe('community pool — ledger + API', () => {
  beforeEach(() => { clock.set(MID); txs.clear(); rpcCalls = []; installRpc(); });
  afterEach(() => { globalThis.fetch = realFetch; });

  test('awaiting state: no fake values without a configured source', async () => {
    const env = makeEnv();
    const p = await client(env).get('/api/pool');
    assert.equal(p.state, 'AWAITING_REWARD_SOURCE'); assert.equal(p.totals, null); assert.equal(p.creatorWallet, null);
    assert.equal((await adminClient(env).post('pool/verify', { signature: sig() })).error, 'AWAITING_REWARD_SOURCE');
    await cron(env);
    assert.equal(rpcCalls.length, 0, 'no RPC calls while not configured');
    assert.equal((await client(env).get('/api/pool')).state, 'AWAITING_REWARD_SOURCE');
    const env2 = makeEnv(PENV);
    assert.equal((await client(env2).get('/api/pool')).state, 'WAITING_FOR_FIRST_REWARD');
  });

  test('valid reward via admin verify → 80% into the open season pool, 20% recorded outside; replay refused', async () => {
    const env = makeEnv(PENV);
    const a = adminClient(env);
    const s = sig(); txs.set(s, tx({ gross: 2_500_000_000 }));
    const r = await a.post('pool/verify', { signature: s });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.event.grossSol, '2.5'); assert.equal(r.event.communitySol, '2'); assert.equal(r.event.remainingSol, '0.5');
    assert.equal(r.event.seasonId, 's01');
    const season = await client(env).get('/api/season');
    assert.equal(season.current.pool.totalSol, '2');
    assert.equal(season.current.pool.makerLamports, '2000000000');
    // replay (same signature) — refused, nothing changes
    assert.equal((await a.post('pool/verify', { signature: s })).error, 'ALREADY_PROCESSED');
    await cron(env);                                   // scanner sees the same signature → skipped
    assert.equal((await client(env).get('/api/season')).current.pool.totalSol, '2');
    const pub = await client(env).get('/api/pool');
    assert.equal(pub.state, 'LIVE');
    assert.equal(pub.totals.receivedSol, '2.5'); assert.equal(pub.totals.communitySol, '2'); assert.equal(pub.totals.outsideSol, '0.5');
    assert.equal(pub.season.poolSol, '2'); assert.equal(pub.recent.length, 1); assert.equal(pub.recent[0].signature, s);
    const rec = await a.get('pool');
    assert.equal(rec.ok, true); assert.deepEqual(rec.issues, []);
    const audit = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'pool.maker_reward'").first();
    assert.equal(audit.n, 1);
  });

  test('invalid / unconfirmed / failed / foreign transactions are never credited', async () => {
    const env = makeEnv(PENV);
    const a = adminClient(env);
    assert.equal((await a.post('pool/verify', { signature: 'not-a-signature' })).error, 'BAD_SIGNATURE');
    const unconfirmed = sig(); txs.set(unconfirmed, null);
    assert.equal((await a.post('pool/verify', { signature: unconfirmed })).error, 'NOT_FINALIZED');
    const failed = sig(); txs.set(failed, tx({ err: { InstructionError: [0, 'Custom'] } }));
    assert.equal((await a.post('pool/verify', { signature: failed })).error, 'TX_FAILED');
    const foreign = sig(); txs.set(foreign, tx({ keys: [OTHER, CREATOR] }));
    assert.equal((await a.post('pool/verify', { signature: foreign })).error, 'NOT_A_MAKER_REWARD');
    const outgoing = sig(); txs.set(outgoing, tx({ gross: -1_000 }));
    assert.equal((await a.post('pool/verify', { signature: outgoing })).error, 'NOT_A_MAKER_REWARD');
    assert.equal((await client(env).get('/api/season')).current.pool.totalLamports, '0');
    assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM maker_reward_events').first()).n, 0);
    // unconfirmed later finalizes → the scanner credits it then
    txs.set(unconfirmed, tx({ gross: 1_000 }));
    clock.advance(11 * 60_000);
    await cron(env);
    assert.equal((await client(env).get('/api/season')).current.pool.totalLamports, '800');
  });

  test('cron scan: multiple events, each credited once, rounding exact', async () => {
    const env = makeEnv(PENV);
    for (const g of [7, 1_000_000_001, 333_333_333]) txs.set(sig(), tx({ gross: g }));
    txs.set(sig(), tx({ keys: [OTHER, CREATOR] }));     // ordinary deposit: ignored
    await cron(env);
    await cron(env); clock.advance(30 * 60_000); await cron(env);
    const ev = (await env.DB.prepare('SELECT gross_base_units g, community_base_units c, remaining_base_units r FROM maker_reward_events ORDER BY gross_base_units').all()).results;
    assert.deepEqual(ev.map(e => [e.g, e.c, e.r]), [[7, 5, 2], [333_333_333, 266_666_666, 66_666_667], [1_000_000_001, 800_000_000, 200_000_001]]);
    const pool = (await client(env).get('/api/season')).current.pool.totalLamports;
    assert.equal(pool, String(5 + 266_666_666 + 800_000_000));
    assert.equal((await adminClient(env).get('pool')).ok, true);
    const counts = Object.fromEntries((await env.DB.prepare('SELECT result, COUNT(*) n FROM maker_reward_scan GROUP BY result').all()).results.map(r => [r.result, r.n]));
    assert.equal(counts.PROCESSED, 3); assert.equal(counts.NOT_A_REWARD, 1);
  });

  test('concurrent processing of the same event credits it exactly once', async () => {
    const env = makeEnv(PENV);
    const s = sig();
    const ev = { source: 'solana_transfer', externalId: s, gross: 1_000_000_000n, receiver: CREATOR };
    const out = await Promise.allSettled([recordEvent(env, ev, 'a'), recordEvent(env, ev, 'b'), recordEvent(env, ev, 'c')]);
    assert.equal(out.filter(o => o.status === 'fulfilled' && o.value.created).length, 1);
    assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM maker_reward_events').first()).n, 1);
    assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM prize_pool_transactions WHERE source = 'MAKER_REWARD'").first()).n, 1);
    assert.equal((await client(env).get('/api/season')).current.pool.totalSol, '0.8');
  });

  test('adjustments: admin-only, reason + confirmation required, labelled, cannot go negative; void reverses', async () => {
    const env = makeEnv(PENV);
    const a = adminClient(env);
    const p = await walletPlayer(env);
    const s = sig(); txs.set(s, tx({ gross: 1_000_000_000 }));
    const ev = (await a.post('pool/verify', { signature: s })).event;
    assert.equal((await p.c.post('/api/admin/pool/adjustments', { seasonId: 's01', amountLamports: '5', reason: 'please give me money', confirm: 'I CONFIRM THIS ADJUSTMENT' })).status, 401);
    assert.equal((await a.post('pool/adjustments', { seasonId: 's01', amountLamports: '5', reason: 'short' , confirm: 'I CONFIRM THIS ADJUSTMENT' })).error, 'REASON_REQUIRED');
    assert.equal((await a.post('pool/adjustments', { seasonId: 's01', amountLamports: '5', reason: 'rounding correction' })).error, 'CONFIRM_REQUIRED');
    assert.equal((await a.post('pool/adjustments', { seasonId: 's01', amountLamports: '1.5', reason: 'rounding correction', confirm: 'I CONFIRM THIS ADJUSTMENT' })).error, 'BAD_AMOUNT');
    assert.equal((await a.post('pool/adjustments', { seasonId: 's01', amountLamports: '-900000000', reason: 'too much removed', confirm: 'I CONFIRM THIS ADJUSTMENT' })).error, 'NEGATIVE_POOL');
    const ok = await a.post('pool/adjustments', { seasonId: 's01', amountLamports: '-100000000', reason: 'duplicate payout correction', confirm: 'I CONFIRM THIS ADJUSTMENT' });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    let season = (await client(env).get('/api/season')).current;
    assert.equal(season.pool.totalSol, '0.7');
    assert.equal(season.pool.makerLamports, '800000000', 'adjustments never count as maker revenue');
    assert.equal(season.pool.adjustmentLamports, '-100000000');
    const pub = await client(env).get('/api/pool');
    assert.equal(pub.totals.communitySol, '0.8', 'public maker totals are untouched by adjustments');
    // void the event: needs a reason; would go negative after the adjustment → refused; after reversing the adjustment it works
    assert.equal((await a.post(`pool/events/${ev.id}/void`, { reason: 'x' })).error, 'REASON_REQUIRED');
    assert.equal((await a.post(`pool/events/${ev.id}/void`, { reason: 'reward clawed back by launchpad' })).error, 'NEGATIVE_POOL');
    await a.post('pool/adjustments', { seasonId: 's01', amountLamports: '100000000', reason: 'undo previous correction', confirm: 'I CONFIRM THIS ADJUSTMENT' });
    assert.equal((await a.post(`pool/events/${ev.id}/void`, { reason: 'reward clawed back by launchpad' })).ok, true);
    assert.equal((await a.post(`pool/events/${ev.id}/void`, { reason: 'reward clawed back by launchpad' })).error, 'ALREADY_VOIDED');
    season = (await client(env).get('/api/season')).current;
    assert.equal(season.pool.totalLamports, '0');
    const audit = (await env.DB.prepare("SELECT action FROM audit_log WHERE action LIKE 'pool.%' AND actor != 'migration' ORDER BY id").all()).results.map(r => r.action);
    assert.deepEqual(audit, ['pool.maker_reward', 'pool.adjust', 'pool.adjust', 'pool.void']);
    assert.equal((await a.get('pool')).ok, true);
  });

  test('reward received while no season is open is held, then assigned once to the next season', async () => {
    const env = makeEnv(PENV);
    clock.set(S01_END + 1000); await cron(env);          // s01 freezes
    const s = sig(); txs.set(s, tx({ gross: 500_000_000 }));
    const r = await adminClient(env).post('pool/verify', { signature: s });
    assert.equal(r.event.seasonId, null);
    assert.equal((await adminClient(env).get('pool')).totals.unassigned, '400000000');
    const st = S01_END + 7 * 86400_000;
    const c = await adminClient(env).post('seasons', { id: 's02', name: 'SEASON 02', startsAt: st, endsAt: st + 14 * 86400_000 });
    assert.equal(c.ok, true, JSON.stringify(c));
    await cron(env); await cron(env);
    const rows = (await env.DB.prepare("SELECT season_id, amount_lamports FROM prize_pool_transactions WHERE source = 'MAKER_REWARD'").all()).results;
    assert.deepEqual(rows, [{ season_id: 's02', amount_lamports: 400_000_000 }]);
    const s1 = await env.DB.prepare("SELECT frozen_pool_lamports FROM seasons WHERE id = 's01'").first();
    assert.equal(s1.frozen_pool_lamports, 0, 'frozen season untouched');
    assert.equal((await adminClient(env).get('pool')).ok, true);
  });
});
