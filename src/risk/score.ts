// sdk/src/risk/score.ts  (Feature #8 — normalized risk score + named-state ladder)
//
// Phoenix surfaces a single normalized health number + a named position-state
// ladder so a trader sees HOW CLOSE they are to liquidation, not just a binary.
// Parquet already computes the underlying health scalar (`healthMilli`) in four
// byte-exact mirrors (on-chain calc_health, keeper calcOffchainHealth, frontend
// computeHealth, mobile tradeMath) but never normalizes it and never names the
// rungs. This module is the SINGLE shared definition the indexer, SDK consumers,
// and (transitively) the web/mobile bars import.
//
// It depends ONLY on `healthMilli` (a bigint) + the breakpoints — NOT on any
// chain-account decode surface — so it carries zero layout coupling. The score
// is DEFINED FROM healthMilli (the inverse-normalized value), never re-derived,
// so it cannot drift from the keeper's liquidation truth.
//
// See docs/specs/2026-06-24-risk-score-named-states-design.md §4.1–4.3.

/** The 4-rung named ladder, in DANGER order (index 0 = safest, 3 = worst). */
export const RISK_STATES = [
  "Safe",
  "AtRisk",
  "NearLiquidation",
  "Liquidatable",
] as const;
export type RiskState = (typeof RISK_STATES)[number];

/**
 * The immutable on-chain liquidation line. `calc_health` reverts
 * `PositionHealthy` when `healthMilli >= 1000`, i.e. a position is liquidatable
 * iff `healthMilli < 1000`. This boundary is fixed by the program and is NOT a
 * tunable breakpoint — pinning the "Liquidatable" rung to it (not to a score
 * threshold) is what guarantees the named state can never disagree with the
 * keeper about liquidatable-vs-not.
 */
export const LIQ_LINE_MILLI = 1000n;

/** Default Safe floor — healthMilli >= this ⇒ comfortable buffer. */
export const DEFAULT_SAFE_FLOOR_MILLI = 2000n;

/**
 * Default NearLiquidation floor (derived from the venue's default
 * `LIQ_WARN_DISTANCE_BPS=500` push-relay warn band — see nearMilliFromWarnBand).
 * Calibrated to ≈1250 milli (health within +25% of the line) as the Phase-0
 * default; operator-tunable in-band via the API breakpoints payload.
 */
export const DEFAULT_NEAR_MILLI = 1250n;

/** The venue-default push-relay warn band (config LIQ_WARN_DISTANCE_BPS). */
export const DEFAULT_LIQ_WARN_DISTANCE_BPS = 500;

/**
 * milli of health per bp of warn band — the Phase-0 calibration slope. At the
 * default 500 bps band this yields nearMilli = 1000 + 500*0.5 = 1250, matching
 * DEFAULT_NEAR_MILLI. The exact slope is confirmed in the Phase-0 soak (open
 * question #1); larger warn band ⇒ proportionally higher nearMilli (monotone).
 */
const NEAR_MILLI_PER_WARN_BP = 0.5;

export interface RiskBreakpoints {
  /** healthMilli >= this ⇒ Safe. */
  safeFloorMilli: bigint; // default 2000n
  /** healthMilli >= this ⇒ not yet NearLiquidation (derived from LIQ_WARN band). */
  nearMilli: bigint; // default 1250n
  /** the on-chain liq line; immutable (1000n). */
  liqLineMilli: bigint;
}

/**
 * Inverse-normalized `healthMilli` → [0,1000]. Monotone DECREASING with
 * `calc_health` (the danger end is the HIGH end, matching Phoenix's mm/collateral
 * ratio and the "fill the bar as you approach liq" UX).
 *
 *   score = clamp( 1_000_000 / healthMilli , 0, 1000 )
 *
 * Edge cases mirror the chain:
 *   - healthMilli <= 0 (zero/negative equity) ⇒ 1000 (max danger)
 *   - healthMilli == 1000 (the liq line)      ⇒ 1000
 *   - healthMilli == HEALTHY_MAX (size 0)     ⇒ 0  (safest)
 *
 * Integer-only on the canonical value (the UI may render a float %); computed in
 * bigint then narrowed to a JS number in [0,1000] (always safe-integer range).
 */
export function riskScoreFromHealthMilli(healthMilli: bigint): number {
  if (healthMilli <= 0n) return 1000;
  const s = 1_000_000n / healthMilli;
  return Number(s > 1000n ? 1000n : s);
}

/**
 * Derive the NearLiquidation health threshold from the push-relay warn band, so
 * "NearLiquidation" in the bar and a push-relay warn fire on the SAME boundary.
 * Operators tune ONE knob (LIQ_WARN_DISTANCE_BPS) and both surfaces move together.
 *
 * Linear (Phase-0-calibrated) approximation: health ≈ linear in the
 * price-distance-to-liq near the line, so a wider price band maps to a wider
 * health band. Clamped at the immutable liq line so it can never invert.
 */
export function nearMilliFromWarnBand(warnDistanceBps: number): bigint {
  const band = Math.max(0, Math.round(warnDistanceBps * NEAR_MILLI_PER_WARN_BP));
  const near = LIQ_LINE_MILLI + BigInt(band);
  return near < LIQ_LINE_MILLI ? LIQ_LINE_MILLI : near;
}

/**
 * Classify a position into the 4-rung ladder. **Liquidatable is pinned to the
 * chain** (`healthMilli < liqLineMilli`), NOT to a score threshold — so the named
 * state can never disagree with the keeper about liquidatable-vs-not. The other
 * rungs key off the in-band breakpoints (returned in the API payload so the
 * static-export frontend stays in sync).
 */
export function riskStateFromHealthMilli(
  healthMilli: bigint,
  bp: RiskBreakpoints,
): RiskState {
  if (healthMilli < bp.liqLineMilli) return "Liquidatable"; // chain truth
  if (healthMilli < bp.nearMilli) return "NearLiquidation";
  if (healthMilli < bp.safeFloorMilli) return "AtRisk";
  return "Safe";
}

/**
 * The default breakpoint set. `safeFloorMilli` defaults to 2000; `nearMilli` is
 * derived from the warn band (default 500 bps ⇒ 1250); `liqLineMilli` is fixed.
 * The indexer overrides safeFloor/warn-band from env and returns the resolved
 * set in-band; this is the canonical fallback every consumer agrees on.
 */
export function defaultBreakpoints(opts?: {
  safeFloorMilli?: bigint;
  warnDistanceBps?: number;
}): RiskBreakpoints {
  const warnBps = opts?.warnDistanceBps ?? DEFAULT_LIQ_WARN_DISTANCE_BPS;
  return {
    safeFloorMilli: opts?.safeFloorMilli ?? DEFAULT_SAFE_FLOOR_MILLI,
    nearMilli: nearMilliFromWarnBand(warnBps),
    liqLineMilli: LIQ_LINE_MILLI,
  };
}
