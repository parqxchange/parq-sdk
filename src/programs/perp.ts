import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction, AccountMeta } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Side, HaltMode } from "../types";
import type { ProtocolConfig, ReferralTier } from "../types";
import { protocolConfigPDA } from "../utils/pda";

/** Byte offset of `ProtocolConfig.halt_mode`: 8 (disc) + 32 (admin) + 1 (bump). */
const HALT_MODE_OFFSET = 41;

/**
 * v4 open_position args (BREAKING vs v3).
 * collateralUsdc is split into walletCollateral + fromQueueAmount.
 * positionNonce replaces nonce.
 * minOutputUsdc is new (reserved for future SL/TP; currently unused at open).
 */
export interface OpenPositionArgs {
  /** Anchor enum-object shape, matching the on-chain `Side` enum encoding —
   *  `{ long: {} }` or `{ short: {} }`. **NOT** the `"long"`/`"short"` string.
   *  Construct the enum object explicitly so the type system enforces it. */
  side:              { long: {} } | { short: {} };
  sizeUsdc:          bigint;
  walletCollateral:  bigint;    // paid from signer's USDC ATA → vault
  fromQueueAmount:   bigint;    // drawn from UserQueueClaims (0 = no queue draw)
  acceptablePrice:   bigint;    // 0 = no slippage check
  minOutputUsdc:     bigint;    // 0 = unused at open
  positionNonce:     bigint;    // position PDA nonce (replaces old `nonce`)
  referralCode:      number[];  // Array(32).fill(0) = no referral
}

export class PerpClient {
  constructor(private readonly program: Program) {}

  /**
   * Build an openPosition instruction (v4).
   *
   * remainingAccounts layout **produced by this helper**:
   *   [0]    primaryFeedAccount   (Pyth in steady state) — oracle-adapter primary feed
   *   [1]    secondaryFeedAccount (our PriceFeed PDA fallback) — oracle-adapter secondary feed
   *   [2]    fee_settings PDA (for accrue_fee CPI)
   *
   * On-chain, `remaining_accounts[2]` is interpreted as **optional stake** for a
   * fee discount only when that account's **owner** is the staking program; with
   * the literal `fee_settings` pubkey at index 2, the stake discount path never
   * applies. **Inserting a real stake account before `fee_settings` (shifting
   * `fee_settings` to index 3) is not supported by this helper yet** — use a
   * custom `remainingAccounts` build if you need the staking discount CPI order.
   *
   * `userClaims` MUST always be the derived `[b"user_queue_claims", market_id, signer]`
   * PDA — required by the on-chain `#[account(mut)]` constraint, even when
   * `fromQueueAmount == 0`. Passing `SystemProgram.programId` triggers Anchor 2000
   * (ConstraintMut) at runtime. Use the
   * `userQueueClaimsPDA(marketId, signer, poolProgramId)` helper.
   *
   * When fromQueueAmount > 0 the perp-engine internally CPIs pool-program's
   * apply_queue_collateral_draw against this account; when fromQueueAmount == 0
   * the account is touched but not mutated, so the same PDA still satisfies
   * the mut constraint.
   */
  async openPositionIx(
    accounts: {
      marketState:          PublicKey;
      position:             PublicKey;
      tradingKey:           PublicKey | null;
      signer:               PublicKey;
      signerUsdc:           PublicKey;
      vaultUsdc:            PublicKey;
      referralConfig?:      PublicKey;
      referralCodeAccount?: PublicKey;
      traderReferral?:      PublicKey;
      poolState:            PublicKey;
      poolProgram:          PublicKey;
      oracleProgram:        PublicKey;
      marketOracle:         PublicKey;
      engineAuth:           PublicKey;
      /** UserQueueClaims PDA — ALWAYS the derived PDA, even when fromQueueAmount == 0
       *  (on-chain account is #[account(mut)] so SystemProgram fails ConstraintMut). */
      userClaims:           PublicKey;
      feeSettings:          PublicKey;
      /** WP-B (F-003): the affiliate's pubkey. SystemProgram = no accrual. */
      affiliate?:           PublicKey;
      /** AffiliateReward PDA — required when affiliate is set + helper resolves a cut. Pass null otherwise. */
      affiliateReward?:     PublicKey | null;
    },
    args: OpenPositionArgs,
    primaryFeedAccount: PublicKey,
    secondaryFeedAccount: PublicKey,
  ): Promise<TransactionInstruction> {
    const remainingAccounts: AccountMeta[] = [
      { pubkey: primaryFeedAccount,   isSigner: false, isWritable: false },
      { pubkey: secondaryFeedAccount, isSigner: false, isWritable: false },
      { pubkey: accounts.feeSettings, isSigner: false, isWritable: false },
    ];
    const systemProgram = new PublicKey("11111111111111111111111111111111");
    const { tradingKey, referralConfig, referralCodeAccount, traderReferral, affiliate, affiliateReward, feeSettings: _fs, ...rest } = accounts;
    return this.program.methods
      .openPosition({
        // `args.side` is already the Anchor enum-object shape per the
        // OpenPositionArgs.side type — passed through directly. Do NOT add a
        // `=== "long"` string conversion here: a wrong-shaped value would
        // silently fall through to `{ short: {} }`.
        side:              args.side,
        sizeUsdc:          new BN(args.sizeUsdc.toString()),
        walletCollateral:  new BN(args.walletCollateral.toString()),
        fromQueueAmount:   new BN(args.fromQueueAmount.toString()),
        acceptablePrice:   new BN(args.acceptablePrice.toString()),
        minOutputUsdc:     new BN(args.minOutputUsdc.toString()),
        positionNonce:     new BN(args.positionNonce.toString()),
        referralCode:      args.referralCode,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .accounts({
        ...rest,
        tradingKey:          tradingKey as any,   // Anchor 0.31 optional account — null is valid at runtime
        referralConfig:      referralConfig      ?? systemProgram,
        referralCodeAccount: referralCodeAccount ?? systemProgram,
        traderReferral:      traderReferral      ?? systemProgram,
        affiliate:           affiliate           ?? systemProgram,
        affiliateReward:     affiliateReward     ?? null,
        systemProgram,
        tokenProgram:        TOKEN_PROGRAM_ID,
        // F-005: self-CPI to update_funding_rate
        perpEngineProgram:   this.program.programId,
      } as any)
      .remainingAccounts(remainingAccounts)
      .instruction();
  }

  /**
   * Build a closePosition instruction (v4).
   *
   * @param closeSize    - null for full close, or partial size in USDC 6-decimal units
   * @param minOutputUsdc - minimum USDC to receive (slippage guard); 0 = no check
   * @param primaryFeedAccount   - oracle-adapter primary feed (Pyth in steady state)
   * @param secondaryFeedAccount - oracle-adapter secondary feed (our PriceFeed PDA fallback)
   * @param queueEntryPda - PayoutQueueEntry PDA at pool.queueTailIdx (required when the
   *                        on-chain handler may take the enqueue_winner path). The handler
   *                        decides at runtime; callers should always pre-derive this and pass
   *                        it. Pass SystemProgram.programId only if the pool is known to be
   *                        solvent enough to settle directly (rare, prefer always passing).
   * @param userClaimsPda - UserQueueClaims PDA for the position owner (init_if_needed).
   *                        Same usage as queueEntryPda — always pass the real PDA.
   *
   * remainingAccounts layout (passed to perp-engine):
   *   [0]    primaryFeedAccount   (Pyth in steady state)
   *   [1]    secondaryFeedAccount (our PriceFeed PDA fallback)
   *   [2]    (optional) stake account for staking discount
   *   [N-2]  queue_entry PDA       (for enqueue_winner path)
   *   [N-1]  user_claims PDA       (for enqueue_winner path)
   *   [last] fee_settings PDA
   *
   * Note: The contract decides enqueue_winner internally (reads pool state). The caller
   * must always provide queue_entry + user_claims so both paths are covered.
   */
  async closePositionIx(
    accounts: {
      marketState:          PublicKey;
      position:             PublicKey;
      tradingKey:           PublicKey | null;
      signer:               PublicKey;
      owner:                PublicKey;
      userUsdc:             PublicKey;
      referralConfig?:      PublicKey;
      referralCodeAccount?: PublicKey;
      traderReferral?:      PublicKey;
      poolState:            PublicKey;
      poolProgram:          PublicKey;
      oracleProgram:        PublicKey;
      marketOracle:         PublicKey;
      vaultUsdc:            PublicKey;
      vaultAuthority:       PublicKey;
      engineAuth:           PublicKey;
      feeSettings:          PublicKey;
      /** WP-B (F-003) accrual account. SystemProgram = no accrual. */
      affiliate?:           PublicKey;
      /** AffiliateReward PDA — null when no accrual. */
      affiliateReward?:     PublicKey | null;
      /** LP mint — pool-program reads supply == 0 to trigger insurance routing. */
      lpMint:               PublicKey;
      /** insurance_fund PDA (seeds [b"insurance_fund"]). */
      insuranceFund:        PublicKey;
      /** insurance USDC vault PDA (seeds [b"insurance_vault"]). */
      insuranceVault:       PublicKey;
    },
    closeSize: bigint | null,
    primaryFeedAccount: PublicKey,
    secondaryFeedAccount: PublicKey,
    minOutputUsdc?: bigint,
    /** PayoutQueueEntry PDA at pool.queueTailIdx — for the enqueue_winner path. */
    queueEntryPda?: PublicKey,
    /** UserQueueClaims PDA for the position owner — for the enqueue_winner path. */
    userClaimsPda?: PublicKey,
  ): Promise<TransactionInstruction> {
    const systemProgram = new PublicKey("11111111111111111111111111111111");
    // Build remaining accounts: [primary, secondary, ...optional stake..., queueEntry, userClaims, feeSettings]
    // The contract expects: remaining[N-3]=queueEntry, remaining[N-2]=userClaims, remaining[last]=feeSettings
    // when enqueue_winner; when not enqueue_winner it only reads remaining[last]=feeSettings.
    // We always include queue PDAs so both paths are covered.
    const remainingAccounts: AccountMeta[] = [
      { pubkey: primaryFeedAccount,   isSigner: false, isWritable: false },
      { pubkey: secondaryFeedAccount, isSigner: false, isWritable: false },
    ];
    // Queue PDAs — use systemProgram as placeholder if not provided (caller should always provide them)
    const queueEntry = queueEntryPda ?? systemProgram;
    const userClaims = userClaimsPda ?? systemProgram;
    remainingAccounts.push(
      { pubkey: queueEntry,             isSigner: false, isWritable: true },
      { pubkey: userClaims,             isSigner: false, isWritable: true },
      { pubkey: accounts.feeSettings,   isSigner: false, isWritable: false },
    );
    const { tradingKey, referralConfig, referralCodeAccount, traderReferral, affiliate, affiliateReward, feeSettings: _fs, ...rest } = accounts;
    return this.program.methods
      .closePosition({
        closeSize:     closeSize !== null ? new BN(closeSize.toString()) : null,
        minOutputUsdc: new BN((minOutputUsdc ?? 0n).toString()),
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .accounts({
        ...rest,
        tradingKey:          tradingKey as any,   // Anchor 0.31 optional account — null is valid at runtime
        referralConfig:      referralConfig      ?? systemProgram,
        referralCodeAccount: referralCodeAccount ?? systemProgram,
        traderReferral:      traderReferral      ?? systemProgram,
        affiliate:           affiliate           ?? systemProgram,
        affiliateReward:     affiliateReward     ?? null,
        tokenProgram:        TOKEN_PROGRAM_ID,
        systemProgram,
        // F-005: self-CPI to update_funding_rate
        perpEngineProgram:   this.program.programId,
      } as any)
      .remainingAccounts(remainingAccounts)
      .instruction();
  }

  /**
   * Build an updatePositionMargin instruction.
   * @param delta - positive to add margin, negative to remove collateral down to MMR floor
   * @param primaryFeedAccount   - oracle-adapter primary feed (Pyth in steady state). Passed
   *   as remainingAccounts[0]. Optional so existing add-margin callers don't break, but if
   *   you're removing margin (delta < 0) it's effectively required. Pass alongside
   *   `secondaryFeedAccount`.
   * @param secondaryFeedAccount - oracle-adapter secondary feed (our PriceFeed PDA fallback).
   *   Passed as remainingAccounts[1]. Required whenever `primaryFeedAccount` is supplied —
   *   the on-chain CPI signature is `[market_oracle, primary, secondary]`.
   *
   * remainingAccounts layout (when feeds are passed):
   *   [0] primaryFeedAccount
   *   [1] secondaryFeedAccount
   *
   * Note: on-chain `Accounts` struct also requires `oracleProgram` and `marketOracle`; these
   * are named accounts that must be passed in `accounts` above. (Older SDK omitted them —
   * callers that don't pass them will revert with "Account `oracleProgram` not provided.")
   */
  async updatePositionMarginIx(
    accounts: {
      marketState: PublicKey;
      position: PublicKey;
      tradingKey: PublicKey | null;
      signer: PublicKey;
      owner: PublicKey;
      signerUsdc: PublicKey;
      vaultUsdc: PublicKey;
      userUsdc: PublicKey;
      vaultAuthority: PublicKey;
      poolState: PublicKey;
      poolProgram: PublicKey;
      engineAuth: PublicKey;
      oracleProgram: PublicKey;
      marketOracle: PublicKey;
    },
    delta: bigint,
    primaryFeedAccount?: PublicKey,
    secondaryFeedAccount?: PublicKey,
  ): Promise<TransactionInstruction> {
    const { tradingKey, ...rest } = accounts;
    const builder = this.program.methods
      .updatePositionMargin(new BN(delta.toString()))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .accounts({
        ...rest,
        tradingKey: tradingKey as any,   // Anchor 0.31 optional account — null is valid at runtime
        tokenProgram: TOKEN_PROGRAM_ID,
        // F-005: self-CPI to update_funding_rate
        perpEngineProgram: this.program.programId,
      } as any);
    if (primaryFeedAccount && secondaryFeedAccount) {
      builder.remainingAccounts([
        { pubkey: primaryFeedAccount,   isSigner: false, isWritable: false },
        { pubkey: secondaryFeedAccount, isSigner: false, isWritable: false },
      ]);
    } else if (primaryFeedAccount || secondaryFeedAccount) {
      throw new Error(
        "updatePositionMarginIx: primaryFeedAccount and secondaryFeedAccount must be passed " +
        "together — the on-chain oracle-adapter CPI requires both feeds.",
      );
    }
    return builder.instruction();
  }

  /**
   * Build an updateFundingRate instruction (permissionless crank).
   */
  async updateFundingRateIx(
    accounts: { marketState: PublicKey; poolState: PublicKey },
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .updateFundingRate()
      .accounts(accounts)
      .instruction();
  }

  /**
   * Build a createOrder instruction (limit or stop order).
   * For market orders use openPositionIx / closePositionIx directly.
   * The order PDA must be pre-derived using the current OrderNonce value.
   */
  async createOrderIx(
    accounts: {
      marketState: PublicKey;
      poolState:   PublicKey;
      orderNonce:  PublicKey;   // PDA [b"order_nonce", owner]
      order:       PublicKey;   // PDA [b"order", owner, market_id, nonce_le8]
      owner:       PublicKey;
      ownerUsdc:   PublicKey;
      vaultUsdc:   PublicKey;
      poolProgram: PublicKey;
      engineAuth:  PublicKey;   // PDA [b"engine_auth", market_id]
    },
    args: {
      orderType:       { limitIncrease: {} } | { stopIncrease: {} } | { limitDecrease: {} } | { stopLossDecrease: {} };
      side:            { long: {} } | { short: {} };
      sizeUsdc:        bigint;
      collateralUsdc:  bigint;
      triggerPrice:    bigint;
      acceptablePrice: bigint;
      minOutputUsdc:   bigint;
      referralCode:    number[];   // Array(32).fill(0) = no referral
      positionNonce:   bigint;     // nonce of the position to open/modify
    },
  ): Promise<TransactionInstruction> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.program.methods.createOrder as any)({
        orderType:       args.orderType,
        side:            args.side,
        sizeUsdc:        new BN(args.sizeUsdc.toString()),
        collateralUsdc:  new BN(args.collateralUsdc.toString()),
        triggerPrice:    new BN(args.triggerPrice.toString()),
        acceptablePrice: new BN(args.acceptablePrice.toString()),
        minOutputUsdc:   new BN(args.minOutputUsdc.toString()),
        referralCode:    args.referralCode,
        positionNonce:   new BN(args.positionNonce.toString()),
      })
      .accounts({
        ...accounts,
        tokenProgram:  TOKEN_PROGRAM_ID,
        systemProgram: new PublicKey("11111111111111111111111111111111"),
      })
      .instruction();
  }

  /**
   * Build a cancelOrder instruction.
   * Closes the order PDA (returning rent to owner) and refunds escrowed USDC collateral.
   *
   * Account derivation notes:
   * - ownerUsdc:      ATA of owner: getAssociatedTokenAddressSync(USDC_MINT, owner)
   * - vaultUsdc:      usdcVaultPDA(marketId, POOL_PROGRAM_ID) — native PDA, NOT an ATA
   * - engineAuth:     engineAuthPDA(marketId, perpEngineId)[0]  seeds=[b"engine_auth", marketId]
   * - vaultAuthority: derived inside pool-program; use vaultAuthorityPDA(marketId, poolProgramId)[0]
   * - poolState:      poolStatePDA(marketId, POOL_PROGRAM_ID)[0]
   * - poolProgram:    POOL_PROGRAM_ID constant
   * Note: cancelOrder does not require orderNonce — the order PDA is passed directly.
   */
  async cancelOrderIx(
    accounts: {
      marketState: PublicKey;
      order: PublicKey;
      signer: PublicKey;
      owner: PublicKey;
      ownerUsdc: PublicKey;
      vaultUsdc: PublicKey;
      vaultAuthority: PublicKey;
      engineAuth: PublicKey;
      poolState: PublicKey;
      poolProgram: PublicKey;
    },
  ): Promise<TransactionInstruction> {
    const systemProgram = new PublicKey("11111111111111111111111111111111");
    return this.program.methods
      .cancelOrder()
      .accounts({
        ...accounts,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram,
      })
      .instruction();
  }

  // ---------------------------------------------------------------------------
  // Admin instructions
  // ---------------------------------------------------------------------------

  /** Build an initializeMarket instruction. */
  async initializeMarketIx(
    accounts: {
      marketState: PublicKey;
      engineAuth: PublicKey;
      admin: PublicKey;
    },
    args: {
      marketId: Uint8Array;
      poolState: PublicKey;
      poolProgram: PublicKey;
      oracleProgram: PublicKey;
      treasury: PublicKey;
      stakingProgramId: PublicKey;
      maxLeverage: number;
      baseFeeBps: number;
      mmrBps: number;
      maxOiLong: bigint;      // 0 = uncapped
      maxOiShort: bigint;     // 0 = uncapped
      feeBpsFavorable: number; // 0 = disabled
      // openable cap = 10000/IM; MUST be > mmrBps (on-chain init guard).
      initialMarginBps: number;
    },
  ): Promise<TransactionInstruction> {
    const systemProgram = new PublicKey("11111111111111111111111111111111");
    return this.program.methods
      .initializeMarket({
        marketId: Array.from(args.marketId),
        poolState: args.poolState,
        poolProgram: args.poolProgram,
        oracleProgram: args.oracleProgram,
        treasury: args.treasury,
        stakingProgramId: args.stakingProgramId,
        maxLeverage: args.maxLeverage,
        baseFeeBps: args.baseFeeBps,
        mmrBps: args.mmrBps,
        maxOiLong: new BN(args.maxOiLong.toString()),
        maxOiShort: new BN(args.maxOiShort.toString()),
        feeBpsFavorable: args.feeBpsFavorable,
        initialMarginBps: args.initialMarginBps,
      })
      .accounts({
        ...accounts,
        systemProgram,
      })
      .instruction();
  }

  /**
   * Build an updateMarketConfig instruction. All args are optional (Option<T> on-chain).
   * v4: maxPnlFactorForAdl removed (ADL surface removed).
   */
  async updateMarketConfigIx(
    accounts: {
      marketState: PublicKey;
      poolState: PublicKey;
      admin: PublicKey;
    },
    args: {
      fundingIncreaseFactorPerSecond: bigint | null;
      fundingDecreaseFactorPerSecond: bigint | null;
      thresholdForStableFunding: bigint | null;
      thresholdForDecreaseFunding: bigint | null;
      minFundingFactorPerSecond: bigint | null;
      maxFundingFactorPerSecond: bigint | null;
      borrowingFactor: bigint | null;
      optimalUsageFactor: bigint | null;
      aboveOptimalBorrowingFactor: bigint | null;
      priceImpactFactor: bigint | null;
      maxPriceImpactBps: number | null;
      keeper: PublicKey | null;
      stakingProgramId?: PublicKey | null;
      maxOiLong?: bigint | null;
      maxOiShort?: bigint | null;
      feeBpsFavorable?: number | null;
      offHoursMaxOiLong?: bigint | null;
      offHoursMaxOiShort?: bigint | null;
      // maintenance-margin ratio (u16 bps) — pass as a plain number, NOT a BN.
      mmrBps?: number | null;
      // initial-margin floor (u16 bps, openable cap = 10000/IM) + re-patchable
      // per-market hard cap (u8). Plain numbers, NOT BN.
      initialMarginBps?: number | null;
      maxLeverage?: number | null;
      // ADL tail-backstop + base fee — required for full field parity with
      // UpdateMarketConfigArgs. Anchor omits absent Options → a partial object
      // under-serializes against the deserializer and the tx reverts, so all
      // fields are present here.
      adlFrozen?: number | null;
      adlTailTriggerUsdcRth?: bigint | null;
      adlTailTriggerUsdcOff?: bigint | null;
      adlTailMinAgeSecsRth?: number | null;
      adlTailMinAgeSecsOff?: number | null;
      adlHaircutBpsRth?: number | null;
      adlHaircutBpsOff?: number | null;
      adlMaxHaircutBps?: number | null;
      adlMaxFeedDivergenceBps?: number | null;
      baseFeeBps?: number | null;
    },
  ): Promise<TransactionInstruction> {
    const toBnOrNull = (v: bigint | null | undefined): BN | null =>
      v != null ? new BN(v.toString()) : null;
    return this.program.methods
      .updateMarketConfig({
        fundingIncreaseFactorPerSecond: toBnOrNull(args.fundingIncreaseFactorPerSecond),
        fundingDecreaseFactorPerSecond: toBnOrNull(args.fundingDecreaseFactorPerSecond),
        thresholdForStableFunding: toBnOrNull(args.thresholdForStableFunding),
        thresholdForDecreaseFunding: toBnOrNull(args.thresholdForDecreaseFunding),
        minFundingFactorPerSecond: toBnOrNull(args.minFundingFactorPerSecond),
        maxFundingFactorPerSecond: toBnOrNull(args.maxFundingFactorPerSecond),
        borrowingFactor: toBnOrNull(args.borrowingFactor),
        optimalUsageFactor: toBnOrNull(args.optimalUsageFactor),
        aboveOptimalBorrowingFactor: toBnOrNull(args.aboveOptimalBorrowingFactor),
        priceImpactFactor: toBnOrNull(args.priceImpactFactor),
        maxPriceImpactBps: args.maxPriceImpactBps,
        keeper: args.keeper ?? null,
        stakingProgramId: args.stakingProgramId ?? null,
        maxOiLong: toBnOrNull(args.maxOiLong),
        maxOiShort: toBnOrNull(args.maxOiShort),
        feeBpsFavorable: args.feeBpsFavorable ?? null,
        offHoursMaxOiLong: toBnOrNull(args.offHoursMaxOiLong),
        offHoursMaxOiShort: toBnOrNull(args.offHoursMaxOiShort),
        mmrBps: args.mmrBps ?? null,
        initialMarginBps: args.initialMarginBps ?? null,
        maxLeverage: args.maxLeverage ?? null,
        adlFrozen: args.adlFrozen ?? null,
        adlTailTriggerUsdcRth: toBnOrNull(args.adlTailTriggerUsdcRth),
        adlTailTriggerUsdcOff: toBnOrNull(args.adlTailTriggerUsdcOff),
        adlTailMinAgeSecsRth: args.adlTailMinAgeSecsRth ?? null,
        adlTailMinAgeSecsOff: args.adlTailMinAgeSecsOff ?? null,
        adlHaircutBpsRth: args.adlHaircutBpsRth ?? null,
        adlHaircutBpsOff: args.adlHaircutBpsOff ?? null,
        adlMaxHaircutBps: args.adlMaxHaircutBps ?? null,
        adlMaxFeedDivergenceBps: args.adlMaxFeedDivergenceBps ?? null,
        baseFeeBps: args.baseFeeBps ?? null,
      })
      .accounts(accounts)
      .instruction();
  }

  /**
   * Build a `set_trading_halt` instruction — the admin emergency venue-wide
   * trading halt. `mode`: 0 = None (normal / resume target), 1 = ReduceOnly
   * (block opens/increases/new orders/margin/funding; closes, cancels and
   * liquidations stay open — the venue-wide equivalent of per-market pause),
   * 2 = Full (additionally freeze closes + liquidations). A single tx both
   * halts (1/2) and resumes (0) — reversible by design. The on-chain handler
   * reverts `InvalidHaltMode` for `mode > 2` and `Unauthorized` for a non-admin
   * signer.
   *
   * `protocol_config` (`[b"protocol_config"]`) is auto-resolved by Anchor from
   * its const seed — only the `admin` signer must be supplied.
   */
  async setTradingHaltIx(
    admin: PublicKey,
    mode: HaltMode | number,
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .setTradingHalt(mode)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .accounts({ admin } as any)
      .instruction();
  }

  /** Build a migrateMarketState instruction. */
  async migrateMarketStateIx(
    accounts: {
      marketState: PublicKey;
      poolState: PublicKey;
      admin: PublicKey;
    },
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .migrateMarketState()
      .accounts(accounts)
      .instruction();
  }

  /** Build a migratePosition instruction. */
  async migratePositionIx(
    accounts: {
      position: PublicKey;
      payer: PublicKey;
    },
  ): Promise<TransactionInstruction> {
    const systemProgram = new PublicKey("11111111111111111111111111111111");
    return this.program.methods
      .migratePosition()
      .accounts({
        ...accounts,
        systemProgram,
      })
      .instruction();
  }

  /** Build a setPerSideReserved instruction. */
  async setPerSideReservedIx(
    accounts: {
      marketState: PublicKey;
      poolState: PublicKey;
      admin: PublicKey;
    },
    args: {
      longReservedUsdc: bigint;
      shortReservedUsdc: bigint;
    },
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .setPerSideReserved({
        longReservedUsdc: new BN(args.longReservedUsdc.toString()),
        shortReservedUsdc: new BN(args.shortReservedUsdc.toString()),
      })
      .accounts(accounts)
      .instruction();
  }

  // ---------------------------------------------------------------------------
  // Keeper / trading instructions
  // ---------------------------------------------------------------------------

  /**
   * Build a liquidate instruction (insurance-fund slice + reimburse fallback).
   *
   * liquidate CPIs `accrue_to_insurance` for the 25-bps liquidation slice.
   * Two required accounts (`insuranceFund` + `insuranceVault`) flow on the
   * named-accounts dict; there is no `fee_settings` remaining-account slot
   * (`accrue_to_insurance` does not consume fee_settings).
   *
   * `insuranceVaultAuthority` (seeds `[b"insurance_vault_authority"]` on
   * pool-program) is also required — perp-engine's liquidate reads `release_and_settle`'s
   * `set_return_data` payload and, if the PayDirect saturated against a
   * drained pool, CPIs `reimburse_liquidator` to source the gap from the
   * InsuranceFund. The authority PDA signs the SPL transfer; pool-program
   * verifies the seeds.
   *
   * remaining_accounts layout:
   *   [0]           primaryFeedAccount   (Pyth in steady state)
   *   [1]           secondaryFeedAccount (our PriceFeed PDA fallback)
   *   [2..2+K-1]    K PayoutQueueEntry PDAs (FIFO order, Pending, owner == position owner)
   *                 — only when position.collateralFromQueue > 0
   *   [2+K]         UserQueueClaims PDA for the position owner
   *                 — required whenever position.collateralFromQueue > 0,
   *                   INCLUDING when queueEntries is empty (F-007). The on-chain
   *                   handler always runs release_queue_lien on do_clawback so
   *                   the user's collateral_drawn returns to zero even after the
   *                   keeper has harvested every Pending entry.
   *
   * When position.collateralFromQueue == 0:
   *   remainingAccounts = [primaryFeedAccount, secondaryFeedAccount]
   *
   * When position.collateralFromQueue > 0 (clawback path):
   *   remainingAccounts = [primaryFeedAccount, secondaryFeedAccount, ...queueEntries, userClaims]
   *
   * @param accounts.insuranceFund   - InsuranceFund singleton PDA
   *                                   (seeds: [b"insurance_fund"], pool-program).
   * @param accounts.insuranceVault  - insurance-fund USDC vault PDA
   *                                   (seeds: [b"insurance_vault"], pool-program).
   * @param primaryFeedAccount   - oracle-adapter primary feed (Pyth in steady state)
   * @param secondaryFeedAccount - oracle-adapter secondary feed (our PriceFeed PDA fallback)
   * @param queueEntries  - Pending PayoutQueueEntry PDAs in FIFO order (may be
   *                        empty even when the position has queue-funded
   *                        collateral — if all Pending entries were harvested
   *                        between open and liquidate)
   * @param userClaimsPda - UserQueueClaims PDA. MUST be non-null whenever the
   *                        position has queue-funded collateral
   *                        (hasQueueCollateral=true), regardless of
   *                        queueEntries.length. Null only when the position has
   *                        zero queue-funded collateral.
   * @param hasQueueCollateral - true iff position.collateralFromQueue > 0.
   *                        When true and userClaimsPda is null, this builder
   *                        throws to prevent the keeper from constructing an
   *                        ix that the on-chain handler would revert
   *                        (MissingQueueEntryAccount).
   * @param maxCollateralLoss - optional slippage guard on bad_debt (null = no check)
   */
  async liquidateIx(
    accounts: {
      marketState:    PublicKey;
      position:       PublicKey;
      liquidator:     PublicKey;
      userUsdc:       PublicKey;
      liquidatorUsdc: PublicKey;
      poolState:      PublicKey;
      poolProgram:    PublicKey;
      oracleProgram:  PublicKey;
      marketOracle:   PublicKey;
      vaultUsdc:      PublicKey;
      vaultAuthority: PublicKey;
      insuranceFund:  PublicKey;
      insuranceVault: PublicKey;
      /**
       * insurance vault authority PDA (seeds
       * `[b"insurance_vault_authority"]` on pool-program). Signs the SPL
       * transfer in `reimburse_liquidator` when the liquidator-reward
       * `release_and_settle` short-pays. Always required on the `Liquidate`
       * Anchor accounts struct (the on-chain handler may not invoke the
       * fallback CPI on a given liquidation, but the account must be
       * present for the struct to deserialize).
       */
      insuranceVaultAuthority: PublicKey;
      /** pool-program reads lp_mint.supply == 0 to route losing-liquidation
       *  lp_gain to insurance_vault instead of pool.total_usdc. */
      lpMint:         PublicKey;
      engineAuth:     PublicKey;
    },
    primaryFeedAccount: PublicKey,
    secondaryFeedAccount: PublicKey,
    queueEntries: PublicKey[],
    userClaimsPda: PublicKey | null,
    hasQueueCollateral: boolean,
    maxCollateralLoss?: bigint,
  ): Promise<TransactionInstruction> {
    // F-007: userClaims must always be passed when the position has
    // queue-funded collateral, even when queueEntries is empty (because the
    // on-chain handler always runs release_queue_lien on do_clawback to
    // unwind UserQueueClaims.collateral_drawn).
    if (hasQueueCollateral && userClaimsPda === null) {
      throw new Error(
        "liquidateIx: userClaimsPda is required when position has queue-funded " +
        "collateral (hasQueueCollateral=true), regardless of queueEntries.length " +
        "(F-007). Pass the position owner's UserQueueClaims PDA.",
      );
    }

    const remainingAccounts: AccountMeta[] = [
      { pubkey: primaryFeedAccount,   isSigner: false, isWritable: false },
      { pubkey: secondaryFeedAccount, isSigner: false, isWritable: false },
    ];
    // Append queue entries when clawback is needed
    for (const entry of queueEntries) {
      remainingAccounts.push({ pubkey: entry, isSigner: false, isWritable: true });
    }
    // Append userClaims when clawback is needed (may be present with zero queueEntries)
    if (userClaimsPda !== null) {
      remainingAccounts.push({ pubkey: userClaimsPda, isSigner: false, isWritable: true });
    }

    return this.program.methods
      .liquidate(maxCollateralLoss !== undefined ? new BN(maxCollateralLoss.toString()) : null)
      .accounts({
        ...accounts,
        tokenProgram: TOKEN_PROGRAM_ID,
        // F-005: self-CPI to update_funding_rate
        perpEngineProgram: this.program.programId,
      } as any)
      .remainingAccounts(remainingAccounts)
      .instruction();
  }

  /**
   * Build an executeOrder instruction.
   *
   * Account ordering in remaining_accounts:
   *   [0]              primaryFeedAccount (Pyth in steady state) — always
   *   [1]              secondaryFeedAccount (our PriceFeed PDA fallback) — always
   *   [last-2..last-1] queueEntry + userClaims — present iff `enqueueAccounts` is non-null
   *   [last]           feeSettings — always
   *
   * The enqueue-route accounts (queueEntry + userClaims) are required only when
   * execute_decrease is expected to fire the release_and_enqueue branch (WP-A
   * F-013): net_return > 0 AND (pool.queue_total_owed > 0 OR free_liquidity <
   * net_return). The caller must pre-read pool state to predict this and derive
   * queueEntry from `pool.queue_tail_idx` and userClaims from
   * `[b"user_queue_claims", marketId, owner]`. Passing `null` is correct for
   * increase orders and for decrease orders that will hit the settle branch.
   *
   * If `enqueueAccounts` is null and the on-chain path actually needs them, the
   * tx reverts with `MissingFeeSettings` (15003) — fail-loud rather than silent
   * misbehavior. Callers can retry with the accounts populated.
   *
   * WP-B (F-003) added the `affiliate` + `affiliateReward` accounts. Pass
   * `SystemProgram.programId` for `affiliate` and `null` for `affiliateReward`
   * to skip accrual.
   */
  async executeOrderIx(
    accounts: {
      marketState: PublicKey;
      order: PublicKey;
      position: PublicKey;
      keeper: PublicKey;
      owner: PublicKey;
      ownerUsdc: PublicKey;
      vaultUsdc: PublicKey;
      poolState: PublicKey;
      poolProgram: PublicKey;
      oracleProgram: PublicKey;
      marketOracle: PublicKey;
      vaultAuthority: PublicKey;
      engineAuth: PublicKey;
      referralConfig: PublicKey;
      referralCodeAccount: PublicKey;
      traderReferral: PublicKey;
      affiliate: PublicKey;
      affiliateReward: PublicKey | null;
    },
    primaryFeedAccount: PublicKey,
    secondaryFeedAccount: PublicKey,
    feeSettings: PublicKey,
    enqueueAccounts: { queueEntry: PublicKey; userClaims: PublicKey } | null = null,
  ): Promise<TransactionInstruction> {
    const remainingAccounts: AccountMeta[] = [
      { pubkey: primaryFeedAccount,   isSigner: false, isWritable: false },
      { pubkey: secondaryFeedAccount, isSigner: false, isWritable: false },
    ];
    if (enqueueAccounts !== null) {
      remainingAccounts.push(
        { pubkey: enqueueAccounts.queueEntry, isSigner: false, isWritable: true },
        { pubkey: enqueueAccounts.userClaims, isSigner: false, isWritable: true },
      );
    }
    // fee_settings always last — close_position.rs:520 reads via remaining_accounts.last()
    remainingAccounts.push({ pubkey: feeSettings, isSigner: false, isWritable: false });

    const systemProgram = new PublicKey("11111111111111111111111111111111");
    // affiliate_reward is `Option<Box<Account<>>>` on-chain; Anchor accepts
    // `null` at runtime to signal absence but its TS typegen rejects null in
    // `.accounts()`. Cast through `any` — the runtime semantics are correct
    // and asserted by the optional flag in the regenerated IDL.
    return this.program.methods
      .executeOrder()
      .accounts({
        ...accounts,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram,
        // F-005: self-CPI to update_funding_rate
        perpEngineProgram: this.program.programId,
      } as any)
      .remainingAccounts(remainingAccounts)
      .instruction();
  }

  // ---------------------------------------------------------------------------
  // Referral instructions
  // ---------------------------------------------------------------------------

  /** Build a configureReferralTiers instruction. */
  async configureReferralTiersIx(
    accounts: {
      referralConfig: PublicKey;
      admin: PublicKey;
    },
    args: {
      tiers: [ReferralTier, ReferralTier, ReferralTier, ReferralTier];
    },
  ): Promise<TransactionInstruction> {
    const systemProgram = new PublicKey("11111111111111111111111111111111");
    return this.program.methods
      .configureReferralTiers(args.tiers)
      .accounts({
        ...accounts,
        systemProgram,
      })
      .instruction();
  }

  /** Build a setReferralTier instruction. */
  async setReferralTierIx(
    accounts: {
      referralConfig: PublicKey;
      referralCode: PublicKey;
      admin: PublicKey;
    },
    args: { tier: number },
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .setReferralTier({ tier: args.tier })
      .accounts(accounts)
      .instruction();
  }

  /** Build a createReferralCode instruction. */
  async createReferralCodeIx(
    accounts: {
      referralCode: PublicKey;
      affiliate: PublicKey;
    },
    args: { code: Uint8Array },
  ): Promise<TransactionInstruction> {
    const systemProgram = new PublicKey("11111111111111111111111111111111");
    // Single `[u8;32]` ix arg — Anchor 0.31 expects a number[] positional (see tests/perp-engine-v2.ts), not `{ code }`.
    return this.program.methods
      .createReferralCode(Array.from(args.code))
      .accounts({
        ...accounts,
        systemProgram,
      })
      .instruction();
  }

  /** Build a setTraderReferral instruction. */
  async setTraderReferralIx(
    accounts: {
      referralCode: PublicKey;
      traderReferral: PublicKey;
      trader: PublicKey;
    },
    args: { code: Uint8Array },
  ): Promise<TransactionInstruction> {
    const systemProgram = new PublicKey("11111111111111111111111111111111");
    return this.program.methods
      .setTraderReferral(Array.from(args.code))
      .accounts({
        ...accounts,
        systemProgram,
      })
      .instruction();
  }

  /** Build a claimAffiliateReward instruction. */
  async claimAffiliateRewardIx(
    accounts: {
      affiliateReward: PublicKey;
      marketState: PublicKey;
      affiliate: PublicKey;
      affiliateUsdc: PublicKey;
      vaultUsdc: PublicKey;
      vaultAuthority: PublicKey;
      engineAuth: PublicKey;
    },
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .claimAffiliateReward()
      .accounts({
        ...accounts,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  // ---------------------------------------------------------------------------
  // Read accessors
  // ---------------------------------------------------------------------------

  /**
   * Fetch the singleton `ProtocolConfig` PDA (`[b"protocol_config"]`).
   *
   * Read the gross-notional tier table to clamp a leverage selector to
   * `rthMaxLeverage[tier]` during RTH or `offHoursMaxLeverage[tier]` outside
   * RTH. The tier table rarely changes — cache with a generous TTL.
   *
   * @returns the decoded ProtocolConfig
   * @throws if the account does not exist on the cluster the program is bound to
   */
  async getProtocolConfig(): Promise<ProtocolConfig> {
    const [pda] = protocolConfigPDA(this.program.programId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = await (this.program.account as any).protocolConfig.fetch(pda);
    // Anchor returns BN for u64 — surface as bigint to match the rest of the SDK
    // surface (Position.sizeUsdc, etc.). u8/u16 arrive as plain numbers.
    return {
      admin:                raw.admin,
      bump:                 raw.bump,
      haltMode:             raw.haltMode,
      // u16; 0 (gate disabled) on PDAs predating the field — Anchor decodes the
      // zeroed reserved bytes as 0. `?? 0` guards an older IDL mirror lacking it.
      minFreeLiquidityBps:  raw.minFreeLiquidityBps ?? 0,
      rthOpenMinutesUtc:    raw.rthOpenMinutesUtc,
      rthCloseMinutesUtc:   raw.rthCloseMinutesUtc,
      tierBreakpointsUsdc:  (raw.tierBreakpointsUsdc as BN[]).map((bn) => BigInt(bn.toString())),
      rthMaxLeverage:       Array.from(raw.rthMaxLeverage as number[]),
      offHoursMaxLeverage:  Array.from(raw.offHoursMaxLeverage as number[]),
    };
  }

  /**
   * Light read of just the venue-wide halt mode (`ProtocolConfig.halt_mode`)
   * via a single `getAccountInfo` + byte read — no full Anchor decode, so it
   * stays cheap for hot polling. Returns `HaltMode.None` if the account is
   * missing (treat absence as "not halted").
   */
  async getHaltMode(): Promise<HaltMode> {
    const [pda] = protocolConfigPDA(this.program.programId);
    const info = await this.program.provider.connection.getAccountInfo(pda);
    if (!info || info.data.length <= HALT_MODE_OFFSET) return HaltMode.None;
    const raw = info.data[HALT_MODE_OFFSET];
    // Clamp unexpected bytes to None.
    // set_trading_halt enforces mode <= Full on write, so the on-chain byte is
    // always 0/1/2 in practice; this guards corruption / a future mode.
    return raw === HaltMode.ReduceOnly || raw === HaltMode.Full ? raw : HaltMode.None;
  }
}
