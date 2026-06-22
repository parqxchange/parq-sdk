import { Keypair, PublicKey } from "@solana/web3.js";
import {
  insuranceFundPda,
  insuranceVaultAuthorityPda,
  insuranceVaultPda,
  lpConvertEscrowPDA,
  marketIdFromString,
  marketRiskPDA,
  payoutQueueEntryPDA,
  protocolConfigPDA,
  userQueueClaimsPDA,
} from "../src/utils/pda";

// Use the current pool-program ID from src/programs/pool.ts for reference.
// For determinism tests, the actual address value doesn't matter — we use a
// fixed well-known pubkey so tests are not coupled to deployment addresses.
const POOL_PROGRAM_ID = new PublicKey("CToWp8nRinkdYqbPZdcpevPi8rybDFRkHDUSUsJA2weX");

// Parquet perp-engine program ID (same on localnet/devnet/mainnet; declared in Anchor.toml).
const PERP_ENGINE_PROGRAM_ID = new PublicKey("6QrsMTMEu9rsLpyxQgRdvQsWoPgHGY9npNNiwTtXsbdc");

// Helper: build a 32-byte market ID from a string (matches marketIdFromString convention).
function mkMarketId(s: string): Uint8Array {
  const buf = new Uint8Array(32);
  buf.set(Buffer.from(s, "utf8").slice(0, 32));
  return buf;
}

// ---------------------------------------------------------------------------
// marketIdFromString
// ---------------------------------------------------------------------------

describe("marketIdFromString", () => {
  it("encodes a live-style lowercase id", () => {
    const id = marketIdFromString("aapl-usdc");
    expect(Buffer.from(id).subarray(0, 9).toString("utf8")).toBe("aapl-usdc");
  });

  it("throws when UTF-8 exceeds 32 bytes", () => {
    const s = "ä".repeat(17); // 2 bytes each => 34 UTF-8 bytes
    expect(() => marketIdFromString(s)).toThrow(/exceeds 32 bytes/);
  });
});

// ---------------------------------------------------------------------------
// lpConvertEscrowPDA (Phase-3 consolidation)
// ---------------------------------------------------------------------------

describe("lpConvertEscrowPDA", () => {
  it("is deterministic and derives from [b\"lp_convert_escrow\", marketId]", () => {
    const marketId = mkMarketId("aapl-usdc");
    const [pda, bump] = lpConvertEscrowPDA(marketId, POOL_PROGRAM_ID);
    const [again] = lpConvertEscrowPDA(marketId, POOL_PROGRAM_ID);
    const [expected, expBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("lp_convert_escrow"), Buffer.from(marketId)],
      POOL_PROGRAM_ID,
    );
    expect(pda.equals(expected)).toBe(true);
    expect(bump).toBe(expBump);
    expect(pda.equals(again)).toBe(true);
  });

  it("differs from the market_risk PDA for the same market", () => {
    const marketId = mkMarketId("nvda-usdc");
    const [escrow] = lpConvertEscrowPDA(marketId, POOL_PROGRAM_ID);
    const [risk] = marketRiskPDA(marketId, POOL_PROGRAM_ID);
    expect(escrow.equals(risk)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// payoutQueueEntryPDA
// ---------------------------------------------------------------------------

describe("payoutQueueEntryPDA", () => {
  it("derives consistently for same (marketId, idx)", () => {
    const marketId = mkMarketId("test-market");
    const [pda1] = payoutQueueEntryPDA(marketId, 42n, POOL_PROGRAM_ID);
    const [pda2] = payoutQueueEntryPDA(marketId, 42n, POOL_PROGRAM_ID);
    expect(pda1.equals(pda2)).toBe(true);
  });

  it("derives differently for different idx", () => {
    const marketId = mkMarketId("test-market");
    const [pda1] = payoutQueueEntryPDA(marketId, 42n, POOL_PROGRAM_ID);
    const [pda2] = payoutQueueEntryPDA(marketId, 43n, POOL_PROGRAM_ID);
    expect(pda1.equals(pda2)).toBe(false);
  });

  it("derives differently for different marketId", () => {
    const [pda1] = payoutQueueEntryPDA(mkMarketId("BPC157-USDC"), 0n, POOL_PROGRAM_ID);
    const [pda2] = payoutQueueEntryPDA(mkMarketId("TB500-USDC"), 0n, POOL_PROGRAM_ID);
    expect(pda1.equals(pda2)).toBe(false);
  });

  it("returns a canonical bump in [0, 255]", () => {
    const [, bump] = payoutQueueEntryPDA(mkMarketId("test-market"), 1n, POOL_PROGRAM_ID);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  it("accepts idx = 0n (boundary)", () => {
    const marketId = mkMarketId("test-market");
    const [pda1] = payoutQueueEntryPDA(marketId, 0n, POOL_PROGRAM_ID);
    const [pda2] = payoutQueueEntryPDA(marketId, 0n, POOL_PROGRAM_ID);
    expect(pda1.equals(pda2)).toBe(true);
  });

  it("handles all-zero marketId", () => {
    const marketId = new Uint8Array(32);
    const [pda1] = payoutQueueEntryPDA(marketId, 42n, POOL_PROGRAM_ID);
    const [pda2] = payoutQueueEntryPDA(marketId, 42n, POOL_PROGRAM_ID);
    expect(pda1.equals(pda2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// userQueueClaimsPDA
// ---------------------------------------------------------------------------

describe("userQueueClaimsPDA", () => {
  it("derives consistently for same (marketId, owner)", () => {
    const marketId = mkMarketId("test-market");
    const owner = Keypair.generate().publicKey;
    const [pda1] = userQueueClaimsPDA(marketId, owner, POOL_PROGRAM_ID);
    const [pda2] = userQueueClaimsPDA(marketId, owner, POOL_PROGRAM_ID);
    expect(pda1.equals(pda2)).toBe(true);
  });

  it("derives differently for different owner", () => {
    const marketId = mkMarketId("test-market");
    const owner1 = Keypair.generate().publicKey;
    const owner2 = Keypair.generate().publicKey;
    const [pda1] = userQueueClaimsPDA(marketId, owner1, POOL_PROGRAM_ID);
    const [pda2] = userQueueClaimsPDA(marketId, owner2, POOL_PROGRAM_ID);
    expect(pda1.equals(pda2)).toBe(false);
  });

  it("derives differently for different marketId", () => {
    const owner = Keypair.generate().publicKey;
    const [pda1] = userQueueClaimsPDA(mkMarketId("BPC157-USDC"), owner, POOL_PROGRAM_ID);
    const [pda2] = userQueueClaimsPDA(mkMarketId("TB500-USDC"), owner, POOL_PROGRAM_ID);
    expect(pda1.equals(pda2)).toBe(false);
  });

  it("returns a canonical bump in [0, 255]", () => {
    const owner = Keypair.generate().publicKey;
    const [, bump] = userQueueClaimsPDA(mkMarketId("test-market"), owner, POOL_PROGRAM_ID);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  it("payoutQueueEntry and userQueueClaims for same (marketId, owner) are different PDAs", () => {
    const marketId = mkMarketId("test-market");
    const owner = Keypair.generate().publicKey;
    const [entryPda] = payoutQueueEntryPDA(marketId, 0n, POOL_PROGRAM_ID);
    const [claimsPda] = userQueueClaimsPDA(marketId, owner, POOL_PROGRAM_ID);
    // Different seeds → different accounts
    expect(entryPda.equals(claimsPda)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// protocolConfigPDA
// ---------------------------------------------------------------------------

describe("protocolConfigPDA", () => {
  it("matches the deployed Parquet devnet ProtocolConfig PDA", () => {
    // Phase 1 (24/7 unlock) deployed the migrated ProtocolConfig at this
    // address. Locking the derivation here means a regression to the seeds
    // (`b"protocol_config"`) trips the test before reaching the cluster.
    const [pda, bump] = protocolConfigPDA(PERP_ENGINE_PROGRAM_ID);
    expect(pda.toBase58()).toBe("D4gk4oaJSEvBLW1Azo2Yr3AGzfNxEv1VzRRLMBCPQh6r");
    expect(bump).toBe(255);
  });

  it("derives deterministically for the same program ID", () => {
    const [pda1] = protocolConfigPDA(PERP_ENGINE_PROGRAM_ID);
    const [pda2] = protocolConfigPDA(PERP_ENGINE_PROGRAM_ID);
    expect(pda1.equals(pda2)).toBe(true);
  });

  it("derives differently for different program IDs", () => {
    const [pda1] = protocolConfigPDA(PERP_ENGINE_PROGRAM_ID);
    const [pda2] = protocolConfigPDA(POOL_PROGRAM_ID);
    expect(pda1.equals(pda2)).toBe(false);
  });

  it("returns a canonical bump in [0, 255]", () => {
    const [, bump] = protocolConfigPDA(PERP_ENGINE_PROGRAM_ID);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });
});

// ---------------------------------------------------------------------------
// insuranceFundPda / insuranceVaultPda / insuranceVaultAuthorityPda (WP-5)
// ---------------------------------------------------------------------------

describe("insuranceFundPda", () => {
  it("derives deterministically for the same program ID", () => {
    const [pda1] = insuranceFundPda(POOL_PROGRAM_ID);
    const [pda2] = insuranceFundPda(POOL_PROGRAM_ID);
    expect(pda1.equals(pda2)).toBe(true);
  });

  it("derives differently for different program IDs", () => {
    const [pda1] = insuranceFundPda(POOL_PROGRAM_ID);
    const [pda2] = insuranceFundPda(PERP_ENGINE_PROGRAM_ID);
    expect(pda1.equals(pda2)).toBe(false);
  });

  it("returns a canonical bump in [0, 255]", () => {
    const [, bump] = insuranceFundPda(POOL_PROGRAM_ID);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });
});

describe("insuranceVaultPda", () => {
  it("derives deterministically for the same program ID", () => {
    const [pda1] = insuranceVaultPda(POOL_PROGRAM_ID);
    const [pda2] = insuranceVaultPda(POOL_PROGRAM_ID);
    expect(pda1.equals(pda2)).toBe(true);
  });

  it("differs from insuranceFundPda for the same program ID (distinct seeds)", () => {
    const [fundPda] = insuranceFundPda(POOL_PROGRAM_ID);
    const [vaultPda] = insuranceVaultPda(POOL_PROGRAM_ID);
    expect(fundPda.equals(vaultPda)).toBe(false);
  });
});

describe("insuranceVaultAuthorityPda", () => {
  it("derives deterministically for the same program ID", () => {
    const [pda1] = insuranceVaultAuthorityPda(POOL_PROGRAM_ID);
    const [pda2] = insuranceVaultAuthorityPda(POOL_PROGRAM_ID);
    expect(pda1.equals(pda2)).toBe(true);
  });

  it("differs from insuranceVaultPda for the same program ID (distinct seeds)", () => {
    const [vaultPda] = insuranceVaultPda(POOL_PROGRAM_ID);
    const [authPda] = insuranceVaultAuthorityPda(POOL_PROGRAM_ID);
    expect(vaultPda.equals(authPda)).toBe(false);
  });
});
