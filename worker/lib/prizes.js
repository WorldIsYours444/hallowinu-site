/* Prize math — integer lamports only (BigInt). Never floats for authoritative SOL. */
import { CONFIG } from '../config.js';

export const LAMPORTS_PER_SOL = CONFIG.solana.lamportsPerSol; // 1_000_000_000n

export function toLamports(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('unsafe lamport number');
    return BigInt(value);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new Error('invalid lamports');
}

/* Parse a decimal SOL string ("12.4", "0.000000001") into lamports exactly. */
export function solStringToLamports(s) {
  if (typeof s === 'number') s = String(s);
  if (typeof s !== 'string' || !/^\d+(\.\d{1,9})?$/.test(s.trim())) throw new Error('invalid SOL amount (max 9 decimals)');
  const [whole, frac = ''] = s.trim().split('.');
  return BigInt(whole) * LAMPORTS_PER_SOL + BigInt((frac + '000000000').slice(0, 9));
}

/* Exact decimal string, e.g. 12400000000n -> "12.4" */
export function lamportsToSolString(l, minDecimals = 0) {
  l = toLamports(l);
  const neg = l < 0n; if (neg) l = -l;
  const whole = l / LAMPORTS_PER_SOL, frac = (l % LAMPORTS_PER_SOL).toString().padStart(9, '0');
  let f = frac.replace(/0+$/, ''); while (f.length < minDecimals) f += '0';
  return (neg ? '-' : '') + whole.toString() + (f ? '.' + f : '');
}

export function validateDistribution(bps) {
  if (!Array.isArray(bps) || bps.length === 0 || bps.length > 100) throw new Error('distribution must be a non-empty array');
  for (const b of bps) if (!Number.isInteger(b) || b < 0) throw new Error('distribution entries must be non-negative integers');
  if (bps.reduce((a, b) => a + b, 0) !== 10000) throw new Error('distribution must sum to 10000 bps (100%)');
  return true;
}

/* Allocate a pool across ranks.
   - Each filled rank gets floor(pool * bps / 10000).
   - Rounding dust from filled ranks goes to rank #1 (deterministic).
   - If all ranks are filled, allocations sum to EXACTLY the pool.
   - If fewer winners than ranks exist, the unfilled shares are returned as `unallocated`
     (rolls over; never silently assigned).                                              */
export function allocatePool(poolLamports, bps, filled = bps.length) {
  validateDistribution(bps);
  const pool = toLamports(poolLamports);
  if (pool < 0n) throw new Error('pool cannot be negative');
  const n = Math.max(0, Math.min(filled, bps.length));
  const amounts = [];
  let filledBps = 0;
  for (let i = 0; i < n; i++) { amounts.push(pool * BigInt(bps[i]) / 10000n); filledBps += bps[i]; }
  const filledTotal = n === bps.length ? pool : pool * BigInt(filledBps) / 10000n;
  const sum = amounts.reduce((a, b) => a + b, 0n);
  if (n > 0) amounts[0] += filledTotal - sum;
  return { amounts, allocated: filledTotal, unallocated: pool - filledTotal };
}
