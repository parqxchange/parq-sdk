import { createHash } from "node:crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  decodeMarketState,
  decodePayoutQueueEntry,
  decodeUserQueueClaims,
  decodePosition,
  decodePoolState,
  DecoderError,
  DISCRIMINATORS,
} from "../src/decode";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function disc(name: string): Uint8Array {
  const hash = createHash("sha256").update(`account:${name}`).digest();
  return new Uint8Array(hash.buffer, hash.byteOffset, 8);
}

describe("checkDisc short-buffer guard", () => {
  it("throws DecoderError on sub-8-byte account data", () => {
    expect(() => decodePosition(new Uint8Array(4))).toThrow(DecoderError);
    expect(() => decodePosition(new Uint8Array(4))).toThrow(/too short for discriminator/);
  });
});

/** Write a u64 LE into a DataView at offset. */
function writeU64(view: DataView, offset: number, value: bigint): void {
  view.setBigUint64(offset, value, true);
}

/** Write an i64 LE into a DataView at offset. */
function writeI64(view: DataView, offset: number, value: bigint): void {
  view.setBigInt64(offset, value, true);
}

/** Write 32 pubkey bytes into a Uint8Array at offset. */
function writePubkey(arr: Uint8Array, offset: number, pk: PublicKey): void {
  arr.set(pk.toBytes(), offset);
}

/** Build a syntactically valid PayoutQueueEntry buffer (98 bytes). */
function buildPayoutQueueEntry(opts?: {
  owner?: PublicKey;
  marketId?: Uint8Array;
  idx?: bigint;
  amount?: bigint;
  enqueuedAt?: bigint;
  status?: number;
  bump?: number;
}): Uint8Array {
  const buf = new Uint8Array(98);
  const view = new DataView(buf.buffer);
  // [0..8] discriminator
  buf.set(disc("PayoutQueueEntry"), 0);
  // [8..40] owner
  writePubkey(buf, 8, opts?.owner ?? Keypair.generate().publicKey);
  // [40..72] market_id
  buf.set(opts?.marketId ?? new Uint8Array(32).fill(1), 40);
  // [72..80] idx (u64 LE)
  writeU64(view, 72, opts?.idx ?? 7n);
  // [80..88] amount (u64 LE)
  writeU64(view, 80, opts?.amount ?? 1_000_000n);
  // [88..96] enqueued_at (i64 LE)
  writeI64(view, 88, opts?.enqueuedAt ?? 1_700_000_000n);
  // [96] status (u8)
  buf[96] = opts?.status ?? 0;
  // [97] bump (u8)
  buf[97] = opts?.bump ?? 254;
  return buf;
}

/** Build a syntactically valid UserQueueClaims buffer (97 bytes). */
function buildUserQueueClaims(opts?: {
  owner?: PublicKey;
  marketId?: Uint8Array;
  unpaidOwed?: bigint;
  collateralDrawn?: bigint;
  phantomUnpaidOwed?: bigint;
  bump?: number;
}): Uint8Array {
  const buf = new Uint8Array(97);
  const view = new DataView(buf.buffer);
  // [0..8] discriminator
  buf.set(disc("UserQueueClaims"), 0);
  // [8..40] owner
  writePubkey(buf, 8, opts?.owner ?? Keypair.generate().publicKey);
  // [40..72] market_id
  buf.set(opts?.marketId ?? new Uint8Array(32).fill(2), 40);
  // [72..80] unpaid_owed (u64 LE)
  writeU64(view, 72, opts?.unpaidOwed ?? 5_000_000n);
  // [80..88] collateral_drawn (u64 LE)
  writeU64(view, 80, opts?.collateralDrawn ?? 2_000_000n);
  // [88..96] phantom_unpaid_owed (u64 LE)
  writeU64(view, 88, opts?.phantomUnpaidOwed ?? 0n);
  // [96] bump (u8)
  buf[96] = opts?.bump ?? 253;
  return buf;
}

// ---------------------------------------------------------------------------
// DISCRIMINATORS constants
// ---------------------------------------------------------------------------

describe("DISCRIMINATORS", () => {
  it("includes PayoutQueueEntry", () => {
    expect(DISCRIMINATORS).toHaveProperty("PayoutQueueEntry");
    const expected = disc("PayoutQueueEntry");
    expect(Array.from(DISCRIMINATORS.PayoutQueueEntry)).toEqual(Array.from(expected));
  });

  it("includes UserQueueClaims", () => {
    expect(DISCRIMINATORS).toHaveProperty("UserQueueClaims");
    const expected = disc("UserQueueClaims");
    expect(Array.from(DISCRIMINATORS.UserQueueClaims)).toEqual(Array.from(expected));
  });
});

// ---------------------------------------------------------------------------
// decodePayoutQueueEntry
// ---------------------------------------------------------------------------

describe("decodePayoutQueueEntry", () => {
  it("decodes a well-formed buffer", () => {
    const owner = Keypair.generate().publicKey;
    const marketId = new Uint8Array(32).fill(3);
    const buf = buildPayoutQueueEntry({
      owner,
      marketId,
      idx: 42n,
      amount: 1_000_000n,
      enqueuedAt: 1_700_000_000n,
      status: 0,
      bump: 254,
    });
    const entry = decodePayoutQueueEntry(buf);
    expect(entry.owner.equals(owner)).toBe(true);
    expect(Array.from(entry.marketId)).toEqual(Array.from(marketId));
    expect(entry.idx).toBe(42n);
    expect(entry.amount).toBe(1_000_000n);
    expect(entry.enqueuedAt).toBe(1_700_000_000n);
    expect(entry.status).toBe(0);
    expect(entry.bump).toBe(254);
  });

  it("decodes status = 1 (Harvested)", () => {
    const buf = buildPayoutQueueEntry({ status: 1 });
    expect(decodePayoutQueueEntry(buf).status).toBe(1);
  });

  it("decodes status = 2 (Voided)", () => {
    const buf = buildPayoutQueueEntry({ status: 2 });
    expect(decodePayoutQueueEntry(buf).status).toBe(2);
  });

  it("decodes negative enqueuedAt (i64 signed)", () => {
    const buf = buildPayoutQueueEntry({ enqueuedAt: -1n });
    expect(decodePayoutQueueEntry(buf).enqueuedAt).toBe(-1n);
  });

  it("decodes idx = 0 (boundary)", () => {
    const buf = buildPayoutQueueEntry({ idx: 0n });
    expect(decodePayoutQueueEntry(buf).idx).toBe(0n);
  });

  it("throws DecoderError on wrong discriminator", () => {
    const buf = buildPayoutQueueEntry();
    buf[0] = (buf[0]! ^ 0xff);
    expect(() => decodePayoutQueueEntry(buf)).toThrow(DecoderError);
  });

  it("throws DecoderError on wrong length (too short)", () => {
    const buf = buildPayoutQueueEntry().subarray(0, 97);
    expect(() => decodePayoutQueueEntry(buf)).toThrow(DecoderError);
  });

  it("throws DecoderError on wrong length (too long)", () => {
    const base = buildPayoutQueueEntry();
    const buf = new Uint8Array(99);
    buf.set(base);
    expect(() => decodePayoutQueueEntry(buf)).toThrow(DecoderError);
  });

  it("accepts a Buffer (not just Uint8Array)", () => {
    const raw = buildPayoutQueueEntry({ idx: 99n });
    const asBuffer = Buffer.from(raw);
    expect(decodePayoutQueueEntry(asBuffer).idx).toBe(99n);
  });
});

// ---------------------------------------------------------------------------
// decodeUserQueueClaims
// ---------------------------------------------------------------------------

describe("decodeUserQueueClaims", () => {
  it("decodes a well-formed buffer", () => {
    const owner = Keypair.generate().publicKey;
    const marketId = new Uint8Array(32).fill(4);
    const buf = buildUserQueueClaims({
      owner,
      marketId,
      unpaidOwed: 5_000_000n,
      collateralDrawn: 2_000_000n,
      phantomUnpaidOwed: 1_000n,
      bump: 253,
    });
    const claims = decodeUserQueueClaims(buf);
    expect(claims.owner.equals(owner)).toBe(true);
    expect(Array.from(claims.marketId)).toEqual(Array.from(marketId));
    expect(claims.unpaidOwed).toBe(5_000_000n);
    expect(claims.collateralDrawn).toBe(2_000_000n);
    expect(claims.phantomUnpaidOwed).toBe(1_000n);
    expect(claims.bump).toBe(253);
  });

  it("decodes all-zero values", () => {
    const buf = buildUserQueueClaims({
      unpaidOwed: 0n,
      collateralDrawn: 0n,
      phantomUnpaidOwed: 0n,
      bump: 0,
    });
    const claims = decodeUserQueueClaims(buf);
    expect(claims.unpaidOwed).toBe(0n);
    expect(claims.collateralDrawn).toBe(0n);
    expect(claims.phantomUnpaidOwed).toBe(0n);
    expect(claims.bump).toBe(0);
  });

  it("throws DecoderError on wrong discriminator", () => {
    const buf = buildUserQueueClaims();
    buf[0] = (buf[0]! ^ 0xff);
    expect(() => decodeUserQueueClaims(buf)).toThrow(DecoderError);
  });

  it("throws DecoderError on wrong length (too short)", () => {
    const buf = buildUserQueueClaims().subarray(0, 96);
    expect(() => decodeUserQueueClaims(buf)).toThrow(DecoderError);
  });

  it("throws DecoderError on wrong length (too long)", () => {
    const base = buildUserQueueClaims();
    const buf = new Uint8Array(98);
    buf.set(base);
    expect(() => decodeUserQueueClaims(buf)).toThrow(DecoderError);
  });

  it("accepts a Buffer (not just Uint8Array)", () => {
    const raw = buildUserQueueClaims({ unpaidOwed: 999n });
    const asBuffer = Buffer.from(raw);
    expect(decodeUserQueueClaims(asBuffer).unpaidOwed).toBe(999n);
  });
});

describe("decodeMarketState — V1/V2 length tolerance", () => {
  function buildMarketState(len: number): Uint8Array {
    const buf = new Uint8Array(len);
    buf.set(DISCRIMINATORS.MarketState, 0);
    // marketId at offset 8 (32 bytes) — leave zeros
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    writeU64(view, 40, 1234n); // long_oi
    writeU64(view, 48, 5678n); // short_oi
    // funding_index i128 at 56 (16 bytes) — leave zero
    writeI64(view, 72, 1717171717n); // last_funding_ts
    return buf;
  }

  it("accepts V1 length (460 bytes) — pre-Phase-1 layout", () => {
    const out = decodeMarketState(buildMarketState(460));
    expect(out.longOi).toBe(1234n);
    expect(out.shortOi).toBe(5678n);
    expect(out.lastFundingTs).toBe(1717171717n);
  });

  it("accepts V2 length (476 bytes) — Phase-1 24/7-unlock realloc", () => {
    const out = decodeMarketState(buildMarketState(476));
    expect(out.longOi).toBe(1234n);
    expect(out.shortOi).toBe(5678n);
    expect(out.lastFundingTs).toBe(1717171717n);
  });

  it("rejects other lengths (between or beyond)", () => {
    expect(() => decodeMarketState(buildMarketState(468))).toThrow(DecoderError);
    expect(() => decodeMarketState(buildMarketState(500))).toThrow(DecoderError);
  });

  it("decodes off-hours OI caps from V2 buffer (closes #81)", () => {
    const buf = buildMarketState(476);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    writeU64(view, 460, 1234n); // off_hours_max_oi_long
    writeU64(view, 468, 5678n); // off_hours_max_oi_short
    const out = decodeMarketState(buf);
    expect(out.offHoursMaxOiLong).toBe(1234n);
    expect(out.offHoursMaxOiShort).toBe(5678n);
  });

  it("leaves off-hours OI cap fields undefined on V1 buffer (closes #81)", () => {
    const out = decodeMarketState(buildMarketState(460));
    expect(out.offHoursMaxOiLong).toBeUndefined();
    expect(out.offHoursMaxOiShort).toBeUndefined();
  });

  it("accepts V3 length (511 bytes) — coordinated go-live ADL + initial_margin_bps realloc", () => {
    const out = decodeMarketState(buildMarketState(511));
    expect(out.longOi).toBe(1234n);
    expect(out.shortOi).toBe(5678n);
    expect(out.lastFundingTs).toBe(1717171717n);
  });

  it("decodes initial_margin_bps (@509) + ADL block (@476..509) from a V3 buffer + keeps off-hours OI caps", () => {
    const buf = buildMarketState(511);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    writeU64(view, 460, 1234n); // off_hours_max_oi_long
    writeU64(view, 468, 5678n); // off_hours_max_oi_short
    // ADL block (the migration's DISARMED defaults: frozen=1, triggers=u64::MAX)
    view.setUint8(476, 1);                       // adl_frozen
    view.setBigUint64(477, 0xffffffffffffffffn, true); // adl_tail_trigger_usdc_rth
    view.setBigUint64(485, 0xffffffffffffffffn, true); // adl_tail_trigger_usdc_off
    view.setUint16(505, 5000, true);             // adl_max_haircut_bps
    // 250x initial_margin_bps NOW at offset 509 (after the 33-byte ADL block)
    view.setUint16(509, 50, true);               // initial_margin_bps = 50 (LE)
    const out = decodeMarketState(buf);
    expect(out.offHoursMaxOiLong).toBe(1234n);
    expect(out.offHoursMaxOiShort).toBe(5678n);
    expect(out.adlFrozen).toBe(1);
    expect(out.adlTailTriggerUsdcRth).toBe(0xffffffffffffffffn);
    expect(out.adlTailTriggerUsdcOff).toBe(0xffffffffffffffffn);
    expect(out.adlMaxHaircutBps).toBe(5000);
    expect(out.initialMarginBps).toBe(50);
  });

  it("leaves initialMarginBps + ADL fields undefined on V1/V2 buffers", () => {
    expect(decodeMarketState(buildMarketState(460)).initialMarginBps).toBeUndefined();
    expect(decodeMarketState(buildMarketState(476)).initialMarginBps).toBeUndefined();
    expect(decodeMarketState(buildMarketState(476)).adlFrozen).toBeUndefined();
  });

  it("accepts V4 length (515 bytes) — liquidation-economics realloc", () => {
    const out = decodeMarketState(buildMarketState(515));
    expect(out.longOi).toBe(1234n);
    expect(out.shortOi).toBe(5678n);
    expect(out.lastFundingTs).toBe(1717171717n);
  });

  it("decodes liq_fee_bps (@511) + partial_liq_target_health (@513) from a V4 buffer + keeps V3 fields", () => {
    const buf = buildMarketState(515);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    writeU64(view, 460, 1234n); // off_hours_max_oi_long
    view.setUint8(476, 1);                       // adl_frozen
    view.setUint16(509, 50, true);               // initial_margin_bps = 50
    view.setUint16(511, 2000, true);             // liq_fee_bps = 2000 (20%)
    view.setUint16(513, 1500, true);             // partial_liq_target_health = 1500 (non-default sentinel)
    const out = decodeMarketState(buf);
    expect(out.initialMarginBps).toBe(50);
    expect(out.adlFrozen).toBe(1);
    expect(out.liqFeeBps).toBe(2000);
    expect(out.partialLiqTargetHealth).toBe(1500);
  });

  it("leaves liqFeeBps + partialLiqTargetHealth undefined on V1/V2/V3 buffers", () => {
    expect(decodeMarketState(buildMarketState(460)).liqFeeBps).toBeUndefined();
    expect(decodeMarketState(buildMarketState(476)).liqFeeBps).toBeUndefined();
    expect(decodeMarketState(buildMarketState(511)).liqFeeBps).toBeUndefined();
    expect(decodeMarketState(buildMarketState(511)).partialLiqTargetHealth).toBeUndefined();
  });
});

describe("decodePoolState — v4/v5/v6 length tolerance (2026-06-12 collateral-escrow realloc)", () => {
  function buildPoolState(len: number): Uint8Array {
    const buf = new Uint8Array(len);
    buf.set(DISCRIMINATORS.PoolState, 0);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    writeU64(view, 105, 5_000_000n); // total_usdc
    writeU64(view, 113, 1_000_000n); // reserved_usdc
    writeU64(view, 223, 7n);         // queue_tail_idx
    view.setUint8(239, 254);         // bump
    return buf;
  }

  it("accepts v4 (240), v5 (252), and v6 (260) lengths", () => {
    for (const len of [240, 252, 260]) {
      const out = decodePoolState(buildPoolState(len));
      expect(out.totalUsdc).toBe(5_000_000n);
      expect(out.reservedUsdc).toBe(1_000_000n);
      expect(out.queueTailIdx).toBe(7n);
      expect(out.bump).toBe(254);
    }
  });

  it("rejects any other length (the regression that bricked /farm + closes)", () => {
    // Mainnet pools became 260 on 2026-06-12; the old decoder only knew 240/252
    // and threw `got 260` for every pool. Guard both the old gap and over-long.
    expect(() => decodePoolState(buildPoolState(248))).toThrow(DecoderError);
    expect(() => decodePoolState(buildPoolState(268))).toThrow(DecoderError);
  });

  it("decodes escrowedCollateralUsdc (@252) from a v6 buffer", () => {
    const buf = buildPoolState(260);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    writeU64(view, 240, 0n);        // current_adl_epoch region (u32) — leave 0
    writeU64(view, 244, 9n);        // last_adl_cut_idx
    writeU64(view, 252, 4_200_000n); // escrowed_collateral_usdc
    const out = decodePoolState(buf);
    expect(out.escrowedCollateralUsdc).toBe(4_200_000n);
    expect(out.lastAdlCutIdx).toBe(9n);
  });

  it("defaults escrowedCollateralUsdc to 0n on pre-v6 (240/252) buffers", () => {
    expect(decodePoolState(buildPoolState(240)).escrowedCollateralUsdc).toBe(0n);
    expect(decodePoolState(buildPoolState(252)).escrowedCollateralUsdc).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// CategoryPool / MarketRisk decoders (unified-LP-pool Phase 0/3)
// ---------------------------------------------------------------------------
import { decodeCategoryPool, decodeMarketRisk, poolShapeOf } from "../src/decode";

function w32(arr: Uint8Array, off: number, b: number) { arr.set(new Uint8Array(32).fill(b), off); }

describe("decodeCategoryPool / decodeMarketRisk (Phase 0/3)", () => {
  it("decodeCategoryPool reads fields at the pinned offsets (LEN 264)", () => {
    const a = new Uint8Array(264);
    a.set(disc("CategoryPool"), 0);
    w32(a, 8, 0x5a);  // category_id
    const v = new DataView(a.buffer);
    a[72] = 7;        // vault_authority_bump
    writeU64(v, 105, 1_000n);  // total_usdc
    writeU64(v, 113, 22n);     // cumulative_fees
    writeU64(v, 121, 33n);     // escrowed
    writeU64(v, 129, 44n);     // sum_reserved
    writeU64(v, 137, 55n);     // sum_queue_owed
    a[177] = 9;        // engine_auth_bump
    a[242] = 1;        // is_paused
    a[255] = 3;        // bump
    writeU64(v, 256, 66n);     // sum_side_bucket
    const cp = decodeCategoryPool(a);
    expect(cp.totalUsdc).toBe(1_000n);
    expect(cp.cumulativeFees).toBe(22n);
    expect(cp.escrowedCollateralUsdc).toBe(33n);
    expect(cp.sumReservedUsdc).toBe(44n);
    expect(cp.sumQueueOwedUsdc).toBe(55n);
    expect(cp.sumSideBucketUsdc).toBe(66n);
    expect(cp.isPaused).toBe(true);
    expect(cp.bump).toBe(3);
    { const bad = new Uint8Array(260); bad.set(disc("CategoryPool"), 0); expect(() => decodeCategoryPool(bad)).toThrow(/264 bytes/); }
  });

  it("decodeMarketRisk reads fields incl. the Phase-3 snapshot tail (LEN 199)", () => {
    const a = new Uint8Array(199);
    a.set(disc("MarketRisk"), 0);
    const v = new DataView(a.buffer);
    w32(a, 8, 0x11);   // market_id
    w32(a, 40, 0x22);  // category_id
    writeU64(v, 72, 100n);  // reserved
    writeU64(v, 80, 500_000_000_000n); // reserve_factor
    writeU64(v, 138, 7n);   // side_bucket
    writeU64(v, 162, 9n);   // queue_total_owed
    a[182] = 2;             // bump
    writeU64(v, 183, 111n); // migration_old_lp_supply
    writeU64(v, 191, 222n); // migration_escrow_minted
    const mr = decodeMarketRisk(a);
    expect(mr.reservedUsdc).toBe(100n);
    expect(mr.reserveFactor).toBe(500_000_000_000n);
    expect(mr.sideBucket).toBe(7n);
    expect(mr.queueTotalOwed).toBe(9n);
    expect(mr.bump).toBe(2);
    expect(mr.migrationOldLpSupply).toBe(111n);
    expect(mr.migrationEscrowMinted).toBe(222n);
    { const bad = new Uint8Array(183); bad.set(disc("MarketRisk"), 0); expect(() => decodeMarketRisk(bad)).toThrow(/199 bytes/); }
  });

  it("poolShapeOf picks Legacy vs Category by discriminator", () => {
    const legacy = new Uint8Array(8); legacy.set(disc("PoolState"), 0);
    const cat = new Uint8Array(8); cat.set(disc("CategoryPool"), 0);
    expect(poolShapeOf(legacy)).toBe("Legacy");
    expect(poolShapeOf(cat)).toBe("Category");
    expect(() => poolShapeOf(new Uint8Array(8))).toThrow();
  });
});
