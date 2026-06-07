import { Connection, PublicKey } from "@solana/web3.js";
import { marketOraclePDA } from "../utils/pda";

/**
 * The on-chain `validate_and_read_price` CPI signature is
 * `[market_oracle, primary_feed, secondary_feed]`. Before the feed rotation,
 * both feeds resolve to the same `priceFeedPDA(market_id)`. After
 * `update_market_oracle_feeds` flips primary to a Pyth `PriceUpdateV2` account,
 * passing the PriceFeed PDA in both slots causes `FeedMismatch` on the primary
 * read — every open/close/liquidate reverts.
 *
 * This module reads `MarketOracle.{primary,secondary}_feed_account` directly
 * from the on-chain account so callers always pass the correct pubkeys
 * regardless of rotation state. Result is cached in-process to avoid one
 * extra round-trip per trade.
 *
 * V2 byte layout (`programs/oracle-adapter/src/state.rs` MarketOracle::LEN = 158):
 *   disc(8) market_id(32) admin(32) bump(1)
 *   | primary: oracle_type(1) feed_account(32) max_staleness_secs(8)
 *   | secondary: oracle_type(1) feed_account(32) max_staleness_secs(8)
 *   | max_confidence_pct(2) price_decimals(1)
 *
 * Pre-V2 MarketOracle PDAs (LEN_V1 = 117) refuse: callers must run
 * `migrate_market_oracle_v2` first.
 */

const PRIMARY_FEED_OFFSET = 8 + 32 + 32 + 1 + 1;
const SECONDARY_FEED_OFFSET = PRIMARY_FEED_OFFSET + 32 + 8 + 1;

/** On-chain `MarketOracle::LEN` — must read full tail including offsets 155–157. */
export const MARKET_ORACLE_V2_LEN = 158;

// V2 layout extended-field offsets (LEN = 158):
//   disc(8) market_id(32) admin(32) bump(1)
//   primary: oracle_type(1) feed_account(32) max_staleness_secs(8)
//   secondary: oracle_type(1) feed_account(32) max_staleness_secs(8)
//   max_confidence_pct(2) price_decimals(1)
const PRIMARY_ORACLE_TYPE_OFFSET   = 8 + 32 + 32 + 1;                            // 73
const PRIMARY_STALENESS_OFFSET     = PRIMARY_ORACLE_TYPE_OFFSET + 1 + 32;         // 106
const SECONDARY_ORACLE_TYPE_OFFSET = PRIMARY_STALENESS_OFFSET + 8;                // 114
const SECONDARY_STALENESS_OFFSET   = SECONDARY_ORACLE_TYPE_OFFSET + 1 + 32;       // 147
const MAX_CONF_PCT_OFFSET          = SECONDARY_STALENESS_OFFSET + 8;              // 155

export type OracleType = "switchboard" | "pyth";

export interface MarketOracleFeeds {
  primaryFeed: PublicKey;
  secondaryFeed: PublicKey;
  // Extended (additive — pre-existing callers compile unchanged):
  primaryOracleType: OracleType;
  secondaryOracleType: OracleType;
  primaryMaxStalenessSecs: number;
  secondaryMaxStalenessSecs: number;
  maxConfidencePctBps: number;
}

function oracleTypeAt(buf: Buffer, offset: number): OracleType {
  const v = buf.readUInt8(offset);
  if (v === 0) return "pyth";
  if (v === 1) return "switchboard";
  throw new Error(`MarketOracle unknown oracle_type byte: ${v}`);
}

const cache = new Map<string, MarketOracleFeeds>();

export function clearMarketOracleFeedsCache(): void {
  cache.clear();
}

/**
 * Read `MarketOracle.{primary,secondary}_feed_account` once and cache the result.
 *
 * Feeds rotate rarely (T5 mainnet flip is a one-shot operator action), so
 * caching is safe for the lifetime of a process / page. To pick up a rotation
 * without restart, call `clearMarketOracleFeedsCache()` explicitly.
 */
export async function getMarketOracleFeeds(
  connection: Connection,
  marketId: Uint8Array,
  oracleProgramId: PublicKey,
): Promise<MarketOracleFeeds> {
  const [marketOracle] = marketOraclePDA(marketId, oracleProgramId);
  const cacheKey = `${connection.rpcEndpoint}::${marketOracle.toBase58()}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const info = await connection.getAccountInfo(marketOracle);
  if (!info) {
    throw new Error(`MarketOracle PDA not found: ${marketOracle.toBase58()}`);
  }
  if (info.data.length < MARKET_ORACLE_V2_LEN) {
    throw new Error(
      `MarketOracle ${marketOracle.toBase58()} data too short for V2 layout ` +
        `(${info.data.length} < ${MARKET_ORACLE_V2_LEN} bytes); ` +
        "run migrate_market_oracle_v2 before dual-feed reads.",
    );
  }

  const buf = Buffer.isBuffer(info.data) ? info.data : Buffer.from(info.data);
  const feeds: MarketOracleFeeds = {
    primaryFeed: new PublicKey(buf.subarray(PRIMARY_FEED_OFFSET, PRIMARY_FEED_OFFSET + 32)),
    secondaryFeed: new PublicKey(buf.subarray(SECONDARY_FEED_OFFSET, SECONDARY_FEED_OFFSET + 32)),
    primaryOracleType: oracleTypeAt(buf, PRIMARY_ORACLE_TYPE_OFFSET),
    secondaryOracleType: oracleTypeAt(buf, SECONDARY_ORACLE_TYPE_OFFSET),
    primaryMaxStalenessSecs: Number(buf.readBigUInt64LE(PRIMARY_STALENESS_OFFSET)),
    secondaryMaxStalenessSecs: Number(buf.readBigUInt64LE(SECONDARY_STALENESS_OFFSET)),
    maxConfidencePctBps: buf.readUInt16LE(MAX_CONF_PCT_OFFSET),
  };
  cache.set(cacheKey, feeds);
  return feeds;
}

export interface DecodedFeedPrice {
  /** Price scaled to 1e9, matching the on-chain `finish()` return value. */
  price: bigint;
  /** Confidence scaled to 1e9. Switchboard PDAs emit 0 (off-chain gated). */
  confidence: bigint;
  /** Unix seconds. */
  timestamp: number;
}

/**
 * Decode a Pyth `PriceUpdateV2` account into the same (price, confidence, ts)
 * triple `validate_and_read_price` produces.
 *
 * Layout (matches on-chain `read_pyth` at programs/oracle-adapter/src/instructions/validate_and_read_price.rs:191):
 *   discriminator(8) write_authority(32) verification_level(1)
 *   feed_id(32)=41..73, price i64(8)=73..81, conf u64(8)=81..89,
 *   exponent i32(4)=89..93, publish_time i64(8)=93..101.
 */
export function decodePythPriceUpdate(data: Buffer | Uint8Array): DecodedFeedPrice {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < 101) {
    throw new Error(`Pyth PriceUpdateV2 too short: ${buf.length} < 101`);
  }
  const rawPrice = buf.readBigInt64LE(73);
  const rawConf = buf.readBigUInt64LE(81);
  const exponent = buf.readInt32LE(89);
  const timestamp = Number(buf.readBigInt64LE(93));

  if (exponent < -12 || exponent > 0) {
    throw new Error(`Pyth exponent out of range: ${exponent}`);
  }
  if (rawPrice <= 0n) {
    throw new Error(`Pyth raw_price not positive: ${rawPrice}`);
  }

  // Mirror the on-chain apply_exponent in validate_and_read_price.
  // diff = exponent - (-9); if diff >= 0 multiply by 10^diff, else divide by 10^-diff.
  const diff = exponent - -9;
  const price = applyExponent(rawPrice, diff);
  const confidence = applyExponent(rawConf, diff);
  return { price, confidence, timestamp };
}

/**
 * Decode our pusher-written `PriceFeed` PDA (legacy "Switchboard"-shaped
 * AggregatorAccountData layout) into the (price, confidence, ts) triple.
 *
 * Layout (matches the on-chain `read_switchboard` reader):
 *   mantissa i128(16)=4337..4353, scale u32(4)=4353..4357, timestamp i64(8)=4357..4365.
 * Confidence is hardcoded 0 (off-chain confidence gate).
 */
export function decodeSwitchboardPriceFeed(data: Buffer | Uint8Array): DecodedFeedPrice {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < 4365) {
    throw new Error(`PriceFeed PDA too short: ${buf.length} < 4365`);
  }
  // mantissa is i128 LE. Low 64 bits are unsigned bytes; only the high 64 bits
  // carry the sign. Reading the low half with readBigInt64LE would sign-extend
  // any high-bit-set value (e.g. low = 0xFFFF_FFFF_FFFF_FFFF) and corrupt the OR.
  // Mirror Rust's `i128::from_le_bytes(&data[4337..4353])`.
  const low = buf.readBigUInt64LE(4337);   // unsigned!
  const high = buf.readBigInt64LE(4345);   // signed
  const mantissa = (high << 64n) | low;
  if (mantissa <= 0n) {
    throw new Error(`PriceFeed mantissa not positive: ${mantissa}`);
  }
  const scale = buf.readUInt32LE(4353);
  const timestamp = Number(buf.readBigInt64LE(4357));

  // F-028 + read_switchboard:155-162 — convert mantissa to price@scale=1e9
  // via checked arithmetic. JS BigInt has no overflow, so the equivalent
  // guard is range-checking after the math.
  const absMantissa = mantissa < 0n ? -mantissa : mantissa;
  let price1e9: bigint;
  if (scale >= 9) {
    price1e9 = absMantissa / 10n ** BigInt(scale - 9);
  } else {
    price1e9 = absMantissa * 10n ** BigInt(9 - scale);
  }
  // u64 fit check (on-chain returns u64; matches consumer expectations).
  if (price1e9 > U64_MAX) {
    throw new Error(`PriceFeed price exceeds u64 range: ${price1e9}`);
  }
  return { price: price1e9, confidence: 0n, timestamp };
}

const U64_MAX = (1n << 64n) - 1n;

function applyExponent(value: bigint, diff: number): bigint {
  if (diff >= 0) {
    const result = value * 10n ** BigInt(diff);
    // Mirror on-chain checked_mul: validate_and_read_price.rs:221 errors on
    // overflow; JS BigInt has no overflow, so range-check after the multiply
    // for byte-for-byte fidelity.
    if (result > U64_MAX) {
      throw new Error(`Pyth apply_exponent overflow: ${result} > u64::MAX`);
    }
    return result;
  }
  // diff is negative; divide by 10^|diff|. BigInt division truncates toward zero,
  // matching Rust's u64/u64 integer division.
  return value / 10n ** BigInt(-diff);
}
