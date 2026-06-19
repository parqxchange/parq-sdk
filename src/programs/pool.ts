import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, TransactionInstruction, AccountMeta } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

export class PoolClient {
  constructor(private readonly program: Program) {}

  /**
   * Build an initializePool instruction.
   * Creates the pool_state PDA, usdc_vault, and lp_mint for a new market.
   */
  async initializePoolIx(
    accounts: {
      poolState: PublicKey;
      usdcVault: PublicKey;
      vaultAuthority: PublicKey;
      lpMint: PublicKey;
      usdcMint: PublicKey;
      admin: PublicKey;
    },
    args: {
      marketId: Uint8Array;
      engineAuth: PublicKey;
      engineAuthBump: number;
      reserveFactor: bigint;   // 0 = disabled; 1e12 precision
      depositFeeBps: number;   // 0 = none
      withdrawalFeeBps: number; // 0 = none
    },
  ): Promise<TransactionInstruction> {
    const systemProgram = new PublicKey("11111111111111111111111111111111");
    const RENT_SYSVAR = new PublicKey("SysvarRent111111111111111111111111111111111");
    return this.program.methods
      .initializePool({
        marketId: Array.from(args.marketId),
        engineAuth: args.engineAuth,
        engineAuthBump: args.engineAuthBump,
        reserveFactor: new BN(args.reserveFactor.toString()),
        depositFeeBps: args.depositFeeBps,
        withdrawalFeeBps: args.withdrawalFeeBps,
      })
      .accounts({
        ...accounts,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram,
        rent: RENT_SYSVAR,
      })
      .instruction();
  }

  /**
   * Build an updatePoolConfig instruction.
   * All args are optional (Option<T> on-chain) — pass null to leave unchanged.
   */
  async updatePoolConfigIx(
    accounts: {
      admin: PublicKey;
      poolState: PublicKey;
    },
    args: {
      reserveFactor?: bigint | null;
      depositFeeBps?: number | null;
      withdrawalFeeBps?: number | null;
    },
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .updatePoolConfig({
        reserveFactor: args.reserveFactor != null ? new BN(args.reserveFactor.toString()) : null,
        depositFeeBps: args.depositFeeBps ?? null,
        withdrawalFeeBps: args.withdrawalFeeBps ?? null,
      })
      .accounts({
        poolState: accounts.poolState,
        admin: accounts.admin,
      })
      .instruction();
  }

  /**
   * Build a deposit instruction.
   *
   * The `minLpOut` field is the on-chain slippage floor: the instruction
   * reverts if the amount of LP tokens minted would be below it. Callers that
   * do not want a floor may pass `0n` to disable the check.
   *
   * @param accounts - all required accounts
   * @param args.amount - USDC amount in 6-decimal units
   * @param args.minLpOut - minimum LP tokens to mint; revert if mint < this
   */
  async depositIx(
    accounts: {
      poolState: PublicKey;
      usdcVault: PublicKey;
      vaultAuthority: PublicKey;
      lpMint: PublicKey;
      userLp: PublicKey;
      userUsdc: PublicKey;
      /**
       * Permanently-locked dead-shares vault, PDA([b"lp_dead", marketId]).
       * Required on every deposit: the on-chain ix `init_if_needed`-creates it on
       * the first deposit per pool and mints MINIMUM_LIQUIDITY here on genesis so
       * lp supply can never return to 0. Derive with `lpDeadPDA(marketId, ...)`.
       */
      lpDead: PublicKey;
      depositor: PublicKey;
    },
    args: { amount: bigint; minLpOut: bigint },
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .deposit(new BN(args.amount.toString()), new BN(args.minLpOut.toString()))
      .accounts({
        ...accounts,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Build a withdraw instruction.
   *
   * The `minOut` field is the on-chain slippage floor: the post-fee USDC
   * returned to the user must be at least this amount or the instruction
   * reverts. Callers that do not want a floor may pass `0n` to disable the
   * check.
   *
   * @param accounts - all required accounts
   * @param args.lpAmount - LP tokens to burn
   * @param args.minOut - minimum post-fee USDC to receive; revert if return < this
   */
  async withdrawIx(
    accounts: {
      poolState: PublicKey;
      usdcVault: PublicKey;
      vaultAuthority: PublicKey;
      lpMint: PublicKey;
      userLp: PublicKey;
      userUsdc: PublicKey;
      withdrawer: PublicKey;
    },
    args: { lpAmount: bigint; minOut: bigint },
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .withdraw(new BN(args.lpAmount.toString()), new BN(args.minOut.toString()))
      .accounts({ ...accounts, tokenProgram: TOKEN_PROGRAM_ID })
      .instruction();
  }

  /**
   * Build a sweep_fees instruction.
   * Moves accumulated non-LP fees from the USDC vault to the fee-pool USDC account.
   */
  async sweepFeesIx(accounts: {
    poolState: PublicKey;
    feeSettings: PublicKey;
    usdcVault: PublicKey;
    vaultAuthority: PublicKey;
    feePoolUsdc: PublicKey;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .sweepFees()
      .accounts({ ...accounts, tokenProgram: TOKEN_PROGRAM_ID })
      .instruction();
  }

  /**
   * Build an accrue_fee instruction.
   * Called by perp-engine via CPI to split fees between LP and non-LP buckets.
   */
  async accrueFeeIx(accounts: {
    poolState: PublicKey;
    feeSettings: PublicKey;
    engineAuth: PublicKey;
  }, amount: bigint, alreadyInPool: boolean): Promise<TransactionInstruction> {
    return this.program.methods
      .accrueFee(new BN(amount.toString()), alreadyInPool)
      .accounts(accounts)
      .instruction();
  }

  /**
   * Build a harvest instruction.
   * Permissionless — anyone may call to walk the queue head and pay out Pending entries.
   * Caller receives rent refunds when entry PDAs are closed.
   *
   * remaining_accounts contract (always-triples in queue order):
   *   For each entry to process: (entry_pda, user_claims_pda, user_usdc_ata)
   *   Voided entries still require all three slots; the transfer is skipped on-chain.
   *
   * @param accounts   Fixed accounts for the instruction.
   * @param maxEntries Upper bound on non-voided user payouts per call (compute guard).
   * @param remainingAccounts Alternating (entry, claims, ata) triples in queue order.
   */
  async harvestIx(
    accounts: {
      poolState: PublicKey;
      usdcVault: PublicKey;
      vaultAuthority: PublicKey;
      caller: PublicKey;
    },
    maxEntries: number,
    remainingAccounts: AccountMeta[],
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .harvest(maxEntries)
      .accounts({
        ...accounts,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts)
      .instruction();
  }

  /**
   * Build a void_queue_claim instruction.
   * Marks one Pending queue entry as Voided and decrements queue accounting.
   *
   * NOTE: In normal operation this is CPI-only, invoked by perp-engine's liquidate
   * via engine_auth. This builder is exposed for testing and administrative use.
   * Direct invocation requires the engine_auth PDA to be a signer.
   *
   * @param accounts Fixed accounts for the instruction.
   */
  async voidQueueClaimIx(accounts: {
    poolState: PublicKey;
    entry: PublicKey;
    userClaims: PublicKey;
    engineAuth: PublicKey;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .voidQueueClaim()
      .accounts(accounts)
      .instruction();
  }

  /**
   * Build an initialize_insurance_fund instruction.
   *
   * Creates the singleton InsuranceFund state PDA + USDC vault token account.
   * Must be called once per cluster after `initialize_protocol_config` and
   * before any liquidation occurs (otherwise the `accrue_to_insurance` CPI
   * from perp-engine's `liquidate.rs` reverts with AccountNotInitialized).
   *
   * @param accounts Required accounts (see #[derive(Accounts)] order).
   * @param args.admin Pubkey saved on InsuranceFund.admin — gates reimburse + withdraw.
   */
  async initializeInsuranceFundIx(
    accounts: {
      insuranceFund: PublicKey;
      usdcVault: PublicKey;
      vaultAuthority: PublicKey;
      usdcMint: PublicKey;
      payer: PublicKey;
    },
    args: { admin: PublicKey },
  ): Promise<TransactionInstruction> {
    const RENT_SYSVAR = new PublicKey("SysvarRent111111111111111111111111111111111");
    return this.program.methods
      .initializeInsuranceFund(args.admin)
      .accounts({
        ...accounts,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: RENT_SYSVAR,
      })
      .instruction();
  }

  /**
   * Build a reimburse_pool_from_fund instruction.
   *
   * Admin-only — transfers USDC from the singleton insurance vault to a
   * pool's USDC vault and bumps `pool.total_usdc`. Use after a bad-debt
   * event when LPs absorbed loss the insurance fund should cover.
   *
   * Reverts: `InsufficientInsuranceFund` if amount > vault balance;
   * `has_one = admin` violation if signer != fund.admin.
   *
   * @param accounts Required accounts in struct order.
   * @param args.amount USDC amount (6-decimal units) to reimburse.
   */
  async reimbursePoolFromFundIx(
    accounts: {
      insuranceFund: PublicKey;
      poolState: PublicKey;
      poolVaultUsdc: PublicKey;
      insuranceVault: PublicKey;
      vaultAuthority: PublicKey;
      admin: PublicKey;
    },
    args: { amount: bigint },
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .reimbursePoolFromFund(new BN(args.amount.toString()))
      .accounts({
        ...accounts,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  /**
   * Build a sweep_stranded_to_insurance instruction.
   *
   * Admin-only recovery for the stranded-balance windfall (companion to the
   * 2026-06-09 deposit guard). When a pool has `total_usdc > 0` while
   * `lp_mint.supply == 0`, the unowned free balance is moved to the insurance
   * vault so LPs can re-enter with a clean genesis mint.
   *
   * Reverts: `ZeroAmount` if amount == 0; `PoolHasLpSupply` if lp supply != 0
   * (funds are LP-owned); `InsufficientLiquidity` if amount > free_liquidity()
   * (would touch reserved collateral / queue-owed funds); `Unauthorized` if
   * signer != pool_state.admin.
   *
   * @param accounts Required accounts in struct order.
   * @param args.amount USDC amount (6-decimal units) to sweep.
   */
  async sweepStrandedToInsuranceIx(
    accounts: {
      poolState: PublicKey;
      poolVaultUsdc: PublicKey;
      vaultAuthority: PublicKey;
      lpMint: PublicKey;
      insuranceFund: PublicKey;
      insuranceVault: PublicKey;
      admin: PublicKey;
    },
    args: { amount: bigint },
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .sweepStrandedToInsurance(new BN(args.amount.toString()))
      .accounts({
        ...accounts,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  /**
   * Build a withdraw_insurance instruction.
   *
   * Admin escape hatch — drains arbitrary amount from the insurance vault
   * to an arbitrary USDC destination. Does NOT touch any pool's accounting
   * (this is policy adjustment, not bad-debt absorption).
   *
   * Reverts: `InsufficientInsuranceFund` if amount > vault balance;
   * `has_one = admin` violation if signer != fund.admin;
   * `WrongMint` if destination.mint != insurance_vault.mint.
   *
   * @param accounts Required accounts in struct order.
   * @param args.amount USDC amount (6-decimal units) to withdraw.
   */
  async withdrawInsuranceIx(
    accounts: {
      insuranceFund: PublicKey;
      insuranceVault: PublicKey;
      destination: PublicKey;
      vaultAuthority: PublicKey;
      admin: PublicKey;
    },
    args: { amount: bigint },
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .withdrawInsurance(new BN(args.amount.toString()))
      .accounts({
        ...accounts,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  /**
   * Build a drain_phantom_credit instruction.
   * Permissionless redemption of liquidation-overshoot phantom credits.
   * Gate: queue_total_owed must be 0 (all live Pending entries paid first).
   *
   * @param accounts Fixed accounts for the instruction.
   */
  async drainPhantomCreditIx(accounts: {
    poolState: PublicKey;
    usdcVault: PublicKey;
    vaultAuthority: PublicKey;
    userClaims: PublicKey;
    user: PublicKey;
    userUsdc: PublicKey;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .drainPhantomCredit()
      .accounts({
        ...accounts,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  /**
   * Build a convert_lp instruction (Phase 3 consolidation). A holder of a migrated
   * market's legacy LP burns `burnAmount` and receives unified CategoryPool LP from
   * the per-market escrow at the frozen migration ratio. Permissionless.
   */
  async convertLpIx(
    accounts: {
      categoryPool: PublicKey;
      marketRisk: PublicKey;
      oldLpMint: PublicKey;
      holderOldLp: PublicKey;
      lpConvertEscrow: PublicKey;
      categoryVaultAuthority: PublicKey;
      holderUnifiedLp: PublicKey;
      categoryLpMint: PublicKey;
      holder: PublicKey;
    },
    burnAmount: bigint,
  ): Promise<TransactionInstruction> {
    const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
    return this.program.methods
      .convertLp(new BN(burnAmount.toString()))
      .accounts({
        ...accounts,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Build a deposit_category instruction (Phase 3 unified pool). Adds USDC
   * liquidity to the shared CategoryPool and mints unified LP. `minLpOut` is the
   * on-chain slippage floor on the LP actually minted (pass 0n to disable).
   */
  async depositCategoryIx(
    accounts: {
      categoryPool: PublicKey;
      usdcVault: PublicKey;
      vaultAuthority: PublicKey;
      lpMint: PublicKey;
      userLp: PublicKey;
      userUsdc: PublicKey;
      /** PDA([b"category_lp_dead", categoryId]); init_if_needed on genesis. Derive with `categoryLpDeadPDA`. */
      lpDead: PublicKey;
      depositor: PublicKey;
    },
    args: { amount: bigint; minLpOut: bigint },
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .depositCategory(new BN(args.amount.toString()), new BN(args.minLpOut.toString()))
      .accounts({
        ...accounts,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Build a withdraw_category instruction (Phase 3 unified pool). Burns unified
   * LP and returns USDC (capped at the pool's free liquidity). `minOut` is the
   * on-chain slippage floor on USDC returned (pass 0n to disable).
   */
  async withdrawCategoryIx(
    accounts: {
      categoryPool: PublicKey;
      usdcVault: PublicKey;
      vaultAuthority: PublicKey;
      lpMint: PublicKey;
      userLp: PublicKey;
      userUsdc: PublicKey;
      withdrawer: PublicKey;
    },
    args: { lpAmount: bigint; minOut: bigint },
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .withdrawCategory(new BN(args.lpAmount.toString()), new BN(args.minOut.toString()))
      .accounts({
        ...accounts,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }
}
