/**
 * Tests for PoolClient instruction builders: harvestIx, voidQueueClaimIx,
 * drainPhantomCreditIx.
 *
 * Strategy: construct a minimal Anchor Program mock that records the
 * instruction built by the `.methods` chain. We verify:
 *   1. Builder returns a TransactionInstruction.
 *   2. programId is the pool program's ID.
 *   3. Account list order (keys) matches the Anchor #[derive(Accounts)] order.
 *   4. Instruction data starts with the correct 8-byte Anchor discriminator.
 *
 * The mock avoids a live RPC connection by implementing only the subset of
 * the Anchor Program interface that PoolClient exercises.
 */

import { createHash } from "crypto";
import {
  AccountMeta,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PoolClient } from "../src/programs/pool";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the 8-byte Anchor instruction discriminator for a given method name.
 * Formula: sha256("global:<name>")[0..8]
 */
function instructionDisc(name: string): Uint8Array {
  const hash = createHash("sha256").update(`global:${name}`).digest();
  return new Uint8Array(hash.buffer, hash.byteOffset, 8);
}

// Pool program ID — matches the localnet address declared in Anchor.toml.
const POOL_PROGRAM_ID = new PublicKey("EM1Skk9SWipw2xWGyE42aMRmypS6XiiZSo8waK4RPXxq");

// ---------------------------------------------------------------------------
// Minimal Anchor Program mock
//
// PoolClient calls: this.program.methods.xxx(args).accounts({...})
//   [.remainingAccounts(...)].instruction()
//
// The mock implements just this chain. The `.instruction()` call synthesises a
// TransactionInstruction using the real Anchor discriminator and the accounts
// provided, so the test assertions are meaningful without a live program.
// ---------------------------------------------------------------------------

interface MockMethodsChain {
  accounts(accs: Record<string, PublicKey>): MockMethodsChain;
  remainingAccounts(accs: AccountMeta[]): MockMethodsChain;
  instruction(): Promise<TransactionInstruction>;
}

function buildMockProgram(programId: PublicKey): { methods: Record<string, (...args: unknown[]) => MockMethodsChain> } {
  function makeChain(methodName: string): MockMethodsChain {
    let resolvedAccounts: AccountMeta[] = [];
    let resolvedRemaining: AccountMeta[] = [];

    const chain: MockMethodsChain = {
      accounts(accs: Record<string, PublicKey>) {
        // Preserve insertion order of the accounts object — callers build the
        // object with fields in Anchor struct order (that's the SDK contract).
        resolvedAccounts = Object.entries(accs).map(([, pk]) => ({
          pubkey: pk,
          isSigner: false,
          isWritable: false,
        }));
        return chain;
      },
      remainingAccounts(accs: AccountMeta[]) {
        resolvedRemaining = accs;
        return chain;
      },
      async instruction(): Promise<TransactionInstruction> {
        const disc = instructionDisc(methodName);
        // Minimal 1-byte arg payload so data has > 8 bytes in realistic cases,
        // but for discriminator tests we only check the first 8.
        const data = Buffer.from(disc);
        return new TransactionInstruction({
          programId,
          keys: [...resolvedAccounts, ...resolvedRemaining],
          data,
        });
      },
    };
    return chain;
  }

  const methods: Record<string, (...args: unknown[]) => MockMethodsChain> = new Proxy({}, {
    get(_target, prop: string) {
      return (..._args: unknown[]) => makeChain(prop);
    },
  });

  return { methods };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const poolState    = Keypair.generate().publicKey;
const usdcVault    = Keypair.generate().publicKey;
const vaultAuth    = Keypair.generate().publicKey;
const caller       = Keypair.generate().publicKey;
const entry        = Keypair.generate().publicKey;
const userClaims   = Keypair.generate().publicKey;
const engineAuth   = Keypair.generate().publicKey;
const user         = Keypair.generate().publicKey;
const userUsdc     = Keypair.generate().publicKey;

let client: PoolClient;

beforeEach(() => {
  const mockProgram = buildMockProgram(POOL_PROGRAM_ID);
  // PoolClient constructor accepts `Program` — cast through unknown.
  client = new PoolClient(mockProgram as unknown as import("@coral-xyz/anchor").Program);
});

// ---------------------------------------------------------------------------
// harvestIx
// ---------------------------------------------------------------------------

describe("harvestIx", () => {
  const harvestAccounts = {
    poolState,
    usdcVault,
    vaultAuthority: vaultAuth,
    caller,
  };

  it("returns a TransactionInstruction", async () => {
    const ix = await client.harvestIx(harvestAccounts, 5, []);
    expect(ix).toBeInstanceOf(TransactionInstruction);
  });

  it("programId is the pool program ID", async () => {
    const ix = await client.harvestIx(harvestAccounts, 5, []);
    expect(ix.programId.equals(POOL_PROGRAM_ID)).toBe(true);
  });

  it("discriminator matches global:harvest sha256[0..8]", async () => {
    const ix = await client.harvestIx(harvestAccounts, 5, []);
    const expected = instructionDisc("harvest");
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(Array.from(expected));
  });

  it("account list order: poolState, usdcVault, vaultAuthority, caller, tokenProgram, systemProgram", async () => {
    const ix = await client.harvestIx(harvestAccounts, 5, []);
    // Fixed accounts (no remainingAccounts here).
    expect(ix.keys.length).toBe(6);
    expect(ix.keys[0]!.pubkey.equals(poolState)).toBe(true);
    expect(ix.keys[1]!.pubkey.equals(usdcVault)).toBe(true);
    expect(ix.keys[2]!.pubkey.equals(vaultAuth)).toBe(true);
    expect(ix.keys[3]!.pubkey.equals(caller)).toBe(true);
    expect(ix.keys[4]!.pubkey.equals(TOKEN_PROGRAM_ID)).toBe(true);
    expect(ix.keys[5]!.pubkey.equals(SystemProgram.programId)).toBe(true);
  });

  it("appends remainingAccounts triples after the fixed accounts", async () => {
    const entryPda  = Keypair.generate().publicKey;
    const claimsPda = Keypair.generate().publicKey;
    const userAta   = Keypair.generate().publicKey;
    const remaining: AccountMeta[] = [
      { pubkey: entryPda,  isSigner: false, isWritable: true },
      { pubkey: claimsPda, isSigner: false, isWritable: true },
      { pubkey: userAta,   isSigner: false, isWritable: true },
    ];

    const ix = await client.harvestIx(harvestAccounts, 1, remaining);
    // 6 fixed + 3 remaining = 9 total.
    expect(ix.keys.length).toBe(9);
    expect(ix.keys[6]!.pubkey.equals(entryPda)).toBe(true);
    expect(ix.keys[7]!.pubkey.equals(claimsPda)).toBe(true);
    expect(ix.keys[8]!.pubkey.equals(userAta)).toBe(true);
  });

  it("passes remainingAccounts through unchanged (two triples)", async () => {
    const makeTriple = (): AccountMeta[] => [
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
    ];
    const remaining = [...makeTriple(), ...makeTriple()];
    const ix = await client.harvestIx(harvestAccounts, 2, remaining);
    // 6 fixed + 6 remaining = 12.
    expect(ix.keys.length).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// voidQueueClaimIx
// ---------------------------------------------------------------------------

describe("voidQueueClaimIx", () => {
  const voidAccounts = {
    poolState,
    entry,
    userClaims,
    engineAuth,
  };

  it("returns a TransactionInstruction", async () => {
    const ix = await client.voidQueueClaimIx(voidAccounts);
    expect(ix).toBeInstanceOf(TransactionInstruction);
  });

  it("programId is the pool program ID", async () => {
    const ix = await client.voidQueueClaimIx(voidAccounts);
    expect(ix.programId.equals(POOL_PROGRAM_ID)).toBe(true);
  });

  it("discriminator matches global:voidQueueClaim sha256[0..8]", async () => {
    const ix = await client.voidQueueClaimIx(voidAccounts);
    const expected = instructionDisc("voidQueueClaim");
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(Array.from(expected));
  });

  it("account list order: poolState, entry, userClaims, engineAuth", async () => {
    const ix = await client.voidQueueClaimIx(voidAccounts);
    expect(ix.keys.length).toBe(4);
    expect(ix.keys[0]!.pubkey.equals(poolState)).toBe(true);
    expect(ix.keys[1]!.pubkey.equals(entry)).toBe(true);
    expect(ix.keys[2]!.pubkey.equals(userClaims)).toBe(true);
    expect(ix.keys[3]!.pubkey.equals(engineAuth)).toBe(true);
  });

  it("has exactly 4 accounts (no system/token programs needed)", async () => {
    const ix = await client.voidQueueClaimIx(voidAccounts);
    expect(ix.keys.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// drainPhantomCreditIx
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// initializeInsuranceFundIx (WP-5)
// ---------------------------------------------------------------------------

describe("initializeInsuranceFundIx", () => {
  const insuranceFund = Keypair.generate().publicKey;
  const insuranceVault = Keypair.generate().publicKey;
  const insuranceVaultAuth = Keypair.generate().publicKey;
  const usdcMint = Keypair.generate().publicKey;
  const payer = Keypair.generate().publicKey;
  const admin = Keypair.generate().publicKey;
  const RENT_SYSVAR = new PublicKey("SysvarRent111111111111111111111111111111111");

  const initAccounts = {
    insuranceFund,
    usdcVault: insuranceVault,
    vaultAuthority: insuranceVaultAuth,
    usdcMint,
    payer,
  };

  it("returns a TransactionInstruction with the pool program ID", async () => {
    const ix = await client.initializeInsuranceFundIx(initAccounts, { admin });
    expect(ix).toBeInstanceOf(TransactionInstruction);
    expect(ix.programId.equals(POOL_PROGRAM_ID)).toBe(true);
  });

  it("discriminator matches global:initializeInsuranceFund sha256[0..8]", async () => {
    const ix = await client.initializeInsuranceFundIx(initAccounts, { admin });
    const expected = instructionDisc("initializeInsuranceFund");
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(Array.from(expected));
  });

  it("account list order matches #[derive(Accounts)]: fund, vault, auth, mint, payer, tokenProgram, systemProgram, rent", async () => {
    const ix = await client.initializeInsuranceFundIx(initAccounts, { admin });
    expect(ix.keys.length).toBe(8);
    expect(ix.keys[0]!.pubkey.equals(insuranceFund)).toBe(true);
    expect(ix.keys[1]!.pubkey.equals(insuranceVault)).toBe(true);
    expect(ix.keys[2]!.pubkey.equals(insuranceVaultAuth)).toBe(true);
    expect(ix.keys[3]!.pubkey.equals(usdcMint)).toBe(true);
    expect(ix.keys[4]!.pubkey.equals(payer)).toBe(true);
    expect(ix.keys[5]!.pubkey.equals(TOKEN_PROGRAM_ID)).toBe(true);
    expect(ix.keys[6]!.pubkey.equals(SystemProgram.programId)).toBe(true);
    expect(ix.keys[7]!.pubkey.equals(RENT_SYSVAR)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// reimbursePoolFromFundIx (WP-5, D1)
// ---------------------------------------------------------------------------

describe("reimbursePoolFromFundIx", () => {
  const insuranceFund = Keypair.generate().publicKey;
  const insuranceVault = Keypair.generate().publicKey;
  const insuranceVaultAuth = Keypair.generate().publicKey;
  const poolVaultUsdc = Keypair.generate().publicKey;
  const admin = Keypair.generate().publicKey;

  const reimburseAccounts = {
    insuranceFund,
    poolState,
    poolVaultUsdc,
    insuranceVault,
    vaultAuthority: insuranceVaultAuth,
    admin,
  };

  it("returns a TransactionInstruction with the pool program ID", async () => {
    const ix = await client.reimbursePoolFromFundIx(reimburseAccounts, { amount: 1_000_000n });
    expect(ix).toBeInstanceOf(TransactionInstruction);
    expect(ix.programId.equals(POOL_PROGRAM_ID)).toBe(true);
  });

  it("discriminator matches global:reimbursePoolFromFund sha256[0..8]", async () => {
    const ix = await client.reimbursePoolFromFundIx(reimburseAccounts, { amount: 1_000_000n });
    const expected = instructionDisc("reimbursePoolFromFund");
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(Array.from(expected));
  });

  it("account list order: fund, poolState, poolVaultUsdc, insuranceVault, vaultAuth, admin, tokenProgram", async () => {
    const ix = await client.reimbursePoolFromFundIx(reimburseAccounts, { amount: 1_000_000n });
    expect(ix.keys.length).toBe(7);
    expect(ix.keys[0]!.pubkey.equals(insuranceFund)).toBe(true);
    expect(ix.keys[1]!.pubkey.equals(poolState)).toBe(true);
    expect(ix.keys[2]!.pubkey.equals(poolVaultUsdc)).toBe(true);
    expect(ix.keys[3]!.pubkey.equals(insuranceVault)).toBe(true);
    expect(ix.keys[4]!.pubkey.equals(insuranceVaultAuth)).toBe(true);
    expect(ix.keys[5]!.pubkey.equals(admin)).toBe(true);
    expect(ix.keys[6]!.pubkey.equals(TOKEN_PROGRAM_ID)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// withdrawInsuranceIx (WP-5)
// ---------------------------------------------------------------------------

describe("withdrawInsuranceIx", () => {
  const insuranceFund = Keypair.generate().publicKey;
  const insuranceVault = Keypair.generate().publicKey;
  const insuranceVaultAuth = Keypair.generate().publicKey;
  const destination = Keypair.generate().publicKey;
  const admin = Keypair.generate().publicKey;

  const withdrawAccounts = {
    insuranceFund,
    insuranceVault,
    destination,
    vaultAuthority: insuranceVaultAuth,
    admin,
  };

  it("returns a TransactionInstruction with the pool program ID", async () => {
    const ix = await client.withdrawInsuranceIx(withdrawAccounts, { amount: 500_000n });
    expect(ix).toBeInstanceOf(TransactionInstruction);
    expect(ix.programId.equals(POOL_PROGRAM_ID)).toBe(true);
  });

  it("discriminator matches global:withdrawInsurance sha256[0..8]", async () => {
    const ix = await client.withdrawInsuranceIx(withdrawAccounts, { amount: 500_000n });
    const expected = instructionDisc("withdrawInsurance");
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(Array.from(expected));
  });

  it("account list order: fund, insuranceVault, destination, vaultAuth, admin, tokenProgram", async () => {
    const ix = await client.withdrawInsuranceIx(withdrawAccounts, { amount: 500_000n });
    expect(ix.keys.length).toBe(6);
    expect(ix.keys[0]!.pubkey.equals(insuranceFund)).toBe(true);
    expect(ix.keys[1]!.pubkey.equals(insuranceVault)).toBe(true);
    expect(ix.keys[2]!.pubkey.equals(destination)).toBe(true);
    expect(ix.keys[3]!.pubkey.equals(insuranceVaultAuth)).toBe(true);
    expect(ix.keys[4]!.pubkey.equals(admin)).toBe(true);
    expect(ix.keys[5]!.pubkey.equals(TOKEN_PROGRAM_ID)).toBe(true);
  });
});

describe("drainPhantomCreditIx", () => {
  const drainAccounts = {
    poolState,
    usdcVault,
    vaultAuthority: vaultAuth,
    userClaims,
    user,
    userUsdc,
  };

  it("returns a TransactionInstruction", async () => {
    const ix = await client.drainPhantomCreditIx(drainAccounts);
    expect(ix).toBeInstanceOf(TransactionInstruction);
  });

  it("programId is the pool program ID", async () => {
    const ix = await client.drainPhantomCreditIx(drainAccounts);
    expect(ix.programId.equals(POOL_PROGRAM_ID)).toBe(true);
  });

  it("discriminator matches global:drainPhantomCredit sha256[0..8]", async () => {
    const ix = await client.drainPhantomCreditIx(drainAccounts);
    const expected = instructionDisc("drainPhantomCredit");
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(Array.from(expected));
  });

  it("account list order: poolState, usdcVault, vaultAuthority, userClaims, user, userUsdc, tokenProgram", async () => {
    const ix = await client.drainPhantomCreditIx(drainAccounts);
    expect(ix.keys.length).toBe(7);
    expect(ix.keys[0]!.pubkey.equals(poolState)).toBe(true);
    expect(ix.keys[1]!.pubkey.equals(usdcVault)).toBe(true);
    expect(ix.keys[2]!.pubkey.equals(vaultAuth)).toBe(true);
    expect(ix.keys[3]!.pubkey.equals(userClaims)).toBe(true);
    expect(ix.keys[4]!.pubkey.equals(user)).toBe(true);
    expect(ix.keys[5]!.pubkey.equals(userUsdc)).toBe(true);
    expect(ix.keys[6]!.pubkey.equals(TOKEN_PROGRAM_ID)).toBe(true);
  });
});
