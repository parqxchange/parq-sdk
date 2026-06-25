import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  marketStatePDA, positionPDA, engineAuthPDA, marketOraclePDA,
  poolStatePDA, vaultAuthorityPDA, usdcVaultPDA, lpMintPDA,
  feeSettingsPDA,
  insuranceFundPda, insuranceVaultPda,
} from "../utils/pda";

export interface ProgramIds {
  perpEngineId:       PublicKey;
  poolProgramId:      PublicKey;
  oracleProgramId:    PublicKey;
  priceFeedProgramId: PublicKey;
}

const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");

/**
 * Resolve all accounts needed for open_position.
 *
 * IMPORTANT — Delegation behavior:
 * The Position PDA is derived from `signer`, not `owner`. When using a trading key,
 * the delegate's pubkey is embedded in the PDA seeds. This means:
 * 1. The position is "owned by" the delegate on-chain (position.owner = signer)
 * 2. Only the delegate can close it
 * 3. On close, funds are sent to `owner`'s USDC ATA (the wallet that registered the trading key)
 *
 * @param marketId     - 32-byte market identifier
 * @param signer       - transaction signer (owner or delegate)
 * @param nonce        - u64 position nonce (determines position PDA)
 * @param usdcMint     - USDC mint address
 * @param primaryFeedAccount   - oracle-adapter primary feed (e.g. Pyth `PriceUpdateV2` in RTH)
 * @param secondaryFeedAccount - oracle-adapter secondary feed (pusher-written `PriceFeed` PDA)
 * @param programs     - program IDs
 * @param tradingKeyPda         - optional trading key PDA (null if not delegating)
 * @param referralConfig        - optional referral config PDA (defaults to SYSTEM_PROGRAM)
 * @param referralCodeAccount   - optional referral code PDA (defaults to SYSTEM_PROGRAM)
 * @param traderReferral        - optional trader referral PDA (#142: durable-binding
 *   `Option<Account>` — pass the `traderReferralPDA` when a code applies, defaults to
 *   `null` (None) for no referral; NOT the SYSTEM_PROGRAM sentinel)
 */
export function resolveOpenPositionAccounts(
  marketId: Uint8Array,
  signer: PublicKey,
  nonce: bigint,
  usdcMint: PublicKey,
  primaryFeedAccount: PublicKey,
  secondaryFeedAccount: PublicKey,
  programs: ProgramIds,
  tradingKeyPda?: PublicKey | null,
  referralConfig?: PublicKey,
  referralCodeAccount?: PublicKey,
  traderReferral?: PublicKey | null,
): {
  accounts: {
    marketState:        PublicKey;
    position:           PublicKey;
    engineAuth:         PublicKey;
    marketOracle:       PublicKey;
    poolState:          PublicKey;
    vaultUsdc:          PublicKey;
    signerUsdc:         PublicKey;
    feeSettings:        PublicKey;
    tradingKey:         PublicKey | null;
    referralConfig:     PublicKey;
    referralCodeAccount: PublicKey;
    traderReferral:     PublicKey | null;
    poolProgram:        PublicKey;
    oracleProgram:      PublicKey;
  };
  primaryFeedAccount: PublicKey;
  secondaryFeedAccount: PublicKey;
} {
  const [marketState]  = marketStatePDA(marketId, programs.perpEngineId);
  const [position]     = positionPDA(signer, marketId, nonce, programs.perpEngineId);
  const [engineAuth]   = engineAuthPDA(marketId, programs.perpEngineId);
  const [marketOracle] = marketOraclePDA(marketId, programs.oracleProgramId);
  const [poolState]    = poolStatePDA(marketId, programs.poolProgramId);
  const [vaultUsdc]    = usdcVaultPDA(marketId, programs.poolProgramId);
  const signerUsdc     = getAssociatedTokenAddressSync(usdcMint, signer);
  const [feeSettings]  = feeSettingsPDA(marketId, programs.poolProgramId);

  return {
    accounts: {
      marketState,
      position,
      engineAuth,
      marketOracle,
      poolState,
      vaultUsdc,
      signerUsdc,
      feeSettings,
      tradingKey:          tradingKeyPda ?? null,
      referralConfig:      referralConfig      ?? SYSTEM_PROGRAM,
      referralCodeAccount: referralCodeAccount ?? SYSTEM_PROGRAM,
      // #142: trader_referral is an Option<Account> (durable binding) — None ⟹ null,
      // NOT the SystemProgram sentinel (referral_config/referral_code keep the sentinel).
      traderReferral:      traderReferral      ?? null,
      poolProgram:         programs.poolProgramId,
      oracleProgram:       programs.oracleProgramId,
    },
    primaryFeedAccount,
    secondaryFeedAccount,
  };
}

/**
 * Resolve all accounts needed for close_position.
 *
 * The caller must supply the `position` PDA directly because a single (signer, market)
 * pair can have multiple positions at different nonces — the resolver has no way to
 * determine which nonce is intended without additional context.
 *
 * H-4 fix: `userUsdc` is derived from `owner` (the wallet receiving funds), NOT from
 * `signer` (the delegate). This ensures the net return is sent to the correct ATA even
 * when a trading key delegate is signing the transaction.
 *
 * @param marketId   - 32-byte market identifier
 * @param owner      - wallet that receives the net return USDC
 * @param signer     - transaction signer (owner or delegate)
 * @param position   - position PDA (caller-provided; use positionPDA() with the correct nonce)
 * @param usdcMint   - USDC mint address
 * @param primaryFeedAccount   - oracle-adapter primary feed
 * @param secondaryFeedAccount - oracle-adapter secondary feed
 * @param programs   - program IDs
 * @param tradingKeyPda         - optional trading key PDA (null if not delegating)
 * @param referralConfig        - optional referral config PDA (defaults to SYSTEM_PROGRAM)
 * @param referralCodeAccount   - optional referral code PDA (defaults to SYSTEM_PROGRAM)
 * @param traderReferral        - optional trader referral PDA (#142: durable-binding
 *   `Option<Account>` — pass the `traderReferralPDA` when a code applies, defaults to
 *   `null` (None) for no referral; NOT the SYSTEM_PROGRAM sentinel)
 */
export function resolveClosePositionAccounts(
  marketId: Uint8Array,
  owner: PublicKey,
  signer: PublicKey,
  position: PublicKey,
  usdcMint: PublicKey,
  primaryFeedAccount: PublicKey,
  secondaryFeedAccount: PublicKey,
  programs: ProgramIds,
  tradingKeyPda?: PublicKey | null,
  referralConfig?: PublicKey,
  referralCodeAccount?: PublicKey,
  traderReferral?: PublicKey | null,
): {
  accounts: {
    marketState:         PublicKey;
    position:            PublicKey;
    engineAuth:          PublicKey;
    marketOracle:        PublicKey;
    poolState:           PublicKey;
    vaultUsdc:           PublicKey;
    vaultAuthority:      PublicKey;
    userUsdc:            PublicKey;
    owner:               PublicKey;
    signer:              PublicKey;
    tradingKey:          PublicKey | null;
    referralConfig:      PublicKey;
    referralCodeAccount: PublicKey;
    traderReferral:      PublicKey | null;
    poolProgram:         PublicKey;
    oracleProgram:       PublicKey;
    // Forwarded to pool-program's release_and_settle via
    // CPI trailing remaining_accounts. Pool-program checks lp_mint.supply == 0
    // and routes losing-close lp_gain to insurance_vault instead of stranding
    // it in pool.total_usdc. SDK derives all three deterministically.
    lpMint:              PublicKey;
    insuranceFund:       PublicKey;
    insuranceVault:      PublicKey;
  };
  primaryFeedAccount: PublicKey;
  secondaryFeedAccount: PublicKey;
} {
  const [marketState]    = marketStatePDA(marketId, programs.perpEngineId);
  const [engineAuth]     = engineAuthPDA(marketId, programs.perpEngineId);
  const [marketOracle]   = marketOraclePDA(marketId, programs.oracleProgramId);
  const [poolState]      = poolStatePDA(marketId, programs.poolProgramId);
  const [vaultUsdc]      = usdcVaultPDA(marketId, programs.poolProgramId);
  const [vaultAuthority] = vaultAuthorityPDA(marketId, programs.poolProgramId);
  const [lpMint]         = lpMintPDA(marketId, programs.poolProgramId);
  const [insuranceFund]  = insuranceFundPda(programs.poolProgramId);
  const [insuranceVault] = insuranceVaultPda(programs.poolProgramId);
  // H-4 fix: derive from owner, not signer — funds must go to the wallet owner's ATA.
  const userUsdc         = getAssociatedTokenAddressSync(usdcMint, owner);

  return {
    accounts: {
      marketState,
      position,
      engineAuth,
      marketOracle,
      poolState,
      vaultUsdc,
      vaultAuthority,
      userUsdc,
      owner,
      signer,
      tradingKey:          tradingKeyPda ?? null,
      referralConfig:      referralConfig      ?? SYSTEM_PROGRAM,
      referralCodeAccount: referralCodeAccount ?? SYSTEM_PROGRAM,
      // #142: trader_referral is an Option<Account> (durable binding) — None ⟹ null,
      // NOT the SystemProgram sentinel (referral_config/referral_code keep the sentinel).
      traderReferral:      traderReferral      ?? null,
      poolProgram:         programs.poolProgramId,
      oracleProgram:       programs.oracleProgramId,
      lpMint,
      insuranceFund,
      insuranceVault,
    },
    primaryFeedAccount,
    secondaryFeedAccount,
  };
}

/**
 * Resolve all accounts needed for update_position_margin.
 *
 * `signerUsdc` is the ATA derived from `signer` — when adding margin the tokens are
 * pulled from the signer's wallet; when removing margin they are returned there.
 *
 * @param marketId    - 32-byte market identifier
 * @param owner       - position owner (wallet that originally opened the position)
 * @param signer      - transaction signer (owner or delegate)
 * @param position    - position PDA (caller-provided)
 * @param usdcMint    - USDC mint address
 * @param programs    - program IDs
 * @param tradingKeyPda - optional trading key PDA (null if not delegating)
 */
export function resolveUpdateMarginAccounts(
  marketId: Uint8Array,
  owner: PublicKey,
  signer: PublicKey,
  position: PublicKey,
  usdcMint: PublicKey,
  programs: ProgramIds,
  tradingKeyPda?: PublicKey | null,
): {
  accounts: {
    marketState:    PublicKey;
    position:       PublicKey;
    engineAuth:     PublicKey;
    poolState:      PublicKey;
    vaultUsdc:      PublicKey;
    vaultAuthority: PublicKey;
    signerUsdc:     PublicKey;
    owner:          PublicKey;
    signer:         PublicKey;
    tradingKey:     PublicKey | null;
    poolProgram:    PublicKey;
  };
} {
  const [marketState]    = marketStatePDA(marketId, programs.perpEngineId);
  const [vaultUsdc]      = usdcVaultPDA(marketId, programs.poolProgramId);
  const [engineAuth]     = engineAuthPDA(marketId, programs.perpEngineId);
  const [poolState]      = poolStatePDA(marketId, programs.poolProgramId);
  const [vaultAuthority] = vaultAuthorityPDA(marketId, programs.poolProgramId);
  const signerUsdc       = getAssociatedTokenAddressSync(usdcMint, signer);

  return {
    accounts: {
      marketState,
      position,
      engineAuth,
      poolState,
      vaultUsdc,
      vaultAuthority,
      signerUsdc,
      owner,
      signer,
      tradingKey:  tradingKeyPda ?? null,
      poolProgram: programs.poolProgramId,
    },
  };
}

/**
 * Resolve all accounts needed for add_liquidity / remove_liquidity.
 *
 * @param marketId - 32-byte market identifier
 * @param user     - wallet depositing or withdrawing
 * @param usdcMint - USDC mint address
 * @param programs - program IDs
 */
export function resolveLiquidityAccounts(
  marketId: Uint8Array,
  user: PublicKey,
  usdcMint: PublicKey,
  programs: ProgramIds,
): {
  poolState:      PublicKey;
  usdcVault:      PublicKey;
  vaultAuthority: PublicKey;
  lpMint:         PublicKey;
  userLp:         PublicKey;
  userUsdc:       PublicKey;
} {
  const [poolState]      = poolStatePDA(marketId, programs.poolProgramId);
  const [vaultAuthority] = vaultAuthorityPDA(marketId, programs.poolProgramId);
  const [lpMint]         = lpMintPDA(marketId, programs.poolProgramId);
  const [usdcVault]      = usdcVaultPDA(marketId, programs.poolProgramId);
  const userUsdc         = getAssociatedTokenAddressSync(usdcMint, user);
  const userLp           = getAssociatedTokenAddressSync(lpMint, user);

  return {
    poolState,
    usdcVault,
    vaultAuthority,
    lpMint,
    userLp,
    userUsdc,
  };
}
