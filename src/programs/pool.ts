import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, TransactionInstruction, AccountMeta } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { creditAccountPda } from "../utils/pda";

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

  // ---------------------------------------------------------------------------
  // Trading credit (2026-06-18) — promotional-credit subsystem
  // ---------------------------------------------------------------------------

  /**
   * Build an initialize_credit_treasury instruction.
   *
   * Creates the singleton CreditTreasury state PDA (`[b"credit_treasury"]`) +
   * its USDC vault token account (`[b"credit_vault"]`, owned by the
   * `[b"credit_vault_authority"]` PDA). Must be called once per cluster before
   * any grant/fund/draw. The `admin` signer is also the payer and is saved as
   * `CreditTreasury.admin` (gates grant/revoke/fund/withdraw).
   *
   * Derive: `creditTreasuryPda`, `creditVaultPda`, `creditVaultAuthorityPda`.
   */
  async initializeCreditTreasuryIx(accounts: {
    creditTreasury: PublicKey;
    creditVault: PublicKey;
    creditVaultAuthority: PublicKey;
    usdcMint: PublicKey;
    admin: PublicKey;
  }): Promise<TransactionInstruction> {
    const RENT_SYSVAR = new PublicKey("SysvarRent111111111111111111111111111111111");
    return this.program.methods
      .initializeCreditTreasury()
      .accounts({
        ...accounts,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: RENT_SYSVAR,
      })
      .instruction();
  }

  /**
   * Build a grant_credit instruction (admin-only).
   *
   * Adds a `GrantLot { remaining: amount, expires_at }` to `user`'s CreditAccount
   * (`init_if_needed`) and bumps `CreditTreasury.total_outstanding`. No token
   * transfer — the vault is funded out-of-band; this only mints an entitlement.
   *
   * @param accounts.user the grantee (NOT a signer — seeds the credit_account PDA).
   * @param args.amount    USDC micro-units to grant (> 0).
   * @param args.expiresAt unix-seconds expiry of the lot.
   */
  async grantCreditIx(
    accounts: {
      creditTreasury: PublicKey;
      creditAccount: PublicKey;
      user: PublicKey;
      admin: PublicKey;
    },
    args: { amount: bigint; expiresAt: bigint | number },
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .grantCredit(new BN(args.amount.toString()), new BN(args.expiresAt.toString()))
      .accounts({
        ...accounts,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Build a revoke_credit instruction (admin-only).
   *
   * Claws back up to `amount` of *available* (un-deployed, unexpired) credit from
   * `user`'s lots (latest-first, capped at the available balance — pass `u64::MAX`
   * to revoke everything) and debits `CreditTreasury.total_outstanding`. Deployed
   * credit in open positions is untouched. No token transfer.
   */
  async revokeCreditIx(
    accounts: {
      creditTreasury: PublicKey;
      creditAccount: PublicKey;
      user: PublicKey;
      admin: PublicKey;
    },
    args: { amount: bigint },
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .revokeCredit(new BN(args.amount.toString()))
      .accounts(accounts)
      .instruction();
  }

  /**
   * Build a sweep_expired_credit instruction (permissionless crank).
   *
   * Zeroes any of `user`'s lots whose `expires_at` has passed and debits
   * `CreditTreasury.total_outstanding` by the swept total. No admin gate (the
   * `payer` signer just covers the tx fee). Keeps the counter honest.
   */
  async sweepExpiredCreditIx(accounts: {
    creditTreasury: PublicKey;
    creditAccount: PublicKey;
    user: PublicKey;
    payer: PublicKey;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .sweepExpiredCredit()
      .accounts(accounts)
      .instruction();
  }

  /**
   * Build a close_credit_account instruction (permissionless rent reclaim, PERF-8).
   *
   * Closes a FULLY SETTLED CreditAccount and refunds its ~0.00212 SOL rent to
   * `owner`. No CPI, no token transfer, no admin gate (anyone may crank it for
   * any owner). The on-chain constraint gates on `deployed == 0` AND every lot
   * empty (`Σ remaining == 0`) — so callers must first run `sweep_expired_credit`
   * to clear any expired-but-un-swept lots (otherwise reverts
   * `CreditAccountNotSettled`). The SAFE gate (all-lots-empty, not just
   * `credit_available == 0`) guarantees expired credit is returned to the
   * treasury before the PDA disappears, so no `total_outstanding` reservation is
   * stranded. The on-chain ix mirrors `close_user_queue_claims` (OPT-P2-3).
   */
  async closeCreditAccountIx(accounts: {
    creditAccount: PublicKey;
    owner: PublicKey;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .closeCreditAccount()
      .accounts(accounts)
      .instruction();
  }

  /**
   * Build a fund_credit_treasury instruction (admin-only).
   *
   * Plain SPL transfer of `amount` USDC from the admin's ATA into the treasury
   * vault. No counter change (funding is cash, not an entitlement). `creditVault`
   * must equal `CreditTreasury.usdc_vault` (on-chain `address =` constraint).
   */
  async fundCreditTreasuryIx(
    accounts: {
      creditTreasury: PublicKey;
      creditVault: PublicKey;
      adminUsdc: PublicKey;
      admin: PublicKey;
    },
    args: { amount: bigint },
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .fundCreditTreasury(new BN(args.amount.toString()))
      .accounts({
        ...accounts,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  /**
   * Build a withdraw_credit_treasury instruction (admin-only).
   *
   * Pulls `amount` USDC out of the treasury vault to the admin's ATA, signed by
   * the `credit_vault_authority` PDA. Floor-guarded: the post-withdraw balance
   * must stay >= `CreditTreasury.total_deployed` (reverts
   * `CreditWithdrawBelowDeployed`). No counter change.
   */
  async withdrawCreditTreasuryIx(
    accounts: {
      creditTreasury: PublicKey;
      creditVault: PublicKey;
      creditVaultAuthority: PublicKey;
      adminUsdc: PublicKey;
      admin: PublicKey;
    },
    args: { amount: bigint },
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .withdrawCreditTreasury(new BN(args.amount.toString()))
      .accounts({
        ...accounts,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  /**
   * Read the available (drawable) credit for `owner`: the sum of `lots[i].remaining`
   * across the CreditAccount whose `expires_at` is strictly in the future. Returns
   * `0n` if the CreditAccount PDA does not exist.
   *
   * Uses a raw `getAccountInfo` + fixed-offset byte decode (the CreditAccount
   * layout is frozen at 177 bytes) rather than an Anchor decode, so it stays cheap
   * and does not depend on the IDL-typed account namespace.
   *
   * Layout (`programs/pool-program/src/state.rs`, CreditAccount::LEN = 177):
   *   disc(8) owner(32) lots[8]×{ remaining:u64(8) expires_at:i64(8) }(128) deployed(8) bump(1)
   *
   * @param owner the wallet to read credit for.
   * @param nowSecs unix-seconds "now" used for the expiry filter; defaults to the
   *   local clock (`Date.now()/1000`). Pass the cluster clock for parity with chain.
   */
  async getAvailableCredit(owner: PublicKey, nowSecs?: number): Promise<bigint> {
    const [pda] = creditAccountPda(owner, this.program.programId);
    const info = await this.program.provider.connection.getAccountInfo(pda);
    if (!info) return 0n;
    const data = info.data;
    const LOTS_OFFSET = 8 + 32; // disc + owner
    const LOT_COUNT = 8;
    const LOT_SIZE = 16; // remaining(8) + expires_at(8)
    if (data.length < LOTS_OFFSET + LOT_COUNT * LOT_SIZE) return 0n;
    const now = BigInt(Math.floor(nowSecs ?? Date.now() / 1000));
    let total = 0n;
    for (let i = 0; i < LOT_COUNT; i++) {
      const base = LOTS_OFFSET + i * LOT_SIZE;
      const remaining = data.readBigUInt64LE(base);
      const expiresAt = data.readBigInt64LE(base + 8);
      // Mirror the on-chain "available" predicate: a non-empty lot whose expiry is
      // still in the future. (remaining == 0 lots contribute nothing regardless.)
      if (remaining > 0n && expiresAt > now) {
        total += remaining;
      }
    }
    return total;
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
