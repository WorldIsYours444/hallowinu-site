/* Reward-source adapter: 'solana_transfer'.
   Detects maker/creator rewards that were ACTUALLY RECEIVED by the public creator wallet, on-chain, finalized.
   Read-only JSON-RPC (getSignaturesForAddress / getTransaction). No keys, no signing, no transfers.

   A transaction counts as a maker reward only when ALL of these hold:
     1. it exists at 'finalized' commitment and did not fail (meta.err == null)
     2. the creator wallet (env CREATOR_WALLET) is part of the transaction
     3. at least one recognized reward-source account (env MAKER_REWARD_SOURCES, comma separated:
        e.g. the launchpad's fee program / creator-fee vault) is part of the transaction
     4. the creator wallet's SOL balance went UP (post - pre > 0). That net delta is the gross reward
        (network fees already subtracted → only what was really received).
   Estimated, unclaimed or pending fees are never seen here: they are not on-chain balance changes. */
import { CONFIG } from '../config.js';
import { isValidAddress, isValidSignature } from '../lib/solana.js';

export const SOURCE_ID = 'solana_transfer';
const C = CONFIG.communityPool;

export function sourceConfig(env) {
  const wallet = String(env.CREATOR_WALLET || '').trim();
  const sources = String(env.MAKER_REWARD_SOURCES || '').split(',').map(s => s.trim()).filter(Boolean);
  const since = Number(env.MAKER_REWARD_SINCE) || 0;      // optional unix seconds: ignore older transactions
  const walletOk = isValidAddress(wallet);
  const sourcesOk = sources.length > 0 && sources.every(isValidAddress) && !sources.includes(wallet);
  return { ready: walletOk && sourcesOk, wallet: walletOk ? wallet : null, sources: sourcesOk ? sources : [], since,
    problems: [!walletOk && 'CREATOR_WALLET missing/invalid', !sourcesOk && 'MAKER_REWARD_SOURCES missing/invalid'].filter(Boolean) };
}

function keysOf(tx) {
  return [
    ...(tx.transaction?.message?.accountKeys || []).map(k => (typeof k === 'string' ? k : k.pubkey)),
    ...(tx.meta?.loadedAddresses?.writable || []), ...(tx.meta?.loadedAddresses?.readonly || []),
  ];
}

/* Pure classification of one getTransaction result. */
export function classify(tx, cfg) {
  if (!tx) return { result: 'PENDING_CONFIRMATION', detail: 'not found at finalized commitment (yet)' };
  if (!tx.meta) return { result: 'ERROR', detail: 'transaction has no meta' };
  if (tx.meta.err) return { result: 'FAILED_TX', detail: 'transaction failed on-chain' };
  if (cfg.since && tx.blockTime && tx.blockTime < cfg.since) return { result: 'NOT_A_REWARD', detail: 'before MAKER_REWARD_SINCE' };
  const keys = keysOf(tx);
  const idx = keys.indexOf(cfg.wallet);
  if (idx < 0) return { result: 'NOT_A_REWARD', detail: 'creator wallet not in transaction' };
  const hint = cfg.sources.find(s => keys.includes(s));
  if (!hint) return { result: 'NOT_A_REWARD', detail: 'no recognized reward source in transaction' };
  const pre = tx.meta.preBalances?.[idx], post = tx.meta.postBalances?.[idx];
  if (pre == null || post == null) return { result: 'ERROR', detail: 'balances missing' };
  const gross = BigInt(post) - BigInt(pre);
  if (gross <= 0n) return { result: 'NOT_A_REWARD', detail: 'creator wallet balance did not increase' };
  return { result: 'REWARD', gross, payerHint: hint, blockTime: tx.blockTime ?? null, slot: tx.slot ?? null };
}

async function rpc(env, method, params, fetchImpl = fetch) {
  const url = env.SOLANA_RPC_URL || CONFIG.solana.defaultRpcUrl;
  let res;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  } catch { const e = new Error('RPC_NETWORK'); e.transient = true; throw e; }
  if (!res.ok) { const e = new Error(`RPC_${res.status}`); e.transient = true; throw e; }
  const body = await res.json().catch(() => null);
  if (!body || body.error) { const e = new Error(`RPC_ERROR ${body?.error?.message || ''}`.trim()); e.transient = true; throw e; }
  return body.result;
}

export async function getTransaction(env, signature, fetchImpl) {
  if (!isValidSignature(signature)) throw Object.assign(new Error('BAD_SIGNATURE'), { code: 'BAD_SIGNATURE' });
  return rpc(env, 'getTransaction', [signature, { encoding: 'json', commitment: C.commitment, maxSupportedTransactionVersion: 0 }], fetchImpl);
}

export async function recentSignatures(env, wallet, fetchImpl) {
  return (await rpc(env, 'getSignaturesForAddress', [wallet, { limit: C.scan.limit, commitment: C.commitment }], fetchImpl)) || [];
}
