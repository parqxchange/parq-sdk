/**
 * Tests for the oracle-adapter + price-feed instruction builders:
 *   OracleClient.registerMarketOracleIx   (V2 — fixed for the #126 pyth-only work)
 *   OracleClient.updateMarketOracleFeedsIx (new)
 *   PriceFeedClient.setAdminIx             (new)
 *
 * Strategy mirrors pool-builders.test.ts: a minimal Anchor Program mock that
 * records the `.methods.<name>(args).accounts({...}).instruction()` chain and
 * synthesises a TransactionInstruction. We verify:
 *   1. Builder returns a TransactionInstruction.
 *   2. programId is the expected program's ID.
 *   3. Account list order (keys) matches the on-chain #[derive(Accounts)] order
 *      (programs/oracle-adapter/src/instructions/{register_market_oracle,
 *       update_market_oracle_feeds}.rs and
 *       programs/price-feed/src/instructions/set_admin.rs).
 *   4. Instruction data starts with the correct 8-byte Anchor discriminator.
 *
 * NOTE on discriminators: Anchor derives the discriminator from the
 * SNAKE_CASE instruction name (sha256("global:register_market_oracle")), but
 * the JS `.methods` accessor exposes camelCase method names. The SDK builders
 * therefore call `.registerMarketOracle(...)` etc.; the test mock receives the
 * camelCase method name and snake-cases it before hashing so the asserted
 * discriminator matches the real on-chain value.
 */

import { createHash } from "crypto";
import {
  AccountMeta,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { OracleClient } from "../src/programs/oracle";
import { PriceFeedClient } from "../src/programs/priceFeed";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** camelCase → snake_case (matches Anchor's IDL name normalisation). */
function toSnake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * Compute the 8-byte Anchor instruction discriminator for a camelCase method
 * name. Formula: sha256("global:<snake_case_name>")[0..8].
 */
function instructionDisc(camelName: string): Uint8Array {
  const hash = createHash("sha256").update(`global:${toSnake(camelName)}`).digest();
  return new Uint8Array(hash.buffer, hash.byteOffset, 8);
}

// Program IDs — canonical (sdk/src/utils/version.ts PROGRAM_IDS_V4).
const ORACLE_PROGRAM_ID = new PublicKey("6fsnWa9tcKcPiuQgdUbTMsiwUr43MNoxa1FECPFrvSpd");
const PRICE_FEED_PROGRAM_ID = new PublicKey("Dgorf5LPiMttdTxWcrsiA2j94kWKw55gJLRJm8P4E1Hn");

// ---------------------------------------------------------------------------
// Minimal Anchor Program mock (same shape as pool-builders.test.ts)
// ---------------------------------------------------------------------------

interface MockMethodsChain {
  accounts(accs: Record<string, PublicKey>): MockMethodsChain;
  instruction(): Promise<TransactionInstruction>;
}

function buildMockProgram(programId: PublicKey): {
  methods: Record<string, (...args: unknown[]) => MockMethodsChain>;
} {
  function makeChain(methodName: string): MockMethodsChain {
    let resolvedAccounts: AccountMeta[] = [];
    const chain: MockMethodsChain = {
      accounts(accs: Record<string, PublicKey>) {
        // Preserve insertion order — callers build the object in Anchor struct
        // order (the SDK contract).
        resolvedAccounts = Object.entries(accs).map(([, pk]) => ({
          pubkey: pk,
          isSigner: false,
          isWritable: false,
        }));
        return chain;
      },
      async instruction(): Promise<TransactionInstruction> {
        const data = Buffer.from(instructionDisc(methodName));
        return new TransactionInstruction({
          programId,
          keys: resolvedAccounts,
          data,
        });
      },
    };
    return chain;
  }

  const methods: Record<string, (...args: unknown[]) => MockMethodsChain> = new Proxy(
    {},
    {
      get(_target, prop: string) {
        return (..._args: unknown[]) => makeChain(prop);
      },
    },
  );

  return { methods };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const marketOracle = Keypair.generate().publicKey;
const admin = Keypair.generate().publicKey;
const oracleConfig = Keypair.generate().publicKey;
const feed = Keypair.generate().publicKey;
const currentAdmin = Keypair.generate().publicKey;
const primaryFeedAccount = Keypair.generate().publicKey;
const secondaryFeedAccount = Keypair.generate().publicKey;
const newAdmin = Keypair.generate().publicKey;

const marketId = (() => {
  const b = new Uint8Array(32);
  b.set(Buffer.from("AAPL", "utf8").slice(0, 32));
  return b;
})();

// ---------------------------------------------------------------------------
// OracleClient.registerMarketOracleIx (V2)
// ---------------------------------------------------------------------------

describe("OracleClient.registerMarketOracleIx", () => {
  let client: OracleClient;
  beforeEach(() => {
    const mock = buildMockProgram(ORACLE_PROGRAM_ID);
    client = new OracleClient(mock as unknown as import("@coral-xyz/anchor").Program);
  });

  const registerArgs = {
    marketId,
    primaryOracleType: "switchboard" as const,
    primaryFeedAccount,
    primaryMaxStalenessSecs: 120n,
    maxConfidencePct: 500,
    priceDecimals: 9,
  };
  const registerAccounts = { marketOracle, admin, oracleConfig };

  it("returns a TransactionInstruction with the oracle program ID", async () => {
    const ix = await client.registerMarketOracleIx(registerAccounts, registerArgs);
    expect(ix).toBeInstanceOf(TransactionInstruction);
    expect(ix.programId.equals(ORACLE_PROGRAM_ID)).toBe(true);
  });

  it("discriminator matches global:register_market_oracle sha256[0..8]", async () => {
    const ix = await client.registerMarketOracleIx(registerAccounts, registerArgs);
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(Array.from(instructionDisc("registerMarketOracle")));
  });

  it("account list order: marketOracle, admin, systemProgram, oracleConfig", async () => {
    const ix = await client.registerMarketOracleIx(registerAccounts, registerArgs);
    expect(ix.keys.length).toBe(4);
    expect(ix.keys[0]!.pubkey.equals(marketOracle)).toBe(true);
    expect(ix.keys[1]!.pubkey.equals(admin)).toBe(true);
    expect(ix.keys[2]!.pubkey.equals(SystemProgram.programId)).toBe(true);
    expect(ix.keys[3]!.pubkey.equals(oracleConfig)).toBe(true);
  });

  it("accepts pyth as the primary oracle type", async () => {
    const ix = await client.registerMarketOracleIx(registerAccounts, {
      ...registerArgs,
      primaryOracleType: "pyth",
    });
    expect(ix).toBeInstanceOf(TransactionInstruction);
    expect(ix.keys.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// OracleClient.updateMarketOracleFeedsIx
// ---------------------------------------------------------------------------

describe("OracleClient.updateMarketOracleFeedsIx", () => {
  let client: OracleClient;
  beforeEach(() => {
    const mock = buildMockProgram(ORACLE_PROGRAM_ID);
    client = new OracleClient(mock as unknown as import("@coral-xyz/anchor").Program);
  });

  const updateArgs = {
    primaryOracleType: "pyth" as const,
    primaryFeedAccount,
    primaryMaxStalenessSecs: 120n,
    secondaryOracleType: "switchboard" as const,
    secondaryFeedAccount,
    secondaryMaxStalenessSecs: 300n,
  };
  const updateAccounts = { marketOracle, admin };

  it("returns a TransactionInstruction with the oracle program ID", async () => {
    const ix = await client.updateMarketOracleFeedsIx(updateAccounts, updateArgs);
    expect(ix).toBeInstanceOf(TransactionInstruction);
    expect(ix.programId.equals(ORACLE_PROGRAM_ID)).toBe(true);
  });

  it("discriminator matches global:update_market_oracle_feeds sha256[0..8]", async () => {
    const ix = await client.updateMarketOracleFeedsIx(updateAccounts, updateArgs);
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(
      Array.from(instructionDisc("updateMarketOracleFeeds")),
    );
  });

  it("account list order: marketOracle, admin", async () => {
    const ix = await client.updateMarketOracleFeedsIx(updateAccounts, updateArgs);
    expect(ix.keys.length).toBe(2);
    expect(ix.keys[0]!.pubkey.equals(marketOracle)).toBe(true);
    expect(ix.keys[1]!.pubkey.equals(admin)).toBe(true);
  });

  it("supports secondary disabled via switchboard sentinel (both feeds present)", async () => {
    const ix = await client.updateMarketOracleFeedsIx(updateAccounts, {
      ...updateArgs,
      secondaryMaxStalenessSecs: 0n,
    });
    expect(ix).toBeInstanceOf(TransactionInstruction);
    expect(ix.keys.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// PriceFeedClient.setAdminIx
// ---------------------------------------------------------------------------

describe("PriceFeedClient.setAdminIx", () => {
  let client: PriceFeedClient;
  beforeEach(() => {
    const mock = buildMockProgram(PRICE_FEED_PROGRAM_ID);
    client = new PriceFeedClient(mock as unknown as import("@coral-xyz/anchor").Program);
  });

  const setAdminAccounts = { feed, currentAdmin };
  const setAdminArgs = { newAdmin };

  it("returns a TransactionInstruction with the price-feed program ID", async () => {
    const ix = await client.setAdminIx(setAdminAccounts, setAdminArgs);
    expect(ix).toBeInstanceOf(TransactionInstruction);
    expect(ix.programId.equals(PRICE_FEED_PROGRAM_ID)).toBe(true);
  });

  it("discriminator matches global:set_admin sha256[0..8]", async () => {
    const ix = await client.setAdminIx(setAdminAccounts, setAdminArgs);
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(Array.from(instructionDisc("setAdmin")));
  });

  it("account list order: feed, currentAdmin", async () => {
    const ix = await client.setAdminIx(setAdminAccounts, setAdminArgs);
    expect(ix.keys.length).toBe(2);
    expect(ix.keys[0]!.pubkey.equals(feed)).toBe(true);
    expect(ix.keys[1]!.pubkey.equals(currentAdmin)).toBe(true);
  });
});
