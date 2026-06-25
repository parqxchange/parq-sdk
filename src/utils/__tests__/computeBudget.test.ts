// Jest globals: describe/test/expect available via ts-jest preset.
import { SUGGESTED_CU, withComputeBudget } from "../computeBudget";

describe("SUGGESTED_CU", () => {
  test("exports a SUGGESTED_CU object with all expected per-family keys", () => {
    expect(SUGGESTED_CU).toBeDefined();
    expect(typeof SUGGESTED_CU).toBe("object");
  });

  test("open = 150_000", () => {
    expect(SUGGESTED_CU.open).toBe(150_000);
  });

  test("close = 150_000", () => {
    expect(SUGGESTED_CU.close).toBe(150_000);
  });

  test("margin = 100_000", () => {
    expect(SUGGESTED_CU.margin).toBe(100_000);
  });

  test("cancel = 40_000", () => {
    expect(SUGGESTED_CU.cancel).toBe(40_000);
  });

  test("limit = 60_000", () => {
    expect(SUGGESTED_CU.limit).toBe(60_000);
  });

  test("tpsl = 300_000", () => {
    expect(SUGGESTED_CU.tpsl).toBe(300_000);
  });

  test("all families except tpsl are <= 200_000 (tpsl is the only outlier)", () => {
    expect(SUGGESTED_CU.open).toBeLessThanOrEqual(200_000);
    expect(SUGGESTED_CU.close).toBeLessThanOrEqual(200_000);
    expect(SUGGESTED_CU.margin).toBeLessThanOrEqual(200_000);
    expect(SUGGESTED_CU.cancel).toBeLessThanOrEqual(200_000);
    expect(SUGGESTED_CU.limit).toBeLessThanOrEqual(200_000);
    // tpsl intentionally exceeds 200k (atomic sequence)
    expect(SUGGESTED_CU.tpsl).toBeGreaterThan(200_000);
  });
});

describe("withComputeBudget", () => {
  test("withComputeBudget default units is still 400_000 (not lowered)", () => {
    // Verify the existing default is preserved — SUGGESTED_CU does NOT replace it.
    const ixs = withComputeBudget([]);
    // First ix is setComputeUnitLimit; decode its data to read the units field.
    expect(ixs.length).toBeGreaterThanOrEqual(1);
    // The setComputeUnitLimit instruction encodes units as a little-endian u32 at bytes [1..5].
    const unitBytes = ixs[0].data.slice(1, 5);
    const view = new DataView(unitBytes.buffer, unitBytes.byteOffset, 4);
    expect(view.getUint32(0, true /* LE */)).toBe(400_000);
  });

  test("withComputeBudget respects an explicit units override", () => {
    const ixs = withComputeBudget([], { units: SUGGESTED_CU.open });
    const unitBytes = ixs[0].data.slice(1, 5);
    const view = new DataView(unitBytes.buffer, unitBytes.byteOffset, 4);
    expect(view.getUint32(0, true)).toBe(150_000);
  });
});
