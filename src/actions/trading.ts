import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { PerpClient, OpenPositionArgs } from "../programs/perp";
import {
  marketStatePDA, positionPDA, engineAuthPDA, marketOraclePDA,
  poolStatePDA, vaultAuthorityPDA, usdcVaultPDA, feeSettingsPDA,
  userQueueClaimsPDA, lpMintPDA, insuranceFundPda, insuranceVaultPda,
} from "../utils/pda";
import { categoryBuilderArg, type CategoryTradeAccounts } from "../utils/category-shape";

export interface TradingOpts {
  perpClient:           PerpClient;
  perpEngineId:         PublicKey;
  poolProgramId:        PublicKey;
  oracleProgramId:      PublicKey;
  marketId:             Uint8Array;
  /** Oracle-adapter primary feed (Pyth in steady state). */
  primaryFeedAccount:   PublicKey;
  /** Oracle-adapter secondary feed (our PriceFeed PDA fallback). */
  secondaryFeedAccount: PublicKey;
}

/**
 * Build instructions to open a perpetual position.
 * @returns instructions (caller builds and signs the transaction)
 */
export async function openPosition(
  opts: TradingOpts,
  accounts: {
    signer:       PublicKey;
    signerUsdc:   PublicKey;
    tradingKey?:  PublicKey | null;
    referralConfig?:      PublicKey;
    referralCodeAccount?: PublicKey;
    /** #142: trader_referral Option<Account> — traderReferralPDA when a code applies, null/undefined otherwise. */
    traderReferral?:      PublicKey | null;
    /** UserQueueClaims PDA — required when args.fromQueueAmount > 0. */
    userClaims?:          PublicKey;
  },
  args: OpenPositionArgs,
  /**
   * Unified-LP-pool (Phase 3) category accounts, resolved by the caller via
   * `resolveCategoryTradeAccounts` (RPC). Pass non-null ONLY when the market has
   * been repointed to a CategoryPool — the named pool/vault/feeSettings are then
   * swapped to the shared category set and the pinned marketRisk@[2]/engineAuth@[3]
   * remaining accounts are carried. Null/undefined ⟹ legacy per-market shape.
   */
  category?: CategoryTradeAccounts | null,
): Promise<TransactionInstruction[]> {
  const [marketState]  = marketStatePDA(opts.marketId, opts.perpEngineId);
  const [position]     = positionPDA(accounts.signer, opts.marketId, args.positionNonce, opts.perpEngineId);
  const [engineAuth]   = engineAuthPDA(opts.marketId, opts.perpEngineId);
  const [marketOracle] = marketOraclePDA(opts.marketId, opts.oracleProgramId);
  const [poolState]    = poolStatePDA(opts.marketId, opts.poolProgramId);
  const [vaultUsdc]    = usdcVaultPDA(opts.marketId, opts.poolProgramId);
  const [feeSettings]  = feeSettingsPDA(opts.marketId, opts.poolProgramId);
  // user_claims is `#[account(mut)]` on open_position even when from_queue_amount
  // == 0 (Anchor needs writability for the optional apply_queue_collateral_draw
  // CPI). SystemProgram.programId fails the mut check, so always derive the
  // canonical PDA — it just sits unused if from_queue_amount is 0.
  const [defaultUserClaims] = userQueueClaimsPDA(opts.marketId, accounts.signer, opts.poolProgramId);

  const ix = await opts.perpClient.openPositionIx(
    {
      marketState,
      position,
      tradingKey: accounts.tradingKey ?? null,
      signer: accounts.signer,
      signerUsdc: accounts.signerUsdc,
      // Category: swap the named pool/vault/feeSettings to the shared CategoryPool
      // set (engineAuth stays the legacy per-market account, unused-for-signing).
      vaultUsdc: category ? category.categoryVault : vaultUsdc,
      poolState: category ? category.categoryPool : poolState,
      poolProgram: opts.poolProgramId,
      oracleProgram: opts.oracleProgramId,
      marketOracle,
      engineAuth,
      userClaims: accounts.userClaims ?? defaultUserClaims,
      feeSettings: category ? category.categoryFeeSettings : feeSettings,
      referralConfig: accounts.referralConfig,
      referralCodeAccount: accounts.referralCodeAccount,
      traderReferral: accounts.traderReferral,
    },
    args,
    opts.primaryFeedAccount,
    opts.secondaryFeedAccount,
    category ? categoryBuilderArg(category) : undefined,
  );

  return [ix];
}

/**
 * Build instructions to close a perpetual position (full or partial).
 *
 * IMPORTANT (H-4 fix): `owner` is the wallet that receives the net return.
 * When using delegation, pass the wallet owner (not the delegate) as `owner`
 * so funds go to the correct USDC ATA.
 *
 * @param accounts.position - position PDA (caller must provide)
 * @param accounts.owner - receives net return USDC
 * @param accounts.signer - owner or delegate who signs
 */
export async function closePosition(
  opts: TradingOpts,
  accounts: {
    position:    PublicKey;
    owner:       PublicKey;
    signer:      PublicKey;
    userUsdc:    PublicKey;
    tradingKey?: PublicKey | null;
    referralConfig?:      PublicKey;
    referralCodeAccount?: PublicKey;
    /** #142: trader_referral Option<Account> — traderReferralPDA when a code applies, null/undefined otherwise. */
    traderReferral?:      PublicKey | null;
    /** PayoutQueueEntry at `pool.queueTailIdx` — pass for winning closes that may enqueue. */
    queueEntryPda?:       PublicKey;
    /** Position owner's `UserQueueClaims` PDA — pass with `queueEntryPda` for enqueue path. */
    userClaimsPda?:       PublicKey;
  },
  closeSize: bigint | null,
  minOutputUsdc?: bigint,
  /**
   * Unified-LP-pool (Phase 3) category accounts (see `openPosition`). When non-null
   * the named pool/vault/vaultAuthority/feeSettings/lpMint are swapped to the shared
   * CategoryPool set and the pinned marketRisk@[2]/engineAuth@[3] pair is carried.
   * The caller still passes the per-market `queueEntryPda`/`userClaimsPda` (both
   * shapes seed those per-market); for a category market the tail index comes from
   * `MarketRisk.queueTailIdx`, not `PoolState.queueTailIdx`.
   */
  category?: CategoryTradeAccounts | null,
): Promise<TransactionInstruction[]> {
  const [marketState]    = marketStatePDA(opts.marketId, opts.perpEngineId);
  const [engineAuth]     = engineAuthPDA(opts.marketId, opts.perpEngineId);
  const [marketOracle]   = marketOraclePDA(opts.marketId, opts.oracleProgramId);
  const [poolState]      = poolStatePDA(opts.marketId, opts.poolProgramId);
  const [vaultAuthority] = vaultAuthorityPDA(opts.marketId, opts.poolProgramId);
  const [vaultUsdc]      = usdcVaultPDA(opts.marketId, opts.poolProgramId);
  const [feeSettings]    = feeSettingsPDA(opts.marketId, opts.poolProgramId);
  // Forwarded to pool-program for no-LP insurance routing.
  const [lpMint]         = lpMintPDA(opts.marketId, opts.poolProgramId);
  const [insuranceFund]  = insuranceFundPda(opts.poolProgramId);
  const [insuranceVault] = insuranceVaultPda(opts.poolProgramId);

  const ix = await opts.perpClient.closePositionIx(
    {
      marketState,
      position: accounts.position,
      tradingKey: accounts.tradingKey ?? null,
      signer: accounts.signer,
      owner: accounts.owner,
      userUsdc: accounts.userUsdc,
      // Category: swap pool/vault/vaultAuthority/feeSettings/lpMint to the shared
      // CategoryPool set (engineAuth stays the legacy per-market account).
      poolState: category ? category.categoryPool : poolState,
      poolProgram: opts.poolProgramId,
      oracleProgram: opts.oracleProgramId,
      marketOracle,
      vaultUsdc: category ? category.categoryVault : vaultUsdc,
      vaultAuthority: category ? category.categoryVaultAuthority : vaultAuthority,
      engineAuth,
      feeSettings: category ? category.categoryFeeSettings : feeSettings,
      referralConfig: accounts.referralConfig,
      referralCodeAccount: accounts.referralCodeAccount,
      traderReferral: accounts.traderReferral,
      lpMint: category ? category.categoryLpMint : lpMint,
      insuranceFund,
      insuranceVault,
    },
    closeSize,
    opts.primaryFeedAccount,
    opts.secondaryFeedAccount,
    minOutputUsdc,
    accounts.queueEntryPda,
    accounts.userClaimsPda,
    category ? categoryBuilderArg(category) : undefined,
  );

  return [ix];
}

/**
 * Build instructions to update position margin (add or remove collateral).
 * @param delta - positive to add margin, negative to remove (USDC 6-decimal units)
 */
export async function updateMargin(
  opts: TradingOpts,
  accounts: {
    position:    PublicKey;
    owner:       PublicKey;
    signer:      PublicKey;
    signerUsdc:  PublicKey;
    tradingKey?: PublicKey | null;
  },
  delta: bigint,
): Promise<TransactionInstruction[]> {
  const [marketState]    = marketStatePDA(opts.marketId, opts.perpEngineId);
  const [vaultUsdc]      = usdcVaultPDA(opts.marketId, opts.poolProgramId);
  const [engineAuth]     = engineAuthPDA(opts.marketId, opts.perpEngineId);
  const [poolState]      = poolStatePDA(opts.marketId, opts.poolProgramId);
  const [vaultAuthority] = vaultAuthorityPDA(opts.marketId, opts.poolProgramId);
  const [marketOracle]   = marketOraclePDA(opts.marketId, opts.oracleProgramId);

  const ix = await opts.perpClient.updatePositionMarginIx(
    {
      marketState,
      position: accounts.position,
      tradingKey: accounts.tradingKey ?? null,
      signer: accounts.signer,
      owner: accounts.owner,
      signerUsdc: accounts.signerUsdc,
      vaultUsdc,
      userUsdc: accounts.signerUsdc,
      vaultAuthority,
      poolState,
      poolProgram: opts.poolProgramId,
      engineAuth,
      oracleProgram: opts.oracleProgramId,
      marketOracle,
    },
    delta,
    opts.primaryFeedAccount,
    opts.secondaryFeedAccount,
  );

  return [ix];
}
