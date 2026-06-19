import { PublicKey } from "@solana/web3.js";
import { poolShapeOf, decodeCategoryPool } from "../decode";
import {
  categoryVaultPDA,
  categoryVaultAuthorityPDA,
  categoryLpMintPDA,
  marketRiskPDA,
  engineAuthPDA,
  feeSettingsPDA,
} from "./pda";

/**
 * The full set of category-shape accounts a trade ix needs once a market has been
 * repointed into a unified `CategoryPool` (Phase-3 consolidation).
 *
 * Derivation note: `categoryFeeSettings` and `categoryEngineAuth` reuse the
 * `[b"fee_settings", id]` / `[b"engine_auth", id]` seed families with the
 * **category_id** as the seed (the perp-engine signs the category settle/enqueue
 * CPI with the category_id-seeded engine_auth — the per-market `engine_auth` cannot
 * serve a category market). `marketRisk` is the only per-market account here.
 */
export interface CategoryTradeAccounts {
  /** 32-byte category id read from the repointed CategoryPool bytes. */
  categoryId: Uint8Array;
  /** == the repointed `MarketState.pool_state` (the CategoryPool itself). */
  categoryPool: PublicKey;
  /** Shared USDC vault — pass as the named `vaultUsdc`. */
  categoryVault: PublicKey;
  /** Shared vault authority — pass as the named `vaultAuthority`. */
  categoryVaultAuthority: PublicKey;
  /** Category LP mint — pass as the named `lpMint` (close/liquidate). */
  categoryLpMint: PublicKey;
  /** [b"fee_settings", categoryId] — pass as `feeSettings` for close/executeOrder. */
  categoryFeeSettings: PublicKey;
  /** [b"engine_auth", categoryId] — the category signer at remaining_accounts[3]. */
  categoryEngineAuth: PublicKey;
  /** [b"market_risk", marketId] — read at remaining_accounts[2]. */
  marketRisk: PublicKey;
}

/**
 * Resolve every category account a trade ix needs from the FETCHED pool account
 * bytes. Returns `null` when the pool is still a legacy per-market `PoolState`
 * (the caller then builds the legacy-shape tx unchanged).
 *
 * Pure (no RPC) — the caller fetches `MarketState.pool_state` once and passes its
 * data + pubkey here. Shape is detected from the 8-byte discriminator, exactly as
 * the on-chain `pool_shape_of` does, so the off-chain build can never disagree with
 * the program about which branch will run.
 *
 * @param poolStateData   raw bytes of the account at MarketState.pool_state
 * @param poolStatePubkey that account's pubkey (becomes `categoryPool`)
 * @param marketId        32-byte per-market id (for the MarketRisk PDA)
 * @param poolProgramId   pool-program id
 * @param perpEngineId    perp-engine id (for the category engine_auth PDA)
 */
export function resolveCategoryTradeAccounts(
  poolStateData: Uint8Array | Buffer,
  poolStatePubkey: PublicKey,
  marketId: Uint8Array,
  poolProgramId: PublicKey,
  perpEngineId: PublicKey,
): CategoryTradeAccounts | null {
  if (poolShapeOf(poolStateData) !== "Category") return null;
  const categoryId = decodeCategoryPool(poolStateData).categoryId;
  return {
    categoryId,
    categoryPool:           poolStatePubkey,
    categoryVault:          categoryVaultPDA(categoryId, poolProgramId)[0],
    categoryVaultAuthority: categoryVaultAuthorityPDA(categoryId, poolProgramId)[0],
    categoryLpMint:         categoryLpMintPDA(categoryId, poolProgramId)[0],
    categoryFeeSettings:    feeSettingsPDA(categoryId, poolProgramId)[0],
    categoryEngineAuth:     engineAuthPDA(categoryId, perpEngineId)[0],
    marketRisk:             marketRiskPDA(marketId, poolProgramId)[0],
  };
}

/**
 * Narrow a {@link CategoryTradeAccounts} down to the `{ marketRisk, engineAuth }`
 * shape the perp `closePositionIx` / `liquidateIx` / `executeOrderIx` /
 * `updatePositionMarginIx` builders accept as their optional `category` argument.
 */
export function categoryBuilderArg(
  a: CategoryTradeAccounts,
): { marketRisk: PublicKey; engineAuth: PublicKey } {
  return { marketRisk: a.marketRisk, engineAuth: a.categoryEngineAuth };
}
