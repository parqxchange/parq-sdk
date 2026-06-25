/**
 * Unified-LP-pool add/remove liquidity builders — account-wiring lock.
 *
 * deposit_category / withdraw_category move real USDC, so this pins the EXACT
 * account set + order PoolClient.{depositCategoryIx,withdrawCategoryIx} emit (a
 * regression here — e.g. a reordered/substituted account — could let a tx touch
 * the wrong account). The on-chain acceptance + the "USDC can't be redirected to
 * a third party" property are validated end-to-end against mainnet by
 * scripts/diagnostics/category-lp-roundtrip-sim.ts; this locks the off-chain wiring.
 *
 * Builds a real anchor.Program from the pool IDL (no RPC: `.instruction()` is
 * local when every account is passed explicitly, which these builders do).
 */
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import { PoolClient } from "../src/programs/pool";

const POOL = new PublicKey("Acme8JzWrvVqGJz7nTKVsLYisN6MtP83nrs4fVAeXJsN");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const POOL_IDL = require("../idl/pool_program.json");

function client(): PoolClient {
  const provider = new anchor.AnchorProvider(
    new Connection("http://localhost:8899"), // never dialed: .instruction() is offline
    new anchor.Wallet(Keypair.generate()),
    {},
  );
  return new PoolClient(new anchor.Program(POOL_IDL, provider) as any);
}

// Distinct sentinel pubkeys per account so a swap/substitution is detectable.
const A = {
  categoryPool: Keypair.generate().publicKey,
  usdcVault: Keypair.generate().publicKey,
  vaultAuthority: Keypair.generate().publicKey,
  lpMint: Keypair.generate().publicKey,
  userLp: Keypair.generate().publicKey,
  userUsdc: Keypair.generate().publicKey,
  lpDead: Keypair.generate().publicKey,
  user: Keypair.generate().publicKey,
};

describe("PoolClient.depositCategoryIx — account wiring", () => {
  it("emits the IDL account set in order, with token+system programs", async () => {
    const ix = await client().depositCategoryIx(
      {
        categoryPool: A.categoryPool,
        usdcVault: A.usdcVault,
        vaultAuthority: A.vaultAuthority,
        lpMint: A.lpMint,
        userLp: A.userLp,
        userUsdc: A.userUsdc,
        lpDead: A.lpDead,
        depositor: A.user,
      },
      { amount: 100_000_000n, minLpOut: 99_000_000n },
    );
    expect(ix.programId.equals(POOL)).toBe(true);
    const want = [
      A.categoryPool, A.usdcVault, A.vaultAuthority, A.lpMint, A.userLp,
      A.userUsdc, A.lpDead, A.user, TOKEN_PROGRAM_ID, SystemProgram.programId,
    ];
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual(want.map((p) => p.toBase58()));
    // depositor signs + pays; user_usdc + user_lp are writable (transfer/mint targets).
    const depositor = ix.keys[7];
    expect(depositor.pubkey.equals(A.user)).toBe(true);
    expect(depositor.isSigner).toBe(true);
    // args: disc(8) + amount u64 LE + min_lp_out u64 LE.
    const d = Buffer.from(ix.data);
    expect(d.length).toBe(24);
    expect(d.readBigUInt64LE(8)).toBe(100_000_000n);
    expect(d.readBigUInt64LE(16)).toBe(99_000_000n);
  });
});

describe("PoolClient.withdrawCategoryIx — account wiring", () => {
  it("emits the IDL account set in order (no lp_dead/system_program), withdrawer signs", async () => {
    const ix = await client().withdrawCategoryIx(
      {
        categoryPool: A.categoryPool,
        usdcVault: A.usdcVault,
        vaultAuthority: A.vaultAuthority,
        lpMint: A.lpMint,
        userLp: A.userLp,
        userUsdc: A.userUsdc,
        withdrawer: A.user,
      },
      { lpAmount: 50_000_000n, minOut: 49_750_000n },
    );
    expect(ix.programId.equals(POOL)).toBe(true);
    const want = [
      A.categoryPool, A.usdcVault, A.vaultAuthority, A.lpMint, A.userLp,
      A.userUsdc, A.user, TOKEN_PROGRAM_ID,
    ];
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual(want.map((p) => p.toBase58()));
    const withdrawer = ix.keys[6];
    expect(withdrawer.pubkey.equals(A.user)).toBe(true);
    expect(withdrawer.isSigner).toBe(true);
    // user_usdc is the proceeds destination — must be exactly what we passed (no substitution).
    expect(ix.keys[5].pubkey.equals(A.userUsdc)).toBe(true);
    const d = Buffer.from(ix.data);
    expect(d.length).toBe(24);
    expect(d.readBigUInt64LE(8)).toBe(50_000_000n);
    expect(d.readBigUInt64LE(16)).toBe(49_750_000n);
  });
});
