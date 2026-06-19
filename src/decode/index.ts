/**
 * Manual borsh decoders for all Parquet account types.
 *
 * Each decoder:
 *   1. Validates the 8-byte Anchor discriminator (sha256("account:TypeName")[0..8])
 *   2. Validates the expected byte length
 *   3. Reads fields sequentially from a DataView (little-endian, no padding)
 *   4. Returns a fully-typed interface from "../types"
 *
 * No IDL dependency — works directly against raw `getAccountInfo` data.
 */

import { sha256 } from "@noble/hashes/sha256";
import { PublicKey } from "@solana/web3.js";
import type {
  Position,
  MarketState,
  PoolState,
  Order,
  OrderNonce,
  TradingKey,
  ReferralConfig,
  ReferralTier,
  ReferralCode,
  TraderReferral,
  AffiliateReward,
  FeePool,
  StakingPool,
  StakePosition,
  PayoutQueueEntry,
  UserQueueClaims,
  CategoryPool,
  MarketRisk,
  Side,
  OrderType,
} from "../types";

// ---------------------------------------------------------------------------
// Shared infrastructure
// ---------------------------------------------------------------------------

/** Compute sha256("account:TypeName")[0..8] — the Anchor account discriminator. */
export function sha256Disc(name: string): Buffer {
  const hash = Buffer.from(sha256(new TextEncoder().encode(`account:${name}`)));
  return hash.subarray(0, 8) as Buffer;
}

/** All 15 account discriminator constants (computed once at module load). */
export const DISCRIMINATORS = {
  Position:          sha256Disc("Position"),
  MarketState:       sha256Disc("MarketState"),
  PoolState:         sha256Disc("PoolState"),
  Order:             sha256Disc("Order"),
  OrderNonce:        sha256Disc("OrderNonce"),
  TradingKey:        sha256Disc("TradingKey"),
  ReferralConfig:    sha256Disc("ReferralConfig"),
  ReferralCode:      sha256Disc("ReferralCode"),
  TraderReferral:    sha256Disc("TraderReferral"),
  AffiliateReward:   sha256Disc("AffiliateReward"),
  FeePool:           sha256Disc("FeePool"),
  StakingPool:       sha256Disc("StakingPool"),
  StakePosition:     sha256Disc("StakePosition"),
  PayoutQueueEntry:  sha256Disc("PayoutQueueEntry"),
  UserQueueClaims:   sha256Disc("UserQueueClaims"),
  // Unified-LP-pool (Phase 0/3) category accounts.
  CategoryPool:      sha256Disc("CategoryPool"),
  MarketRisk:        sha256Disc("MarketRisk"),
} as const;

/**
 * Minimal base58 (Bitcoin alphabet) encoder — no external dependency, used only
 * to expose the 8-byte account discriminators as `getProgramAccounts` memcmp
 * filter strings (`@solana/web3.js` does not re-export bs58, and a discriminator
 * is 8 bytes so `PublicKey` can't encode it). Standard big-endian base58.
 */
const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function discToBase58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58_ALPHABET[digits[i]!];
  return out;
}

/**
 * Base58 of the Position / Order account discriminators (#234). Pass as the
 * `{ memcmp: { offset: 0, bytes } }` filter in `getProgramAccounts` so a scan
 * matches the account TYPE rather than an exact `dataSize` — growth-proof: a
 * Position/Order struct that appends tail fields (the keeper-blindness class,
 * #230 154→170) no longer silently returns ZERO accounts.
 */
export const POSITION_ACCT_DISC = discToBase58(DISCRIMINATORS.Position); // "VZMoMoKgZQb"
export const ORDER_ACCT_DISC = discToBase58(DISCRIMINATORS.Order);       // "PXZJQQ2HEmx"

/** Custom error type for decoder failures. */
export class DecoderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecoderError";
  }
}

/** Validate that the first 8 bytes match the expected discriminator. */
function checkDisc(data: Uint8Array, expected: Buffer, typeName: string): void {
  if (data.byteLength < 8) {
    throw new DecoderError(
      `${typeName}: data too short for discriminator (${data.byteLength} < 8)`,
    );
  }
  for (let i = 0; i < 8; i++) {
    if (data[i] !== expected[i]) {
      throw new DecoderError(
        `${typeName}: discriminator mismatch at byte ${i} ` +
        `(got 0x${data[i]!.toString(16).padStart(2, "0")}, ` +
        `expected 0x${expected[i]!.toString(16).padStart(2, "0")})`
      );
    }
  }
}

/** Validate that the data is exactly the expected length (fixed-size accounts). */
function checkLen(data: Uint8Array, expected: number, typeName: string): void {
  if (data.byteLength !== expected) {
    throw new DecoderError(
      `${typeName}: expected ${expected} bytes, got ${data.byteLength}`
    );
  }
}

/**
 * Validate that the data is AT LEAST `min` bytes (length-tolerant, #234).
 *
 * Used by the Position/Order decoders: a struct that GROWS by appending fields
 * at its tail (the only safe Anchor migration shape, e.g. Position 154→170 #230)
 * must not blind a reader — existing fields keep their offsets and the appended
 * tail is simply not decoded. A buffer SHORTER than `min` is still rejected.
 * (`checkLen` stays exact for the fixed-size accounts whose decoders assert a
 * too-long buffer is invalid.) `min` is the canonical CURRENT size — the
 * blast-radius gate registers Position/Order there explicitly.
 */
function checkMinLen(data: Uint8Array, min: number, typeName: string): void {
  if (data.byteLength < min) {
    throw new DecoderError(
      `${typeName}: expected >= ${min} bytes, got ${data.byteLength}`
    );
  }
}

// ---------------------------------------------------------------------------
// LE reading helpers
// ---------------------------------------------------------------------------

function readU8(view: DataView, offset: number): number {
  return view.getUint8(offset);
}

function readU16LE(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readU32LE(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function readU64LE(view: DataView, offset: number): bigint {
  return view.getBigUint64(offset, true);
}

function readI64LE(view: DataView, offset: number): bigint {
  return view.getBigInt64(offset, true);
}

/**
 * Read a 16-byte unsigned i128 (little-endian).
 * Layout: [lo: u64][hi: u64]  — both halves unsigned.
 */
function readU128LE(view: DataView, offset: number): bigint {
  const lo = view.getBigUint64(offset, true);
  const hi = view.getBigUint64(offset + 8, true);
  return lo | (hi << 64n);
}

/**
 * Read a 16-byte signed i128 (little-endian).
 * Layout: [lo: u64 unsigned][hi: i64 signed].
 * Combine as: lo | (hi << 64n).  Because lo is always the low 64 bits
 * and hi carries the sign, the bigint result has the correct sign.
 */
function readI128LE(view: DataView, offset: number): bigint {
  const lo = view.getBigUint64(offset, true);
  const hi = view.getBigInt64(offset + 8, true);
  return lo | (hi << 64n);
}

/** Read 32 bytes as a Solana PublicKey. */
function readPubkey(view: DataView, offset: number): PublicKey {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, 32);
  return new PublicKey(bytes);
}

/** Read n bytes as a Uint8Array (copy, independent of underlying buffer). */
function readBytes(view: DataView, offset: number, len: number): Uint8Array {
  return new Uint8Array(
    view.buffer.slice(view.byteOffset + offset, view.byteOffset + offset + len)
  );
}

function readBool(view: DataView, offset: number): boolean {
  return view.getUint8(offset) !== 0;
}

/** Decode borsh u8 Side: 0 = long, 1 = short. */
function readSide(view: DataView, offset: number): Side {
  const v = view.getUint8(offset);
  if (v === 0) return "long";
  if (v === 1) return "short";
  throw new DecoderError(`invalid Side byte: ${v}`);
}

/** Decode borsh u8 OrderType: 0–5. */
function readOrderType(view: DataView, offset: number): OrderType {
  const v = view.getUint8(offset);
  const map: OrderType[] = [
    "marketIncrease",
    "limitIncrease",
    "stopIncrease",
    "marketDecrease",
    "limitDecrease",
    "stopLossDecrease",
  ];
  const result = map[v];
  if (result === undefined) {
    throw new DecoderError(`invalid OrderType byte: ${v}`);
  }
  return result;
}

/**
 * Build a DataView that correctly handles sliced Uint8Array views.
 * Must use buffer + byteOffset + byteLength, not just buffer.
 */
function makeView(data: Buffer | Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

// ---------------------------------------------------------------------------
// Position decoder
// ---------------------------------------------------------------------------
//
// Byte layout (154 bytes total, v4):
//   [0..8]     discriminator
//   [8..40]    owner: Pubkey
//   [40..72]   market_id: [u8; 32]
//   [72]       side: u8
//   [73..81]   size_usdc: u64
//   [81..89]   collateral_usdc: u64
//   [89..97]   entry_price: u64
//   [97..113]  funding_index_snapshot: i128
//   [113..129] borrowing_factor_snapshot: u128
//   [129..137] reserved_max_payout: u64
//   [137..145] collateral_from_queue: u64  (NEW v4)
//   [145..153] opened_at: i64
//   [153]      bump: u8

export function decodePosition(data: Buffer | Uint8Array): Position {
  checkDisc(data, DISCRIMINATORS.Position, "Position");
  checkMinLen(data, 170, "Position"); // #234 length-tolerant: 154 + 16 (credit_usdc + credit_expires_at appended #230, migrated 154→170 2026-06-19). >= so the NEXT tail append doesn't blind decoders; existing fields keep their offsets.
  const v = makeView(data);
  return {
    owner:                   readPubkey(v, 8),
    marketId:                readBytes(v, 40, 32),
    side:                    readSide(v, 72),
    sizeUsdc:                readU64LE(v, 73),
    collateralUsdc:          readU64LE(v, 81),
    entryPrice:              readU64LE(v, 89),
    fundingIndexSnapshot:    readI128LE(v, 97),
    borrowingFactorSnapshot: readU128LE(v, 113),
    reservedMaxPayout:       readU64LE(v, 129),
    collateralFromQueue:     readU64LE(v, 137),
    openedAt:                readI64LE(v, 145),
    bump:                    readU8(v, 153),
  };
}

// ---------------------------------------------------------------------------
// MarketState decoder
// ---------------------------------------------------------------------------
//
// Byte layout (V1 = 460 bytes, V2 = 476 bytes after Phase-1 24/7 unlock):
//   [0..8]     discriminator
//   [8..40]    market_id: [u8; 32]
//   [40..48]   long_oi: u64
//   [48..56]   short_oi: u64
//   [56..72]   funding_index: i128
//   [72..80]   last_funding_ts: i64
//   [80]       max_leverage: u8
//   [81..83]   base_fee_bps: u16
//   [83..85]   mmr_bps: u16
//   [85..117]  pool_state: Pubkey
//   [117..149] pool_program: Pubkey
//   [149..181] oracle_program: Pubkey
//   [181..213] treasury: Pubkey
//   [213..245] staking_program_id: Pubkey
//   [245]      engine_auth_bump: u8
//   [246]      is_paused: bool
//   [247..263] saved_funding_factor_per_second: i128
//   [263..271] funding_increase_factor_per_second: u64
//   [271..279] funding_decrease_factor_per_second: u64
//   [279..287] threshold_for_stable_funding: u64
//   [287..295] threshold_for_decrease_funding: u64
//   [295..303] min_funding_factor_per_second: u64
//   [303..311] max_funding_factor_per_second: u64
//   [311..327] long_cumulative_borrowing_factor: u128
//   [327..343] short_cumulative_borrowing_factor: u128
//   [343..351] last_borrowing_ts: i64
//   [351..359] borrowing_factor: u64
//   [359..367] optimal_usage_factor: u64
//   [367..375] above_optimal_borrowing_factor: u64
//   [375..383] long_reserved_usdc: u64
//   [383..391] short_reserved_usdc: u64
//   [391..399] price_impact_factor: u64
//   [399..401] max_price_impact_bps: u16
//   [401..409] impact_pool_usdc: u64
//   [409..441] keeper: Pubkey
//   [441..449] max_oi_long: u64
//   [449..457] max_oi_short: u64
//   [457..459] fee_bps_favorable: u16
//   [459]      bump: u8
//   --- V2 append (present when data.length >= 476) ---
//   [460..468] off_hours_max_oi_long: u64
//   [468..476] off_hours_max_oi_short: u64
//   --- V3 append (present when data.length === 511) ---
//   ADL tail-backstop block (33B @476..509):
//   [476]      adl_frozen: u8
//   [477..485] adl_tail_trigger_usdc_rth: u64
//   [485..493] adl_tail_trigger_usdc_off: u64
//   [493..497] adl_tail_min_age_secs_rth: u32
//   [497..501] adl_tail_min_age_secs_off: u32
//   [501..503] adl_haircut_bps_rth: u16
//   [503..505] adl_haircut_bps_off: u16
//   [505..507] adl_max_haircut_bps: u16
//   [507..509] adl_max_feed_divergence_bps: u16
//   initial-margin floor (2B @509..511):
//   [509..511] initial_margin_bps: u16   ← appended AFTER the ADL block
//   --- V4 append (present when data.length === 515) ---
//   liquidation economics (4B @511..515):
//   [511..513] liq_fee_bps: u16              ← φ in bps of equity (default 2000 = 20%)
//   [513..515] partial_liq_target_health: u16 ← 0 = partial-liq disabled
//
// v4: ADL fields removed (long_total_entry_value, short_total_entry_value,
//     max_pnl_factor_for_adl, adl_enabled_long, adl_enabled_short, last_adl_update_ts).
//     keeper moved to offset 409 (immediately after impact_pool_usdc).

export function decodeMarketState(data: Buffer | Uint8Array): MarketState {
  checkDisc(data, DISCRIMINATORS.MarketState, "MarketState");
  // V2 appends 2× u64 off_hours_max_oi_long/short at the end → LEN grew
  // 460 → 476. The first 460 bytes are wire-identical, so V1 callers continue
  // to read all pre-V2 fields without change. The two V2-only fields are
  // surfaced as optional and remain `undefined` when the on-chain account is
  // still V1-sized. If the layout ever needs a *non-appending* change, bump
  // this function's signature and audit callers.
  // Valid sizes: 460 (V1), 476 (V2 off-hours OI), 511 (V3 — ADL block + IM).
  // V3 appends the ADL block (33B) + IM (2B) in one 476 → 511 realloc.
  if (data.length !== 460 && data.length !== 476 && data.length !== 511 && data.length !== 515) {
    checkLen(data, 515, "MarketState");
  }
  const v = makeView(data);
  const base = {
    marketId:                         readBytes(v, 8, 32),
    longOi:                           readU64LE(v, 40),
    shortOi:                          readU64LE(v, 48),
    fundingIndex:                     readI128LE(v, 56),
    lastFundingTs:                    readI64LE(v, 72),
    maxLeverage:                      readU8(v, 80),
    baseFeeBps:                       readU16LE(v, 81),
    mmrBps:                           readU16LE(v, 83),
    poolState:                        readPubkey(v, 85),
    poolProgram:                      readPubkey(v, 117),
    oracleProgram:                    readPubkey(v, 149),
    treasury:                         readPubkey(v, 181),
    stakingProgramId:                 readPubkey(v, 213),
    engineAuthBump:                   readU8(v, 245),
    isPaused:                         readBool(v, 246),
    savedFundingFactorPerSecond:      readI128LE(v, 247),
    fundingIncreaseFactorPerSecond:   readU64LE(v, 263),
    fundingDecreaseFactorPerSecond:   readU64LE(v, 271),
    thresholdForStableFunding:        readU64LE(v, 279),
    thresholdForDecreaseFunding:      readU64LE(v, 287),
    minFundingFactorPerSecond:        readU64LE(v, 295),
    maxFundingFactorPerSecond:        readU64LE(v, 303),
    longCumulativeBorrowingFactor:    readU128LE(v, 311),
    shortCumulativeBorrowingFactor:   readU128LE(v, 327),
    lastBorrowingTs:                  readI64LE(v, 343),
    borrowingFactor:                  readU64LE(v, 351),
    optimalUsageFactor:               readU64LE(v, 359),
    aboveOptimalBorrowingFactor:      readU64LE(v, 367),
    longReservedUsdc:                 readU64LE(v, 375),
    shortReservedUsdc:                readU64LE(v, 383),
    priceImpactFactor:                readU64LE(v, 391),
    maxPriceImpactBps:                readU16LE(v, 399),
    impactPoolUsdc:                   readU64LE(v, 401),
    keeper:                           readPubkey(v, 409),
    maxOiLong:                        readU64LE(v, 441),
    maxOiShort:                       readU64LE(v, 449),
    feeBpsFavorable:                  readU16LE(v, 457),
    bump:                             readU8(v, 459),
  };
  // V2 (>=476): off-hours OI caps. V3 (>=511): + ADL block (476..509) + initial_margin_bps (509..511).
  if (data.length >= 476) {
    const v2 = {
      ...base,
      offHoursMaxOiLong:  readU64LE(v, 460),
      offHoursMaxOiShort: readU64LE(v, 468),
    };
    if (data.length >= 511) {
      const v3 = {
        ...v2,
        // ADL tail-backstop params (read for the caps reader + arming verify-or-abort).
        adlFrozen:                 readU8(v, 476),
        adlTailTriggerUsdcRth:     readU64LE(v, 477),
        adlTailTriggerUsdcOff:     readU64LE(v, 485),
        adlTailMinAgeSecsRth:      readU32LE(v, 493),
        adlTailMinAgeSecsOff:      readU32LE(v, 497),
        adlHaircutBpsRth:          readU16LE(v, 501),
        adlHaircutBpsOff:          readU16LE(v, 503),
        adlMaxHaircutBps:          readU16LE(v, 505),
        adlMaxFeedDivergenceBps:   readU16LE(v, 507),
        // 250x initial-margin floor (openable cap = 10000 / IM).
        initialMarginBps:          readU16LE(v, 509),
      };
      // V4 append (511 → 515): equity-denominated liq fee + partial-liq target health.
      if (data.length >= 515) {
        return {
          ...v3,
          liqFeeBps:               readU16LE(v, 511),
          partialLiqTargetHealth:  readU16LE(v, 513),
        };
      }
      return v3;
    }
    return v2;
  }
  return base;
}

// ---------------------------------------------------------------------------
// PoolState decoder
// ---------------------------------------------------------------------------
//
// Byte layout (252 bytes total, v5; 240 pre-ADL/v4):
//   [0..8]     discriminator
//   [8..40]    market_id: [u8; 32]
//   [40..72]   usdc_vault: Pubkey
//   [72]       vault_authority_bump: u8
//   [73..105]  lp_mint: Pubkey
//   [105..113] total_usdc: u64
//   [113..121] reserved_usdc: u64
//   [121..129] cumulative_fees: u64
//   [129..161] engine_auth: Pubkey
//   [161]      engine_auth_bump: u8
//   [162..194] admin: Pubkey
//   [194]      is_paused: bool
//   [195..203] reserve_factor: u64
//   [203..205] deposit_fee_bps: u16
//   [205..207] withdrawal_fee_bps: u16
//   [207..215] side_bucket: u64    (NEW v4 — borsh follows struct field order)
//   [215..223] queue_head_idx: u64 (NEW v4)
//   [223..231] queue_tail_idx: u64 (NEW v4)
//   [231..239] queue_total_owed: u64 (NEW v4)
//   [239]      bump: u8
//   [240..244] current_adl_epoch: u32 (NEW v5 — ADL tail-backstop, APPENDED after bump)
//   [244..252] last_adl_cut_idx: u64  (NEW v5)
//   [252..260] escrowed_collateral_usdc: u64 (NEW v6 — collateral-escrow fix, APPENDED)
//
// v4: Borsh serializes in struct field declaration order.
// side_bucket, queue_head_idx, queue_tail_idx, queue_total_owed come before bump.
// v5: `migrate_pool_state_v2` grows live pools 240→252, APPENDING
// current_adl_epoch + last_adl_cut_idx AFTER bump so every offset above is
// unchanged.
// v6: `migrate_pool_state_v3` (2026-06-12) grows live pools 252→260, APPENDING
// escrowed_collateral_usdc after last_adl_cut_idx — again offset-stable.
// Accept ALL THREE lengths: a v6 pool is 260, a v5 pool is 252, any un-migrated
// legacy pool is 240 (newer fields default to 0). Mainnet pools were migrated to
// 260 on 2026-06-12; rejecting 260 here bricked /farm + position closes.

export function decodePoolState(data: Buffer | Uint8Array): PoolState {
  checkDisc(data, DISCRIMINATORS.PoolState, "PoolState");
  if (data.byteLength !== 240 && data.byteLength !== 252 && data.byteLength !== 260) {
    throw new DecoderError(
      `PoolState: expected 240, 252, or 260 bytes, got ${data.byteLength}`
    );
  }
  const v = makeView(data);
  const hasAdl = data.byteLength >= 252;
  const hasEscrow = data.byteLength >= 260;
  return {
    marketId:           readBytes(v, 8, 32),
    usdcVault:          readPubkey(v, 40),
    vaultAuthorityBump: readU8(v, 72),
    lpMint:             readPubkey(v, 73),
    totalUsdc:          readU64LE(v, 105),
    reservedUsdc:       readU64LE(v, 113),
    cumulativeFees:     readU64LE(v, 121),
    engineAuth:         readPubkey(v, 129),
    engineAuthBump:     readU8(v, 161),
    admin:              readPubkey(v, 162),
    isPaused:           readBool(v, 194),
    reserveFactor:      readU64LE(v, 195),
    depositFeeBps:      readU16LE(v, 203),
    withdrawalFeeBps:   readU16LE(v, 205),
    sideBucket:         readU64LE(v, 207),
    queueHeadIdx:       readU64LE(v, 215),
    queueTailIdx:       readU64LE(v, 223),
    queueTotalOwed:     readU64LE(v, 231),
    bump:               readU8(v, 239),
    currentAdlEpoch:    hasAdl ? readU32LE(v, 240) : 0,
    lastAdlCutIdx:      hasAdl ? readU64LE(v, 244) : 0n,
    escrowedCollateralUsdc: hasEscrow ? readU64LE(v, 252) : 0n,
  };
}

// ---------------------------------------------------------------------------
// CategoryPool / MarketRisk decoders (unified-LP-pool Phase 0/3)
// ---------------------------------------------------------------------------
//
// CategoryPool (LEN 264): disc[0..8] category_id[8..40] usdc_vault[40..72]
//   vault_authority_bump[72] lp_mint[73..105] total_usdc[105..113]
//   cumulative_fees[113..121] escrowed_collateral_usdc[121..129]
//   sum_reserved_usdc[129..137] sum_queue_owed_usdc[137..145] engine_auth[145..177]
//   engine_auth_bump[177] insurance_fund[178..210] admin[210..242] is_paused[242]
//   reserve_factor[243..251] deposit_fee_bps[251..253] withdrawal_fee_bps[253..255]
//   bump[255] sum_side_bucket_usdc[256..264].
export function decodeCategoryPool(data: Buffer | Uint8Array): CategoryPool {
  checkDisc(data, DISCRIMINATORS.CategoryPool, "CategoryPool");
  if (data.byteLength !== 264) {
    throw new DecoderError(`CategoryPool: expected 264 bytes, got ${data.byteLength}`);
  }
  const v = makeView(data);
  return {
    categoryId:             readBytes(v, 8, 32),
    usdcVault:              readPubkey(v, 40),
    vaultAuthorityBump:     readU8(v, 72),
    lpMint:                 readPubkey(v, 73),
    totalUsdc:              readU64LE(v, 105),
    cumulativeFees:         readU64LE(v, 113),
    escrowedCollateralUsdc: readU64LE(v, 121),
    sumReservedUsdc:        readU64LE(v, 129),
    sumQueueOwedUsdc:       readU64LE(v, 137),
    engineAuth:             readPubkey(v, 145),
    engineAuthBump:         readU8(v, 177),
    insuranceFund:          readPubkey(v, 178),
    admin:                  readPubkey(v, 210),
    isPaused:               readBool(v, 242),
    reserveFactor:          readU64LE(v, 243),
    depositFeeBps:          readU16LE(v, 251),
    withdrawalFeeBps:       readU16LE(v, 253),
    bump:                   readU8(v, 255),
    sumSideBucketUsdc:      readU64LE(v, 256),
  };
}

// MarketRisk (LEN 199): disc[0..8] market_id[8..40] category_id[40..72]
//   reserved_usdc[72..80] reserve_factor[80..88] long_oi[88..96] short_oi[96..104]
//   max_oi_long[104..112] max_oi_short[112..120] off_hours_max_oi_long[120..128]
//   off_hours_max_oi_short[128..136] max_share_bps[136..138] side_bucket[138..146]
//   queue_head_idx[146..154] queue_tail_idx[154..162] queue_total_owed[162..170]
//   current_adl_epoch[170..174] last_adl_cut_idx[174..182] bump[182]
//   migration_old_lp_supply[183..191] migration_escrow_minted[191..199].
export function decodeMarketRisk(data: Buffer | Uint8Array): MarketRisk {
  checkDisc(data, DISCRIMINATORS.MarketRisk, "MarketRisk");
  if (data.byteLength !== 199) {
    throw new DecoderError(`MarketRisk: expected 199 bytes, got ${data.byteLength}`);
  }
  const v = makeView(data);
  return {
    marketId:              readBytes(v, 8, 32),
    categoryId:            readBytes(v, 40, 32),
    reservedUsdc:          readU64LE(v, 72),
    reserveFactor:         readU64LE(v, 80),
    longOi:                readU64LE(v, 88),
    shortOi:               readU64LE(v, 96),
    maxOiLong:             readU64LE(v, 104),
    maxOiShort:            readU64LE(v, 112),
    offHoursMaxOiLong:     readU64LE(v, 120),
    offHoursMaxOiShort:    readU64LE(v, 128),
    maxShareBps:           readU16LE(v, 136),
    sideBucket:            readU64LE(v, 138),
    queueHeadIdx:          readU64LE(v, 146),
    queueTailIdx:          readU64LE(v, 154),
    queueTotalOwed:        readU64LE(v, 162),
    currentAdlEpoch:       readU32LE(v, 170),
    lastAdlCutIdx:         readU64LE(v, 174),
    bump:                  readU8(v, 182),
    migrationOldLpSupply:  readU64LE(v, 183),
    migrationEscrowMinted: readU64LE(v, 191),
  };
}

/** Pool shape by discriminator — `"Legacy"` (PoolState) or `"Category"` (CategoryPool). */
export function poolShapeOf(data: Buffer | Uint8Array): "Legacy" | "Category" {
  const disc = Buffer.from(data.slice(0, 8));
  if (disc.equals(DISCRIMINATORS.PoolState)) return "Legacy";
  if (disc.equals(DISCRIMINATORS.CategoryPool)) return "Category";
  throw new DecoderError("poolShapeOf: unknown pool discriminator");
}

// ---------------------------------------------------------------------------
// Order decoder
// ---------------------------------------------------------------------------
//
// Byte layout (171 bytes total):
//   [0..8]     discriminator
//   [8..40]    owner: Pubkey
//   [40..72]   market_id: [u8; 32]
//   [72]       order_type: u8
//   [73]       side: u8
//   [74..82]   size_usdc: u64
//   [82..90]   collateral_usdc: u64
//   [90..98]   trigger_price: u64
//   [98..106]  acceptable_price: u64
//   [106..114] min_output_usdc: u64
//   [114..146] referral_code: [u8; 32]
//   [146..154] position_nonce: u64
//   [154..162] created_at: i64
//   [162..170] nonce: u64
//   [170]      bump: u8

export function decodeOrder(data: Buffer | Uint8Array): Order {
  checkDisc(data, DISCRIMINATORS.Order, "Order");
  checkMinLen(data, 171, "Order"); // #234 length-tolerant: >= so a tail append doesn't blind decoders
  const v = makeView(data);
  return {
    owner:           readPubkey(v, 8),
    marketId:        readBytes(v, 40, 32),
    orderType:       readOrderType(v, 72),
    side:            readSide(v, 73),
    sizeUsdc:        readU64LE(v, 74),
    collateralUsdc:  readU64LE(v, 82),
    triggerPrice:    readU64LE(v, 90),
    acceptablePrice: readU64LE(v, 98),
    minOutputUsdc:   readU64LE(v, 106),
    referralCode:    readBytes(v, 114, 32),
    positionNonce:   readU64LE(v, 146),
    createdAt:       readI64LE(v, 154),
    nonce:           readU64LE(v, 162),
    bump:            readU8(v, 170),
  };
}

// ---------------------------------------------------------------------------
// OrderNonce decoder
// ---------------------------------------------------------------------------
//
// Byte layout (49 bytes total):
//   [0..8]  discriminator
//   [8..40] owner: Pubkey
//   [40..48] nonce: u64
//   [48]    bump: u8

export function decodeOrderNonce(data: Buffer | Uint8Array): OrderNonce {
  checkDisc(data, DISCRIMINATORS.OrderNonce, "OrderNonce");
  checkLen(data, 49, "OrderNonce");
  const v = makeView(data);
  return {
    owner: readPubkey(v, 8),
    nonce: readU64LE(v, 40),
    bump:  readU8(v, 48),
  };
}

// ---------------------------------------------------------------------------
// TradingKey decoder
// ---------------------------------------------------------------------------
//
// Byte layout (81 bytes total):
//   [0..8]   discriminator
//   [8..40]  wallet: Pubkey
//   [40..72] delegate: Pubkey
//   [72..80] expires_at: i64
//   [80]     bump: u8

export function decodeTradingKey(data: Buffer | Uint8Array): TradingKey {
  checkDisc(data, DISCRIMINATORS.TradingKey, "TradingKey");
  checkLen(data, 81, "TradingKey");
  const v = makeView(data);
  return {
    wallet:    readPubkey(v, 8),
    delegate:  readPubkey(v, 40),
    expiresAt: readI64LE(v, 72),
    bump:      readU8(v, 80),
  };
}

// ---------------------------------------------------------------------------
// ReferralConfig decoder
// ---------------------------------------------------------------------------
//
// Byte layout (53 bytes total):
//   [0..8]   discriminator
//   [8..40]  admin: Pubkey
//   [40]     tiers[0].total_rebate_bps: u16  → bytes [40..42]
//   [42]     tiers[0].discount_share_pct: u8 → byte [42]
//   [43..45] tiers[1].total_rebate_bps: u16
//   [45]     tiers[1].discount_share_pct: u8
//   [46..48] tiers[2].total_rebate_bps: u16
//   [48]     tiers[2].discount_share_pct: u8
//   [49..51] tiers[3].total_rebate_bps: u16
//   [51]     tiers[3].discount_share_pct: u8
//   [52]     bump: u8
//
// 4 tiers × 3 bytes each = 12 bytes; 8 + 32 + 12 + 1 = 53

export function decodeReferralConfig(data: Buffer | Uint8Array): ReferralConfig {
  checkDisc(data, DISCRIMINATORS.ReferralConfig, "ReferralConfig");
  checkLen(data, 53, "ReferralConfig");
  const v = makeView(data);

  function readTier(offset: number): ReferralTier {
    return {
      totalRebateBps:   readU16LE(v, offset),
      discountSharePct: readU8(v, offset + 2),
    };
  }

  return {
    admin: readPubkey(v, 8),
    tiers: [
      readTier(40),
      readTier(43),
      readTier(46),
      readTier(49),
    ],
    bump: readU8(v, 52),
  };
}

// ---------------------------------------------------------------------------
// ReferralCode decoder
// ---------------------------------------------------------------------------
//
// Byte layout (74 bytes total):
//   [0..8]   discriminator
//   [8..40]  owner: Pubkey
//   [40..72] code: [u8; 32]
//   [72]     tier: u8
//   [73]     bump: u8

export function decodeReferralCode(data: Buffer | Uint8Array): ReferralCode {
  checkDisc(data, DISCRIMINATORS.ReferralCode, "ReferralCode");
  checkLen(data, 74, "ReferralCode");
  const v = makeView(data);
  return {
    owner: readPubkey(v, 8),
    code:  readBytes(v, 40, 32),
    tier:  readU8(v, 72),
    bump:  readU8(v, 73),
  };
}

// ---------------------------------------------------------------------------
// TraderReferral decoder
// ---------------------------------------------------------------------------
//
// Byte layout (73 bytes total):
//   [0..8]   discriminator
//   [8..40]  trader: Pubkey
//   [40..72] code: [u8; 32]
//   [72]     bump: u8

export function decodeTraderReferral(data: Buffer | Uint8Array): TraderReferral {
  checkDisc(data, DISCRIMINATORS.TraderReferral, "TraderReferral");
  checkLen(data, 73, "TraderReferral");
  const v = makeView(data);
  return {
    trader: readPubkey(v, 8),
    code:   readBytes(v, 40, 32),
    bump:   readU8(v, 72),
  };
}

// ---------------------------------------------------------------------------
// AffiliateReward decoder
// ---------------------------------------------------------------------------
//
// Byte layout (81 bytes total):
//   [0..8]   discriminator
//   [8..40]  affiliate: Pubkey
//   [40..72] market_id: [u8; 32]
//   [72..80] accrued_usdc: u64
//   [80]     bump: u8

export function decodeAffiliateReward(data: Buffer | Uint8Array): AffiliateReward {
  checkDisc(data, DISCRIMINATORS.AffiliateReward, "AffiliateReward");
  checkLen(data, 81, "AffiliateReward");
  const v = makeView(data);
  return {
    affiliate:   readPubkey(v, 8),
    marketId:    readBytes(v, 40, 32),
    accruedUsdc: readU64LE(v, 72),
    bump:        readU8(v, 80),
  };
}

// ---------------------------------------------------------------------------
// FeePool decoder
// ---------------------------------------------------------------------------
//
// Byte layout (215 bytes total):
//   [0..8]     discriminator
//   [8..40]    admin: Pubkey
//   [40..72]   perp_engine: Pubkey
//   [72..104]  usdc_account: Pubkey
//   [104..136] staking_reward: Pubkey
//   [136..168] treasury: Pubkey
//   [168..200] referral_reserve: Pubkey
//   [200..202] staker_split_bps: u16
//   [202..204] treasury_split_bps: u16
//   [204..206] referral_split_bps: u16
//   [206..214] total_distributed: u64
//   [214]      bump: u8

export function decodeFeePool(data: Buffer | Uint8Array): FeePool {
  checkDisc(data, DISCRIMINATORS.FeePool, "FeePool");
  checkLen(data, 215, "FeePool");
  const v = makeView(data);
  return {
    admin:            readPubkey(v, 8),
    perpEngine:       readPubkey(v, 40),
    usdcAccount:      readPubkey(v, 72),
    stakingReward:    readPubkey(v, 104),
    treasury:         readPubkey(v, 136),
    referralReserve:  readPubkey(v, 168),
    stakerSplitBps:   readU16LE(v, 200),
    treasurySplitBps: readU16LE(v, 202),
    referralSplitBps: readU16LE(v, 204),
    totalDistributed: readU64LE(v, 206),
    bump:             readU8(v, 214),
  };
}

// ---------------------------------------------------------------------------
// StakingPool decoder
// ---------------------------------------------------------------------------
//
// Byte layout (v1 = 282 bytes; v2 = 290 bytes — the 2026-06-08 freeze fix appends
// total_claimed: u64 at [282..290]):
//   [0..8]     discriminator
//   [8..40]    admin: Pubkey
//   [40..72]   token_mint: Pubkey
//   [72..104]  staked_vault: Pubkey
//   [104]      reward_source: u8
//   [105..137] reward_mint: Pubkey
//   [137..169] reward_vault: Pubkey
//   [169..201] reward_usdc: Pubkey
//   [201..217] total_weighted_stake: u128
//   [217..233] reward_index: u128
//   [233..241] total_rewards_distributed: u64
//   [241..249] total_allocation: u64
//   [249..257] start_ts: i64
//   [257..265] end_ts: i64
//   [265..273] emitted_so_far: u64
//   [273..281] last_update_ts: i64
//   [281]      bump: u8
//   [282..290] total_claimed: u64 (v2 only; 0 on pre-migration V1)

export function decodeStakingPool(data: Buffer | Uint8Array): StakingPool {
  checkDisc(data, DISCRIMINATORS.StakingPool, "StakingPool");
  // v1 (282) and v2 (290) both decode; mirrors decodePoolState's 240/252 pattern.
  if (data.byteLength !== 282 && data.byteLength !== 290) {
    throw new DecoderError(`StakingPool: expected 282 or 290 bytes, got ${data.byteLength}`);
  }
  const v = makeView(data);
  const hasTotalClaimed = data.byteLength >= 290;
  return {
    admin:                   readPubkey(v, 8),
    tokenMint:               readPubkey(v, 40),
    stakedVault:             readPubkey(v, 72),
    rewardSource:            readU8(v, 104),
    rewardMint:              readPubkey(v, 105),
    rewardVault:             readPubkey(v, 137),
    rewardUsdc:              readPubkey(v, 169),
    totalWeightedStake:      readU128LE(v, 201),
    rewardIndex:             readU128LE(v, 217),
    totalRewardsDistributed: readU64LE(v, 233),
    totalAllocation:         readU64LE(v, 241),
    startTs:                 readI64LE(v, 249),
    endTs:                   readI64LE(v, 257),
    emittedSoFar:            readU64LE(v, 265),
    lastUpdateTs:            readI64LE(v, 273),
    bump:                    readU8(v, 281),
    totalClaimed:            hasTotalClaimed ? readU64LE(v, 282) : 0n,
  };
}

// ---------------------------------------------------------------------------
// StakePosition decoder
// ---------------------------------------------------------------------------
//
// Byte layout (122 bytes total):
//   [0..8]     discriminator
//   [8..40]    pool: Pubkey
//   [40..72]   owner: Pubkey
//   [72..80]   amount: u64
//   [80]       lockup_tier: u8
//   [81..89]   lockup_expiry: i64
//   [89..97]   weighted_amount: u64
//   [97..113]  reward_index_snap: u128
//   [113..121] accrued_reward: u64
//   [121]      bump: u8

export function decodeStakePosition(data: Buffer | Uint8Array): StakePosition {
  checkDisc(data, DISCRIMINATORS.StakePosition, "StakePosition");
  checkLen(data, 122, "StakePosition");
  const v = makeView(data);
  return {
    pool:            readPubkey(v, 8),
    owner:           readPubkey(v, 40),
    amount:          readU64LE(v, 72),
    lockupTier:      readU8(v, 80),
    lockupExpiry:    readI64LE(v, 81),
    weightedAmount:  readU64LE(v, 89),
    rewardIndexSnap: readU128LE(v, 97),
    accruedReward:   readU64LE(v, 113),
    bump:            readU8(v, 121),
  };
}

// ---------------------------------------------------------------------------
// PayoutQueueEntry decoder
// ---------------------------------------------------------------------------
//
// Byte layout (98 bytes total):
//   [0..8]   discriminator
//   [8..40]  owner: Pubkey
//   [40..72] market_id: [u8; 32]
//   [72..80] idx: u64
//   [80..88] amount: u64
//   [88..96] enqueued_at: i64
//   [96]     status: u8    (0=Pending, 1=Harvested, 2=Voided)
//   [97]     bump: u8

export function decodePayoutQueueEntry(data: Buffer | Uint8Array): PayoutQueueEntry {
  checkDisc(data, DISCRIMINATORS.PayoutQueueEntry, "PayoutQueueEntry");
  checkLen(data, 98, "PayoutQueueEntry");
  const v = makeView(data);
  return {
    owner:      readPubkey(v, 8),
    marketId:   readBytes(v, 40, 32),
    idx:        readU64LE(v, 72),
    amount:     readU64LE(v, 80),
    enqueuedAt: readI64LE(v, 88),
    status:     readU8(v, 96),
    bump:       readU8(v, 97),
  };
}

// ---------------------------------------------------------------------------
// UserQueueClaims decoder
// ---------------------------------------------------------------------------
//
// Byte layout (97 bytes total):
//   [0..8]   discriminator
//   [8..40]  owner: Pubkey
//   [40..72] market_id: [u8; 32]
//   [72..80] unpaid_owed: u64
//   [80..88] collateral_drawn: u64
//   [88..96] phantom_unpaid_owed: u64
//   [96]     bump: u8

export function decodeUserQueueClaims(data: Buffer | Uint8Array): UserQueueClaims {
  checkDisc(data, DISCRIMINATORS.UserQueueClaims, "UserQueueClaims");
  checkLen(data, 97, "UserQueueClaims");
  const v = makeView(data);
  return {
    owner:             readPubkey(v, 8),
    marketId:          readBytes(v, 40, 32),
    unpaidOwed:        readU64LE(v, 72),
    collateralDrawn:   readU64LE(v, 80),
    phantomUnpaidOwed: readU64LE(v, 88),
    bump:              readU8(v, 96),
  };
}

// ---------------------------------------------------------------------------
// identifyAccountType helper
// ---------------------------------------------------------------------------

export type AccountTypeName =
  | "Position"
  | "MarketState"
  | "Order"
  | "OrderNonce"
  | "PoolState"
  | "TradingKey"
  | "ReferralConfig"
  | "ReferralCode"
  | "TraderReferral"
  | "AffiliateReward"
  | "FeePool"
  | "StakingPool"
  | "StakePosition"
  | "PayoutQueueEntry"
  | "UserQueueClaims";

/**
 * Identify the account type by matching the first 8 bytes against all known
 * discriminators. Returns null if no match is found.
 */
export function identifyAccountType(
  data: Buffer | Uint8Array
): AccountTypeName | null {
  if (data.byteLength < 8) return null;

  for (const [name, disc] of Object.entries(DISCRIMINATORS) as [
    AccountTypeName,
    Buffer,
  ][]) {
    let match = true;
    for (let i = 0; i < 8; i++) {
      if (data[i] !== disc[i]) {
        match = false;
        break;
      }
    }
    if (match) return name;
  }
  return null;
}
