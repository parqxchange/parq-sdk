import { calcFee, calcHealth, calcPnl, formatPrice, formatUsdcAmount } from "../src/utils/priceMath";

describe("calcPnl", () => {
  it("throws on zero entry price", () => {
    expect(() => calcPnl("long", 0n, 100n, 1_000_000n)).toThrow(/entry price must be non-zero/);
  });

  it("computes long pnl", () => {
    const pnl = calcPnl("long", 100n * 1_000_000_000n, 110n * 1_000_000_000n, 1_000_000n);
    expect(pnl).toBe(100_000n);
  });

  it("rounds losses protocol-favorable (parity with math.rs pnl_loss_rounds_protocol_favorable)", () => {
    // Long, entry=100e9, exit=99e9, size=1_000_001 → more negative than truncation (-10000)
    const pnl = calcPnl("long", 100_000_000_000n, 99_000_000_000n, 1_000_001n);
    expect(pnl).toBe(-10_001n);
    expect(pnl).toBeLessThan(-10_000n);
  });

  it("truncates gains toward zero", () => {
    // Long, entry=100e9, exit=101e9, size=1_000_001 → +10000 (truncated, not -rounded)
    const pnl = calcPnl("long", 100_000_000_000n, 101_000_000_000n, 1_000_001n);
    expect(pnl).toBe(10_000n);
  });
});

describe("calcHealth", () => {
  it("throws on non-positive mmrBps", () => {
    expect(() => calcHealth(1_000_000n, 1_000_000n, 0)).toThrow(/mmrBps must be positive/);
    expect(() => calcHealth(1_000_000n, 1_000_000n, -1)).toThrow(/mmrBps must be positive/);
  });

  it("returns ratio ×1000 for valid inputs", () => {
    const h = calcHealth(10_000_000n, 1_000_000n, 40);
    expect(h).toBe(2_500_000n);
  });

  it("returns u64::MAX sentinel when threshold rounds to zero (parity with math.rs)", () => {
    expect(calcHealth(1_000_000n, 0n, 40)).toBe((1n << 64n) - 1n);
  });
});

describe("formatters", () => {
  it("formatUsdcAmount handles sign", () => {
    expect(formatUsdcAmount(-1_500_000n)).toBe("-1.500000");
  });

  it("formatPrice pads fractional scale", () => {
    expect(formatPrice(1n)).toMatch(/^0\.000000001$/);
  });
});

describe("calcFee", () => {
  it("matches documented divisor path", () => {
    const fee = calcFee(1_000_000n, 100, 0);
    expect(fee).toBe(1_000n);
  });

  it("clamps discountPct > 100 to a zero multiplier (saturating_sub parity)", () => {
    expect(calcFee(1_000_000n, 100, 100)).toBe(0n);
  });

  it("rejects out-of-range feeBps (u16)", () => {
    expect(() => calcFee(1_000_000n, -1, 0)).toThrow(/feeBps/);
    expect(() => calcFee(1_000_000n, 65_536, 0)).toThrow(/feeBps/);
    expect(() => calcFee(1_000_000n, 1.5, 0)).toThrow(/feeBps/);
  });

  it("rejects out-of-range discountPct (0-100)", () => {
    expect(() => calcFee(1_000_000n, 100, -1)).toThrow(/discountPct/);
    expect(() => calcFee(1_000_000n, 100, 101)).toThrow(/discountPct/);
    expect(() => calcFee(1_000_000n, 100, 50.5)).toThrow(/discountPct/);
  });
});
