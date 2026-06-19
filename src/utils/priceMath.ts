/**
 * Client-side PnL calculation — exact parity with on-chain `calc_pnl`
 * (programs/perp-engine/src/math.rs:12-28). All values use the same units as
 * on-chain (USDC 6-decimal, price 1e9). Losses round more-negative
 * (protocol-favorable); gains truncate toward zero.
 *
 * @throws if `entry === 0n` (would otherwise divide by zero / `Infinity`).
 * @param side - position side ("long" or "short")
 * @param entry - entry price at 1e9 scale
 * @param exit - exit price at 1e9 scale
 * @param size - position size in USDC 6-decimal units
 * @returns PnL in USDC 6-decimal units (negative for loss)
 */
export function calcPnl(
  side: "long" | "short",
  entry: bigint,
  exit: bigint,
  size: bigint,
): bigint {
  if (entry === 0n) {
    throw new Error("calcPnl: entry price must be non-zero");
  }
  const diff = side === "long" ? exit - entry : entry - exit;
  const num = diff * size;
  // Losses round more-negative (protocol-favorable); gains truncate toward zero.
  return diff < 0n ? (num - (entry - 1n)) / entry : num / entry;
}

/**
 * Client-side fee calculation — mirrors on-chain calc_fee.
 * feeBps: units of 0.001% (10 = 0.01%). discountPct: 0–100.
 * @param size - position size in USDC 6-decimal units
 * @param feeBps - fee in basis points (0.001% increments, e.g. 10 = 0.01%)
 * @param discountPct - discount percentage (0–100)
 * @returns fee in USDC 6-decimal units
 */
export function calcFee(size: bigint, feeBps: number, discountPct: number): bigint {
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 65_535) {
    throw new Error("calcFee: feeBps must be an integer in u16 range (0–65535)");
  }
  if (!Number.isInteger(discountPct) || discountPct < 0 || discountPct > 100) {
    throw new Error("calcFee: discountPct must be an integer in 0–100");
  }
  // Math.max mirrors on-chain saturating_sub (math.rs:38) — never goes negative.
  const numerator = size * BigInt(feeBps) * BigInt(Math.max(0, 100 - discountPct));
  // Matches on-chain: fee_bps is in 0.001% units. Divisor = 100 * 100_000 = 10_000_000.
  // See programs/perp-engine/src/math.rs:calc_fee
  return numerator / 10_000_000n;
}

/**
 * Format a USDC 6-decimal amount as a human-readable string (e.g. "1.000000").
 * @param amount - amount in USDC 6-decimal units
 * @returns formatted string with 6 decimal places
 */
export function formatUsdcAmount(amount: bigint): string {
  const abs = amount < 0n ? -amount : amount;
  const sign = amount < 0n ? "-" : "";
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0");
  return `${sign}${whole}.${frac}`;
}

/**
 * Format a 1e9-scaled price as a human-readable string (e.g. "100.000000000").
 * @param price - price at 1e9 scale
 * @returns formatted string with 9 decimal places
 */
export function formatPrice(price: bigint): string {
  const whole = price / 1_000_000_000n;
  const frac = (price % 1_000_000_000n).toString().padStart(9, "0");
  return `${whole}.${frac}`;
}

/**
 * Health factor × 1000. Values below 1000 are liquidatable.
 *
 * @throws if `mmrBps <= 0`. On-chain `calc_health` takes mmr_bps as a u16 and
 *   cannot receive a non-positive value, so this guard is SDK-side input
 *   validation with no on-chain analogue (math.rs:44 has no such check).
 * @param collateral - collateral amount in USDC 6-decimal units
 * @param size - position size in USDC 6-decimal units
 * @param mmrBps - maintenance margin ratio in basis points
 * @returns health factor × 1000 (values below 1000 are liquidatable)
 */
export function calcHealth(
  collateral: bigint,
  size: bigint,
  mmrBps: number,
): bigint {
  if (mmrBps <= 0) {
    throw new Error("calcHealth: mmrBps must be positive");
  }
  const threshold = (size * BigInt(mmrBps)) / 10_000n;
  // Parity with math.rs:48-49 — returns u64::MAX when threshold rounds to zero.
  if (threshold === 0n) return (1n << 64n) - 1n;
  return (collateral * 1_000n) / threshold;
}
