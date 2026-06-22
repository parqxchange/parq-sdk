/**
 * PERF-2 (discovered gap): the `updateMargin` action must be category-aware.
 *
 * The audit finding: the SDK `updateMargin` action hardcodes the legacy per-market
 * pool accounts (poolStatePDA / usdcVaultPDA / vaultAuthorityPDA) and never accepts
 * a `category` argument — so on the repointed (unified-LP-pool) venue a margin
 * add/remove tx carries the WRONG pool accounts and reverts `WrongPool` (8004).
 * The web margin path already swaps these via the low-level
 * `perpClient.updatePositionMarginIx` category branch (PositionDetail.tsx).
 *
 * This net asserts that `updateMargin`, given a non-null `category`, forwards:
 *   - the CATEGORY vault as the named `vaultUsdc`,
 *   - the CATEGORY vault authority as the named `vaultAuthority`,
 *   - the CATEGORY pool as the named `poolState`,
 *   - the per-market `engineAuth` UNCHANGED (legacy PDA — not signed for),
 *   - the `{ marketRisk, engineAuth }` builder arg (categoryBuilderArg) into the
 *     `updatePositionMarginIx` category positional slot,
 * and that with NO `category` the legacy per-market accounts flow through (so all
 * existing callers are unaffected — backward-compatible).
 *
 * Strategy mirrors `delegation-open.test.ts`: a stub PerpClient records the
 * accounts dict + the positional args `updatePositionMarginIx` receives; the action
 * does the PDA derivation, so the assertion is purely TS-side.
 */
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { updateMargin } from "../src/actions/trading";
import {
  poolStatePDA,
  usdcVaultPDA,
  vaultAuthorityPDA,
  engineAuthPDA,
} from "../src/utils/pda";
import type { CategoryTradeAccounts } from "../src/utils/category-shape";
import type { PerpClient } from "../src/programs/perp";

const PERP = new PublicKey("6QrsMTMEu9rsLpyxQgRdvQsWoPgHGY9npNNiwTtXsbdc");
const POOL = new PublicKey("11111111111111111111111111111112");
const ORACLE = new PublicKey("11111111111111111111111111111113");

/**
 * A stub PerpClient that captures the accounts dict + the positional args
 * `updatePositionMarginIx` is called with (delta, primaryFeed, secondaryFeed,
 * category, creditDelta).
 */
function stubClient(): {
  client: PerpClient;
  accounts: () => Record<string, unknown>;
  positional: () => unknown[];
} {
  let capturedAccounts: Record<string, unknown> = {};
  let capturedPositional: unknown[] = [];
  const client = {
    updatePositionMarginIx: async (
      accounts: Record<string, unknown>,
      ...rest: unknown[]
    ) => {
      capturedAccounts = accounts;
      capturedPositional = rest;
      return new TransactionInstruction({
        keys: [],
        programId: PublicKey.default,
        data: Buffer.alloc(0),
      });
    },
  } as unknown as PerpClient;
  return {
    client,
    accounts: () => capturedAccounts,
    positional: () => capturedPositional,
  };
}

const marketId = new Uint8Array(16).fill(9);
const owner = Keypair.generate().publicKey;
const signerUsdc = Keypair.generate().publicKey;
const primaryFeed = new PublicKey("11111111111111111111111111111114");
const secondaryFeed = new PublicKey("11111111111111111111111111111115");

const opts = {
  perpEngineId: PERP,
  poolProgramId: POOL,
  oracleProgramId: ORACLE,
  marketId,
  primaryFeedAccount: primaryFeed,
  secondaryFeedAccount: secondaryFeed,
};

// A synthetic CategoryPool account set (repointed market). Distinct pubkeys so the
// swap is unambiguous.
const categoryId = new Uint8Array(32).fill(7);
const category: CategoryTradeAccounts = {
  categoryId,
  categoryPool: PublicKey.unique(),
  categoryVault: PublicKey.unique(),
  categoryVaultAuthority: PublicKey.unique(),
  categoryLpMint: PublicKey.unique(),
  categoryFeeSettings: PublicKey.unique(),
  categoryEngineAuth: PublicKey.unique(),
  marketRisk: PublicKey.unique(),
};

describe("updateMargin category-awareness (PERF-2 discovered gap)", () => {
  const accounts = {
    position: PublicKey.unique(),
    owner,
    signer: owner,
    signerUsdc,
  };

  it("swaps to the CATEGORY pool/vault/vaultAuthority and forwards the builder arg when category is non-null", async () => {
    const { client, accounts: seen, positional } = stubClient();
    await updateMargin({ ...opts, perpClient: client }, accounts, 50_000n, category);

    const a = seen();
    // Named pool accounts swapped to the shared CategoryPool set.
    expect((a.poolState as PublicKey).equals(category.categoryPool)).toBe(true);
    expect((a.vaultUsdc as PublicKey).equals(category.categoryVault)).toBe(true);
    expect((a.vaultAuthority as PublicKey).equals(category.categoryVaultAuthority)).toBe(true);

    // engineAuth STAYS the legacy per-market PDA (unused-for-signing, like web).
    const [legacyEngineAuth] = engineAuthPDA(marketId, PERP);
    expect((a.engineAuth as PublicKey).equals(legacyEngineAuth)).toBe(true);

    // The { marketRisk, engineAuth } builder arg (categoryBuilderArg) lands in the
    // updatePositionMarginIx category positional slot:
    //   updatePositionMarginIx(accounts, delta, primary, secondary, category, creditDelta?)
    // → positional rest = [delta, primary, secondary, category, ...]
    const rest = positional();
    expect(rest[0]).toBe(50_000n);
    expect((rest[1] as PublicKey).equals(primaryFeed)).toBe(true);
    expect((rest[2] as PublicKey).equals(secondaryFeed)).toBe(true);
    const builderArg = rest[3] as { marketRisk: PublicKey; engineAuth: PublicKey };
    expect(builderArg).toBeTruthy();
    expect(builderArg.marketRisk.equals(category.marketRisk)).toBe(true);
    // categoryBuilderArg maps the CATEGORY engine_auth into the `engineAuth` field.
    expect(builderArg.engineAuth.equals(category.categoryEngineAuth)).toBe(true);
  });

  it("uses the legacy per-market pool accounts and passes NO category when category is null (backward-compatible)", async () => {
    const { client, accounts: seen, positional } = stubClient();
    await updateMargin({ ...opts, perpClient: client }, accounts, 50_000n, null);

    const a = seen();
    const [legacyPool] = poolStatePDA(marketId, POOL);
    const [legacyVault] = usdcVaultPDA(marketId, POOL);
    const [legacyVaultAuth] = vaultAuthorityPDA(marketId, POOL);
    expect((a.poolState as PublicKey).equals(legacyPool)).toBe(true);
    expect((a.vaultUsdc as PublicKey).equals(legacyVault)).toBe(true);
    expect((a.vaultAuthority as PublicKey).equals(legacyVaultAuth)).toBe(true);

    // No category builder arg in the positional slot (undefined).
    const rest = positional();
    expect(rest[3]).toBeUndefined();
  });

  it("defaults to legacy behavior when category is omitted entirely (existing callers)", async () => {
    const { client, accounts: seen, positional } = stubClient();
    await updateMargin({ ...opts, perpClient: client }, accounts, -25_000n);

    const a = seen();
    const [legacyPool] = poolStatePDA(marketId, POOL);
    expect((a.poolState as PublicKey).equals(legacyPool)).toBe(true);
    const rest = positional();
    expect(rest[0]).toBe(-25_000n);
    expect(rest[3]).toBeUndefined();
  });
});
