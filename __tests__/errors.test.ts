import { decodeError, ParquetError, errorMessage } from "../src/utils/errors";

describe("error decoding (real on-chain +6000 codes)", () => {
  it("decodes ProtocolHalted 10005 (0x2715)", () => {
    expect(decodeError({ error: { errorCode: { number: 10005 } } })).toBe(
      ParquetError.ProtocolHalted,
    );
    expect(decodeError({ message: "custom program error: 0x2715" })).toBe(
      ParquetError.ProtocolHalted,
    );
    expect(errorMessage(ParquetError.ProtocolHalted)).toMatch(/halt/i);
  });

  it("decodes InvalidHaltMode 10006 (0x2716)", () => {
    expect(decodeError({ error: { errorCode: { number: 10006 } } })).toBe(
      ParquetError.InvalidHaltMode,
    );
    expect(decodeError({ message: "custom program error: 0x2716" })).toBe(
      ParquetError.InvalidHaltMode,
    );
  });

  it("decodes perp-engine PriceStale 7001 (no collision with referral)", () => {
    expect(decodeError({ error: { errorCode: { number: 7001 } } })).toBe(
      ParquetError.PriceStale,
    );
    expect(ParquetError.PriceStale).toBe(7001);
    expect(ParquetError.ReferralCodeTaken).toBe(13001);
  });

  it("decodes perp-engine BelowMinCollateral 8006", () => {
    expect(decodeError({ error: { errorCode: { number: 8006 } } })).toBe(
      ParquetError.BelowMinCollateral,
    );
    expect(decodeError({ message: "custom program error: 0x1f46" })).toBe(
      ParquetError.BelowMinCollateral,
    );
  });

  it("decodes pool-program queue error QueueEntryNotPending 6012 (0x177c)", () => {
    expect(decodeError({ error: { errorCode: { number: 6012 } } })).toBe(
      ParquetError.QueueEntryNotPending,
    );
    expect(decodeError({ message: "custom program error: 0x177c" })).toBe(
      ParquetError.QueueEntryNotPending,
    );
  });

  it("returns null for an unknown code", () => {
    expect(decodeError({ error: { errorCode: { number: 4005 } } })).toBeNull();
    expect(decodeError({ message: "custom program error: 0xfa5" })).toBeNull();
    expect(decodeError({ message: "no code here" })).toBeNull();
    expect(decodeError(null)).toBeNull();
  });
});
