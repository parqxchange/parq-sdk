import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  getMarketOracleFeeds,
  clearMarketOracleFeedsCache,
} from "../src/accounts/marketOracle";
import { marketOraclePDA } from "../src/utils/pda";

const ORACLE_PROGRAM_ID = new PublicKey("6fsnWa9tcKcPiuQgdUbTMsiwUr43MNoxa1FECPFrvSpd");

function mkMarketId(s: string): Uint8Array {
  const buf = new Uint8Array(32);
  buf.set(Buffer.from(s, "utf8").slice(0, 32));
  return buf;
}

// V2 layout (158 bytes total):
//   disc(8) market_id(32) admin(32) bump(1)
//   | primary: oracle_type(1) feed_account(32) max_staleness_secs(8)
//   | secondary: oracle_type(1) feed_account(32) max_staleness_secs(8)
//   | max_confidence_pct(2) price_decimals(1)
function buildV2MarketOracleData(args: {
  marketId: Uint8Array;
  admin: PublicKey;
  primaryFeed: PublicKey;
  secondaryFeed: PublicKey;
}): Buffer {
  const buf = Buffer.alloc(158);
  // disc(8) — zeros
  buf.set(args.marketId, 8);
  buf.set(args.admin.toBuffer(), 40);
  buf.writeUInt8(255, 72); // bump
  buf.writeUInt8(0, 73); // primary_oracle_type = Pyth
  buf.set(args.primaryFeed.toBuffer(), 74);
  buf.writeBigUInt64LE(60n, 106); // primary_max_staleness_secs
  buf.writeUInt8(1, 114); // secondary_oracle_type = Switchboard
  buf.set(args.secondaryFeed.toBuffer(), 115);
  buf.writeBigUInt64LE(300n, 147); // secondary_max_staleness_secs
  buf.writeUInt16LE(500, 155); // max_confidence_pct
  buf.writeUInt8(8, 157); // price_decimals
  return buf;
}

function makeMockConnection(
  data: Buffer | null,
  rpcEndpoint = "https://api.mainnet-beta.solana.com",
): Connection {
  return {
    rpcEndpoint,
    getAccountInfo: jest.fn().mockResolvedValue(
      data === null ? null : { data, executable: false, lamports: 1, owner: ORACLE_PROGRAM_ID, rentEpoch: 0 },
    ),
  } as unknown as Connection;
}

describe("getMarketOracleFeeds", () => {
  beforeEach(() => clearMarketOracleFeedsCache());

  it("decodes V2 primary + secondary feed accounts", async () => {
    const marketId = mkMarketId("AAPL");
    const primary = Keypair.generate().publicKey;
    const secondary = Keypair.generate().publicKey;
    const data = buildV2MarketOracleData({
      marketId,
      admin: new PublicKey("11111111111111111111111111111111"),
      primaryFeed: primary,
      secondaryFeed: secondary,
    });
    const conn = makeMockConnection(data);

    const feeds = await getMarketOracleFeeds(conn, marketId, ORACLE_PROGRAM_ID);
    expect(feeds.primaryFeed.equals(primary)).toBe(true);
    expect(feeds.secondaryFeed.equals(secondary)).toBe(true);
  });

  it("caches by RPC endpoint + MarketOracle PDA — second call doesn't hit the connection", async () => {
    const marketId = mkMarketId("MSFT");
    const primary = Keypair.generate().publicKey;
    const secondary = Keypair.generate().publicKey;
    const data = buildV2MarketOracleData({
      marketId,
      admin: new PublicKey("11111111111111111111111111111111"),
      primaryFeed: primary,
      secondaryFeed: secondary,
    });
    const conn = makeMockConnection(data);

    await getMarketOracleFeeds(conn, marketId, ORACLE_PROGRAM_ID);
    await getMarketOracleFeeds(conn, marketId, ORACLE_PROGRAM_ID);
    expect(conn.getAccountInfo).toHaveBeenCalledTimes(1);
  });

  it("clearMarketOracleFeedsCache() forces re-fetch", async () => {
    const marketId = mkMarketId("TSLA");
    const primary = Keypair.generate().publicKey;
    const secondary = Keypair.generate().publicKey;
    const data = buildV2MarketOracleData({
      marketId,
      admin: new PublicKey("11111111111111111111111111111111"),
      primaryFeed: primary,
      secondaryFeed: secondary,
    });
    const conn = makeMockConnection(data);

    await getMarketOracleFeeds(conn, marketId, ORACLE_PROGRAM_ID);
    clearMarketOracleFeedsCache();
    await getMarketOracleFeeds(conn, marketId, ORACLE_PROGRAM_ID);
    expect(conn.getAccountInfo).toHaveBeenCalledTimes(2);
  });

  it("throws when MarketOracle PDA does not exist", async () => {
    const marketId = mkMarketId("DOGE");
    const conn = makeMockConnection(null);
    const [pda] = marketOraclePDA(marketId, ORACLE_PROGRAM_ID);
    await expect(getMarketOracleFeeds(conn, marketId, ORACLE_PROGRAM_ID)).rejects.toThrow(
      `MarketOracle PDA not found: ${pda.toBase58()}`,
    );
  });

  it("throws on account shorter than MarketOracle::LEN (158) — marginal V2 buffers", async () => {
    const marketId = mkMarketId("EDGE");
    // 147 bytes: old V2_MIN_LEN gate passed but tail read at 155 would be unsafe
    const buf = Buffer.alloc(147);
    const conn = makeMockConnection(buf);
    await expect(getMarketOracleFeeds(conn, marketId, ORACLE_PROGRAM_ID)).rejects.toThrow(
      /147 < 158/,
    );
  });

  it("throws on pre-V2 (V1) layout — caller must run migrate_market_oracle_v2 first", async () => {
    const marketId = mkMarketId("OLD");
    const v1Data = Buffer.alloc(117);
    const conn = makeMockConnection(v1Data);
    await expect(getMarketOracleFeeds(conn, marketId, ORACLE_PROGRAM_ID)).rejects.toThrow(
      /117 < 158/,
    );
  });

  it("uses separate cache entries per RPC endpoint for the same market oracle", async () => {
    const marketId = mkMarketId("CACHE");
    const primary = Keypair.generate().publicKey;
    const secondary = Keypair.generate().publicKey;
    const data = buildV2MarketOracleData({
      marketId,
      admin: new PublicKey("11111111111111111111111111111111"),
      primaryFeed: primary,
      secondaryFeed: secondary,
    });
    const connA = makeMockConnection(data, "https://a.example.com");
    const connB = makeMockConnection(data, "https://b.example.com");

    await getMarketOracleFeeds(connA, marketId, ORACLE_PROGRAM_ID);
    await getMarketOracleFeeds(connB, marketId, ORACLE_PROGRAM_ID);
    expect(connA.getAccountInfo).toHaveBeenCalledTimes(1);
    expect(connB.getAccountInfo).toHaveBeenCalledTimes(1);
  });
});
