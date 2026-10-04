/* On-chain verification of prize-pool funding (read-only JSON-RPC, no keys involved). */
import { CONFIG } from '../config.js';
import { ApiError } from './util.js';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
export function isValidSignature(sig) { return typeof sig === 'string' && sig.length >= 64 && sig.length <= 100 && BASE58.test(sig); }
export function isValidAddress(a) { return typeof a === 'string' && a.length >= 32 && a.length <= 44 && BASE58.test(a); }

/* Returns the lamports the pool wallet received in this transaction.
   Checks: tx exists, finalized, succeeded, pool wallet present, positive balance delta. */
export async function verifyTransferToPool(env, signature, fetchImpl = fetch) {
  const wallet = env.POOL_WALLET;
  if (!wallet || !isValidAddress(wallet)) throw new ApiError(503, 'POOL_WALLET_NOT_SET', 'POOL_WALLET is not configured; use manual verification.');
  if (!isValidSignature(signature)) throw new ApiError(400, 'BAD_SIGNATURE', 'Invalid transaction signature.');
  const rpc = env.SOLANA_RPC_URL || CONFIG.solana.defaultRpcUrl;
  const res = await fetchImpl(rpc, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature, { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0 }] }),
  });
  if (!res.ok) throw new ApiError(502, 'RPC_ERROR', `Solana RPC returned ${res.status}.`);
  const data = await res.json();
  const tx = data.result;
  if (!tx) throw new ApiError(404, 'TX_NOT_FOUND', 'Transaction not found or not finalized yet.');
  if (tx.meta?.err) throw new ApiError(409, 'TX_FAILED', 'Transaction failed on-chain.');
  const keys = [
    ...(tx.transaction?.message?.accountKeys || []).map(k => (typeof k === 'string' ? k : k.pubkey)),
    ...(tx.meta?.loadedAddresses?.writable || []), ...(tx.meta?.loadedAddresses?.readonly || []),
  ];
  const idx = keys.indexOf(wallet);
  if (idx < 0) throw new ApiError(409, 'WALLET_NOT_IN_TX', 'The pool wallet is not part of this transaction.');
  const pre = BigInt(tx.meta.preBalances[idx]), post = BigInt(tx.meta.postBalances[idx]);
  const delta = post - pre;
  if (delta <= 0n) throw new ApiError(409, 'NO_DEPOSIT', 'The pool wallet did not receive SOL in this transaction.');
  return { lamports: delta, slot: tx.slot, blockTime: tx.blockTime };
}
