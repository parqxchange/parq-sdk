// sdk/src/risk/score.test.ts (Feature #8)
//
// Strict TDD: written BEFORE src/risk/score.ts — must fail first.
//
// The normalized 0–1000 risk score is the INVERSE of the existing byte-exact
// healthMilli (programs/perp-engine/src/math.rs::calc_health mirror). This net
// pins the load-bearing invariants from the spec §8.2:
//   - monotonicity: healthMilli ↑ ⇒ riskScore ↓
//   - boundary pins: healthMilli==1000 ⇒ score==1000 && state==Liquidatable;
//     healthMilli<1000 ⇒ Liquidatable; HEALTHY_MAX ⇒ score==0, state==Safe
//   - the named-state ladder (Safe/AtRisk/NearLiquidation/Liquidatable)
//   - nearMilli derivation tracks LIQ_WARN_DISTANCE_BPS (monotone)

import {
  RISK_STATES,
  type RiskState,
  type RiskBreakpoints,
  riskScoreFromHealthMilli,
  riskStateFromHealthMilli,
  nearMilliFromWarnBand,
  defaultBreakpoints,
  DEFAULT_SAFE_FLOOR_MILLI,
  DEFAULT_NEAR_MILLI,
  LIQ_LINE_MILLI,
} from "../score";

// u64::MAX sentinel — calc_health returns this when size==0 (no requirement).
const HEALTHY_MAX = (1n << 64n) - 1n;

describe("riskScoreFromHealthMilli", () => {
  it("is 1000 (max danger) at the liquidation line (healthMilli==1000)", () => {
    expect(riskScoreFromHealthMilli(1000n)).toBe(1000);
  });

  it("clamps to 1000 below the liq line and at zero / negative equity", () => {
    expect(riskScoreFromHealthMilli(999n)).toBe(1000);
    expect(riskScoreFromHealthMilli(1n)).toBe(1000);
    expect(riskScoreFromHealthMilli(0n)).toBe(1000);
    expect(riskScoreFromHealthMilli(-5n)).toBe(1000);
  });

  it("is 0 (safest) at the size-0 sentinel (HEALTHY_MAX)", () => {
    expect(riskScoreFromHealthMilli(HEALTHY_MAX)).toBe(0);
  });

  it("is the inverse-normalized healthMilli for healthy positions", () => {
    // 1_000_000 / healthMilli, floored (integer division toward zero).
    expect(riskScoreFromHealthMilli(2000n)).toBe(500); // 1e6/2000
    expect(riskScoreFromHealthMilli(2500n)).toBe(400); // 1e6/2500
    expect(riskScoreFromHealthMilli(10_000n)).toBe(100); // 1e6/10000
    expect(riskScoreFromHealthMilli(1_000_000n)).toBe(1); // 1e6/1e6
    expect(riskScoreFromHealthMilli(2_000_000n)).toBe(0); // floors to 0
  });

  it("is monotone DECREASING in healthMilli", () => {
    let prev = riskScoreFromHealthMilli(1000n);
    for (let h = 1100n; h <= 200_000n; h += 1100n) {
      const cur = riskScoreFromHealthMilli(h);
      expect(cur).toBeLessThanOrEqual(prev);
      prev = cur;
    }
  });

  it("never escapes [0,1000]", () => {
    for (const h of [0n, 1n, 1000n, 1234n, 13_500n, 1_000_000n, HEALTHY_MAX]) {
      const s = riskScoreFromHealthMilli(h);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1000);
    }
  });
});

describe("nearMilliFromWarnBand", () => {
  it("returns the calibrated default (1250) for the venue's 500 bps warn band", () => {
    expect(nearMilliFromWarnBand(500)).toBe(DEFAULT_NEAR_MILLI);
    expect(DEFAULT_NEAR_MILLI).toBe(1250n);
  });

  it("tracks LIQ_WARN_DISTANCE_BPS — a wider band ⇒ a higher nearMilli (monotone)", () => {
    const a = nearMilliFromWarnBand(250);
    const b = nearMilliFromWarnBand(500);
    const c = nearMilliFromWarnBand(1000);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  it("never drops below the immutable liq line (1000)", () => {
    expect(nearMilliFromWarnBand(0)).toBeGreaterThanOrEqual(LIQ_LINE_MILLI);
    expect(nearMilliFromWarnBand(-100)).toBeGreaterThanOrEqual(LIQ_LINE_MILLI);
  });
});

describe("defaultBreakpoints", () => {
  it("pins liqLineMilli to the immutable on-chain line (1000)", () => {
    expect(defaultBreakpoints().liqLineMilli).toBe(1000n);
    expect(LIQ_LINE_MILLI).toBe(1000n);
  });

  it("uses the documented defaults (safeFloor 2000, near 1250)", () => {
    const bp = defaultBreakpoints();
    expect(bp.safeFloorMilli).toBe(DEFAULT_SAFE_FLOOR_MILLI);
    expect(bp.safeFloorMilli).toBe(2000n);
    expect(bp.nearMilli).toBe(1250n);
  });

  it("derives nearMilli from a supplied warn band", () => {
    const bp = defaultBreakpoints({ warnDistanceBps: 1000 });
    expect(bp.nearMilli).toBe(nearMilliFromWarnBand(1000));
  });
});

describe("riskStateFromHealthMilli — the 4-rung ladder", () => {
  const bp: RiskBreakpoints = defaultBreakpoints(); // safe=2000, near=1250, liq=1000

  it("Liquidatable ⇔ healthMilli < 1000 (chain truth, NOT a score cut)", () => {
    expect(riskStateFromHealthMilli(0n, bp)).toBe<RiskState>("Liquidatable");
    expect(riskStateFromHealthMilli(999n, bp)).toBe<RiskState>("Liquidatable");
  });

  it("exactly at the liq line (1000) is the worst NON-liquidatable rung (NearLiquidation)", () => {
    // healthMilli==1000 is NOT < liqLine, so it is NearLiquidation, not Liquidatable.
    expect(riskStateFromHealthMilli(1000n, bp)).toBe<RiskState>("NearLiquidation");
  });

  it("NearLiquidation ⇔ 1000 <= healthMilli < nearMilli", () => {
    expect(riskStateFromHealthMilli(1000n, bp)).toBe<RiskState>("NearLiquidation");
    expect(riskStateFromHealthMilli(1249n, bp)).toBe<RiskState>("NearLiquidation");
  });

  it("AtRisk ⇔ nearMilli <= healthMilli < safeFloorMilli", () => {
    expect(riskStateFromHealthMilli(1250n, bp)).toBe<RiskState>("AtRisk");
    expect(riskStateFromHealthMilli(1999n, bp)).toBe<RiskState>("AtRisk");
  });

  it("Safe ⇔ healthMilli >= safeFloorMilli", () => {
    expect(riskStateFromHealthMilli(2000n, bp)).toBe<RiskState>("Safe");
    expect(riskStateFromHealthMilli(50_000n, bp)).toBe<RiskState>("Safe");
    expect(riskStateFromHealthMilli(HEALTHY_MAX, bp)).toBe<RiskState>("Safe");
  });

  it("the ladder is monotone in healthMilli (worse state at lower health)", () => {
    const order = (s: RiskState) => RISK_STATES.indexOf(s);
    // RISK_STATES = [Safe, AtRisk, NearLiquidation, Liquidatable] — higher index = worse.
    let prevIdx = order(riskStateFromHealthMilli(HEALTHY_MAX, bp));
    for (const h of [100_000n, 2001n, 2000n, 1500n, 1250n, 1100n, 1000n, 999n, 0n]) {
      const idx = order(riskStateFromHealthMilli(h, bp));
      expect(idx).toBeGreaterThanOrEqual(prevIdx);
      prevIdx = idx;
    }
  });

  it("score==1000 implies the named state is at least NearLiquidation", () => {
    // The single most important property: a UI "Safe" can never appear while
    // score is pegged (healthMilli at or below the liq line).
    for (const h of [1000n, 999n, 500n, 0n]) {
      expect(riskScoreFromHealthMilli(h)).toBe(1000);
      const st = riskStateFromHealthMilli(h, bp);
      expect(["NearLiquidation", "Liquidatable"]).toContain(st);
    }
  });
});

describe("RISK_STATES", () => {
  it("is the documented 4-rung ladder in danger order", () => {
    expect(RISK_STATES).toEqual([
      "Safe",
      "AtRisk",
      "NearLiquidation",
      "Liquidatable",
    ]);
  });
});
