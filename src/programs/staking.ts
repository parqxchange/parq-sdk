import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

/**
 * Staking instruction builders.
 *
 * The staked side accepts either legacy SPL Token or Token-2022 (PARQ is
 * Token-2022; reward USDC stays legacy). Callers
 * probe each mint's owning program (see `utils/tokenProgram.probeTokenProgram`)
 * and pass it in per-side. The new mint accounts are required by
 * `transfer_checked` (mint + decimals). Program-id params default to
 * `TOKEN_PROGRAM_ID` so legacy-only call sites stay unchanged.
 */
export class StakingClient {
  constructor(private readonly program: Program) {}

  async stakeIx(accounts: {
    owner: PublicKey;
    stakingPool: PublicKey;
    stakePosition: PublicKey;
    stakedVault: PublicKey;
    ownerTokenAccount: PublicKey;
    /** Staked mint (PARQ / LP). Required by `transfer_checked`. */
    tokenMint: PublicKey;
    /** Token program owning the staked mint. Defaults to legacy SPL Token. */
    tokenProgram?: PublicKey;
    rewardUsdc?: PublicKey;
    rewardVault?: PublicKey;
  }, amount: bigint, tier: number): Promise<TransactionInstruction> {
    const accs: Record<string, PublicKey> = {
      owner: accounts.owner,
      stakingPool: accounts.stakingPool,
      stakePosition: accounts.stakePosition,
      stakedVault: accounts.stakedVault,
      ownerTokenAccount: accounts.ownerTokenAccount,
      tokenMint: accounts.tokenMint,
      tokenProgram: accounts.tokenProgram ?? TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
    if (accounts.rewardUsdc) accs.rewardUsdc = accounts.rewardUsdc;
    if (accounts.rewardVault) accs.rewardVault = accounts.rewardVault;
    return this.program.methods
      .stake({ amount: new BN(amount.toString()), tier })
      .accounts(accs)
      .instruction();
  }

  async unstakeIx(accounts: {
    owner: PublicKey;
    stakingPool: PublicKey;
    stakePosition: PublicKey;
    stakedVault: PublicKey;
    ownerTokenAccount: PublicKey;
    /** Staked (principal) mint. Required by `transfer_checked`. */
    stakedMint: PublicKey;
    /** Reward mint (USDC for BalanceBased, proto for EmissionSchedule). */
    rewardMint: PublicKey;
    /** Token program owning the staked mint. Defaults to legacy SPL Token. */
    stakedTokenProgram?: PublicKey;
    /** Token program owning the reward mint. Defaults to legacy SPL Token. */
    rewardTokenProgram?: PublicKey;
    rewardUsdc?: PublicKey;
    ownerUsdcAccount?: PublicKey;
    rewardVault?: PublicKey;
    ownerRewardAccount?: PublicKey;
  }): Promise<TransactionInstruction> {
    // Anchor 0.31 requires optional accounts to be passed EXPLICITLY when unused —
    // omitting the key throws "Account `X` not provided." Pass the program ID
    // (Anchor's None sentinel — what `null` is internally converted to) for the
    // unused reward-source side; on-chain `Option` then reads None. The caller
    // supplies the BalanceBased (reward_usdc/owner_usdc) OR EmissionSchedule
    // (reward_vault/owner_reward) side.
    const noneAcct = this.program.programId;
    const accs: Record<string, PublicKey> = {
      owner: accounts.owner,
      stakingPool: accounts.stakingPool,
      stakePosition: accounts.stakePosition,
      stakedVault: accounts.stakedVault,
      ownerTokenAccount: accounts.ownerTokenAccount,
      stakedMint: accounts.stakedMint,
      rewardMint: accounts.rewardMint,
      stakedTokenProgram: accounts.stakedTokenProgram ?? TOKEN_PROGRAM_ID,
      rewardTokenProgram: accounts.rewardTokenProgram ?? TOKEN_PROGRAM_ID,
      rewardUsdc: accounts.rewardUsdc ?? noneAcct,
      ownerUsdcAccount: accounts.ownerUsdcAccount ?? noneAcct,
      rewardVault: accounts.rewardVault ?? noneAcct,
      ownerRewardAccount: accounts.ownerRewardAccount ?? noneAcct,
    };
    return this.program.methods
      .unstake()
      .accounts(accs)
      .instruction();
  }

  async claimRewardIx(accounts: {
    owner: PublicKey;
    stakingPool: PublicKey;
    stakePosition: PublicKey;
    /** Reward mint (USDC for BalanceBased, proto for EmissionSchedule). */
    rewardMint: PublicKey;
    /** Token program owning the reward mint. Defaults to legacy SPL Token. */
    rewardTokenProgram?: PublicKey;
    rewardUsdc?: PublicKey;
    ownerUsdcAccount?: PublicKey;
    rewardVault?: PublicKey;
    ownerRewardAccount?: PublicKey;
  }): Promise<TransactionInstruction> {
    // Anchor 0.31 requires optional accounts to be passed EXPLICITLY when unused —
    // omitting the key throws "Account `X` not provided". Pass the program ID
    // (Anchor's None sentinel — what `null` is internally converted to) for the
    // unused reward-source side; on-chain
    // `Option` then reads None. The caller supplies the BalanceBased
    // (reward_usdc/owner_usdc) OR EmissionSchedule (reward_vault/owner_reward) side.
    const noneAcct = this.program.programId;
    const accs: Record<string, PublicKey> = {
      owner: accounts.owner,
      stakingPool: accounts.stakingPool,
      stakePosition: accounts.stakePosition,
      rewardMint: accounts.rewardMint,
      rewardTokenProgram: accounts.rewardTokenProgram ?? TOKEN_PROGRAM_ID,
      rewardUsdc: accounts.rewardUsdc ?? noneAcct,
      ownerUsdcAccount: accounts.ownerUsdcAccount ?? noneAcct,
      rewardVault: accounts.rewardVault ?? noneAcct,
      ownerRewardAccount: accounts.ownerRewardAccount ?? noneAcct,
    };
    return this.program.methods
      .claimReward()
      .accounts(accs)
      .instruction();
  }

  async updateRewardIndexIx(accounts: {
    stakingPool: PublicKey;
    rewardUsdc?: PublicKey;
  }): Promise<TransactionInstruction> {
    const accs: Record<string, PublicKey> = {
      stakingPool: accounts.stakingPool,
    };
    if (accounts.rewardUsdc) accs.rewardUsdc = accounts.rewardUsdc;
    return this.program.methods
      .updateRewardIndex()
      .accounts(accs)
      .instruction();
  }

  async initializeEmissionPoolIx(accounts: {
    admin: PublicKey;
    stakingPool: PublicKey;
    /** Staked LP mint (validated against the §6 extension allowlist). */
    stakedMint: PublicKey;
    /** Reward (proto) mint. Required by `transfer_checked`. */
    rewardMint: PublicKey;
    adminRewardTokens: PublicKey;
    rewardVault: PublicKey;
    /** Token program for the interface CPI. Defaults to legacy SPL Token. */
    tokenProgram?: PublicKey;
  }, totalAllocation: bigint, durationSeconds: bigint): Promise<TransactionInstruction> {
    return this.program.methods
      .initializeEmissionPool({
        tokenMint: accounts.stakedMint,
        rewardMint: accounts.rewardMint,
        totalAllocation: new BN(totalAllocation.toString()),
        durationSeconds: new BN(durationSeconds.toString()),
      })
      .accounts({
        admin: accounts.admin,
        stakingPool: accounts.stakingPool,
        stakedMint: accounts.stakedMint,
        rewardMint: accounts.rewardMint,
        adminRewardTokens: accounts.adminRewardTokens,
        rewardVault: accounts.rewardVault,
        tokenProgram: accounts.tokenProgram ?? TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async claimAndRestakeIx(accounts: {
    owner: PublicKey;
    lpStakingPool: PublicKey;
    lpStakePosition: PublicKey;
    lpRewardVault: PublicKey;
    protoStakingPool: PublicKey;
    protoStakePosition: PublicKey;
    protoStakedVault: PublicKey;
    /** Proto (restaked) mint. Required by `transfer_checked`. */
    protoMint: PublicKey;
    protoRewardUsdc: PublicKey;
    /** Token program owning the proto mint. Defaults to legacy SPL Token. */
    tokenProgram?: PublicKey;
  }, tier: number): Promise<TransactionInstruction> {
    return this.program.methods
      .claimAndRestake({ tier })
      .accounts({
        owner: accounts.owner,
        lpStakingPool: accounts.lpStakingPool,
        lpStakePosition: accounts.lpStakePosition,
        lpRewardVault: accounts.lpRewardVault,
        protoStakingPool: accounts.protoStakingPool,
        protoStakePosition: accounts.protoStakePosition,
        protoStakedVault: accounts.protoStakedVault,
        protoMint: accounts.protoMint,
        protoRewardUsdc: accounts.protoRewardUsdc,
        tokenProgram: accounts.tokenProgram ?? TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async reclaimUnallocatedIx(accounts: {
    admin: PublicKey;
    stakingPool: PublicKey;
    rewardVault: PublicKey;
    /** Reward (proto) mint. Required by `transfer_checked`. */
    rewardMint: PublicKey;
    adminTokenAccount: PublicKey;
    /** Token program owning the reward mint. Defaults to legacy SPL Token. */
    tokenProgram?: PublicKey;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .reclaimUnallocated()
      .accounts({
        admin: accounts.admin,
        stakingPool: accounts.stakingPool,
        rewardVault: accounts.rewardVault,
        rewardMint: accounts.rewardMint,
        adminTokenAccount: accounts.adminTokenAccount,
        tokenProgram: accounts.tokenProgram ?? TOKEN_PROGRAM_ID,
      })
      .instruction();
  }
}
