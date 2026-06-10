import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { PerpClient, OpenPositionArgs } from "../programs/perp";
import {
  marketStatePDA, positionPDA, engineAuthPDA, marketOraclePDA,
  poolStatePDA, vaultAuthorityPDA, usdcVaultPDA, feeSettingsPDA,
  userQueueClaimsPDA, lpMintPDA, insuranceFundPda, insuranceVaultPda,
} from "../utils/pda";

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
    traderReferral?:      PublicKey;
    /** UserQueueClaims PDA — required when args.fromQueueAmount > 0. */
    userClaims?:          PublicKey;
  },
  args: OpenPositionArgs,
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
      vaultUsdc,
      poolState,
      poolProgram: opts.poolProgramId,
      oracleProgram: opts.oracleProgramId,
      marketOracle,
      engineAuth,
      userClaims: accounts.userClaims ?? defaultUserClaims,
      feeSettings,
      referralConfig: accounts.referralConfig,
      referralCodeAccount: accounts.referralCodeAccount,
      traderReferral: accounts.traderReferral,
    },
    args,
    opts.primaryFeedAccount,
    opts.secondaryFeedAccount,
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
    traderReferral?:      PublicKey;
    /** PayoutQueueEntry at `pool.queueTailIdx` — pass for winning closes that may enqueue. */
    queueEntryPda?:       PublicKey;
    /** Position owner's `UserQueueClaims` PDA — pass with `queueEntryPda` for enqueue path. */
    userClaimsPda?:       PublicKey;
  },
  closeSize: bigint | null,
  minOutputUsdc?: bigint,
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
      poolState,
      poolProgram: opts.poolProgramId,
      oracleProgram: opts.oracleProgramId,
      marketOracle,
      vaultUsdc,
      vaultAuthority,
      engineAuth,
      feeSettings,
      referralConfig: accounts.referralConfig,
      referralCodeAccount: accounts.referralCodeAccount,
      traderReferral: accounts.traderReferral,
      lpMint,
      insuranceFund,
      insuranceVault,
    },
    closeSize,
    opts.primaryFeedAccount,
    opts.secondaryFeedAccount,
    minOutputUsdc,
    accounts.queueEntryPda,
    accounts.userClaimsPda,
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
