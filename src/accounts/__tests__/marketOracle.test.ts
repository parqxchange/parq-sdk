// Jest globals: describe/test/expect available without import

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodePythPriceUpdate, decodeSwitchboardPriceFeed, getMarketOracleFeeds, clearMarketOracleFeedsCache } from "../marketOracle";
import { Connection } from "@solana/web3.js";

const FIXTURES = join(__dirname, "fixtures");

function loadAccountData(file: string): Buffer {
  const raw = JSON.parse(readFileSync(join(FIXTURES, file), "utf-8"));
  return Buffer.from(raw.account.data[0], raw.account.data[1]);
}

test("decodePythPriceUpdate: AAPL mainnet fixture decodes to scale-1e9 price", () => {
  const data = loadAccountData("aapl-pyth-priceupdatev2.json");
  const out = decodePythPriceUpdate(data);
  // raw=31093500 @ exp=-5 → price = 31093500 * 10^4 = 310_935_000_000
  // raw_conf=3500 @ exp=-5 → conf = 35_000_000
  // publish_time=1779912022
  expect(out.price).toBe(310_935_000_000n);
  expect(out.confidence).toBe(35_000_000n);
  expect(out.timestamp).toBe(1779912022);
});

test("decodePythPriceUpdate: rejects buffer shorter than 101", () => {
  expect(() => decodePythPriceUpdate(Buffer.alloc(100))).toThrow(/too short/);
});

test("decodePythPriceUpdate: rejects exponent outside [-12, 0]", () => {
  const data = loadAccountData("aapl-pyth-priceupdatev2.json");
  const buf = Buffer.from(data);
  buf.writeInt32LE(-13, 89);
  expect(() => decodePythPriceUpdate(buf)).toThrow(/exponent out of range/);
  buf.writeInt32LE(1, 89);
  expect(() => decodePythPriceUpdate(buf)).toThrow(/exponent out of range/);
});

test("decodePythPriceUpdate: rejects raw_price <= 0", () => {
  const data = loadAccountData("aapl-pyth-priceupdatev2.json");
  const buf = Buffer.from(data);
  buf.writeBigInt64LE(0n, 73);
  expect(() => decodePythPriceUpdate(buf)).toThrow(/raw_price not positive/);
  buf.writeBigInt64LE(-1n, 73);
  expect(() => decodePythPriceUpdate(buf)).toThrow(/raw_price not positive/);
});

test("decodePythPriceUpdate: rejects applyExponent overflow on raw_conf", () => {
  // Mirror on-chain checked_mul. raw_conf near u64::MAX with positive exponent
  // diff would overflow u64; our TS check throws to keep parity.
  const data = loadAccountData("aapl-pyth-priceupdatev2.json");
  const buf = Buffer.from(data);
  buf.writeBigUInt64LE((1n << 60n), 81);  // raw_conf = 2^60
  buf.writeInt32LE(-3, 89);                // diff = -3 - (-9) = 6, so * 10^6 → 2^60 * 10^6 > 2^64
  expect(() => decodePythPriceUpdate(buf)).toThrow(/overflow/);
});

// ─── Task 3: decodeSwitchboardPriceFeed ───────────────────────────────────────

test("decodeSwitchboardPriceFeed: AAPL pusher fixture decodes to scale-1e9 price", () => {
  const data = loadAccountData("aapl-secondary-pricefeed.json");
  const out = decodeSwitchboardPriceFeed(data);
  // Pusher writes mantissa @ scale=2; price_1e9 = mantissa * 10^7.
  // Confidence is 0 (off-chain confidence gate).
  expect(out.confidence).toBe(0n);
  expect(out.price > 0n).toBeTruthy() /* price must be positive */;
  expect(out.timestamp > 1_700_000_000).toBeTruthy() /* timestamp must look unix-seconds-recent */;
});

test("decodeSwitchboardPriceFeed: rejects buffer shorter than 4365", () => {
  expect(() => decodeSwitchboardPriceFeed(Buffer.alloc(4364))).toThrow(/too short/);
});

test("decodeSwitchboardPriceFeed: rejects mantissa <= 0", () => {
  const data = loadAccountData("aapl-secondary-pricefeed.json");
  const buf = Buffer.from(data);
  // Zero out both halves of the i128 mantissa
  buf.writeBigInt64LE(0n, 4337);
  buf.writeBigInt64LE(0n, 4345);
  expect(() => decodeSwitchboardPriceFeed(buf)).toThrow(/mantissa not positive/);
});

test("decodeSwitchboardPriceFeed: low-half sign-bit safety (i128 reconstruction)", () => {
  // Regression: low 64 bits MUST be read as unsigned. If we used readBigInt64LE
  // on the low half, a value with the high bit set (like 0x8000_0000_0000_0000)
  // would sign-extend to a negative number and corrupt the OR with the high half.
  //
  // Example: low = 0x8000_0000_0000_0000n (= 2^63, the minimum positive i64 as unsigned)
  //   high = 0n  → correct mantissa  = (0n << 64n) | 2^63 = 2^63   (positive)
  //              → buggy   mantissa  = (0n << 64n) | (-2^63) = -2^63 (negative!)
  //
  // The buggy decoder would throw "mantissa not positive"; the fix passes through.
  const data = loadAccountData("aapl-secondary-pricefeed.json");
  const buf = Buffer.from(data);
  buf.writeBigUInt64LE(0x8000_0000_0000_0000n, 4337); // low = 2^63, high bit set
  buf.writeBigInt64LE(0n, 4345);                       // high = 0
  buf.writeUInt32LE(9, 4353);                          // scale=9 → price1e9 = 2^63 / 1 (within u64)
  buf.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), 4357);
  const out = decodeSwitchboardPriceFeed(buf);
  // Correct: mantissa = 2^63 → price1e9 = 9_223_372_036_854_775_808n
  // Buggy sign-extending decoder: would throw "mantissa not positive"
  expect(out.price).toBe(9_223_372_036_854_775_808n);
  expect(out.confidence).toBe(0n);
});

// ─── Task 4: getMarketOracleFeeds extended shape ──────────────────────────────

test("getMarketOracleFeeds: returns extended shape with oracle types + gates", async () => {
  clearMarketOracleFeedsCache();
  // Use a stub Connection that returns the captured AAPL MarketOracle V2 fixture
  // and intercepts the marketOraclePDA call.
  const raw = JSON.parse(readFileSync(join(FIXTURES, "aapl-marketoracle-v2.json"), "utf-8"));
  const data = Buffer.from(raw.account.data[0], raw.account.data[1]);
  const stubConnection = {
    getAccountInfo: async () => ({ data, owner: null, lamports: 0, executable: false }),
  } as unknown as Connection;
  // We pass dummy marketId + oracleProgramId; the stub doesn't gate on them.
  const { PublicKey } = await import("@solana/web3.js");
  const result = await getMarketOracleFeeds(
    stubConnection,
    new Uint8Array(32),
    new PublicKey(raw.pubkey),
  );
  expect(result.primaryOracleType).toBe("pyth");      // Production AAPL primary is Pyth
  expect(result.secondaryOracleType).toBe("switchboard");
  expect(result.primaryMaxStalenessSecs > 0).toBeTruthy();
  expect(result.secondaryMaxStalenessSecs > 0).toBeTruthy();
  expect(result.maxConfidencePctBps >= 0).toBeTruthy();
});
