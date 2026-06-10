import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

export class FeeDistributorClient {
  constructor(private readonly program: Program) {}

  async distributeFeesIx(accounts: {
    feePool: PublicKey;
    usdcAccount: PublicKey;
    stakingReward: PublicKey;
    treasury: PublicKey;
    referralReserve: PublicKey;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .distributeFees()
      .accounts({ ...accounts, tokenProgram: TOKEN_PROGRAM_ID })
      .instruction();
  }

  async updateFeeSplitIx(accounts: {
    admin: PublicKey;
    feePool: PublicKey;
  }, args: {
    stakerSplitBps: number;
    treasurySplitBps: number;
    referralSplitBps: number;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .updateFeeSplit(args)
      .accounts(accounts)
      .instruction();
  }

  async updateFeePoolAccountsIx(accounts: {
    admin: PublicKey;
    feePool: PublicKey;
    usdcMint: PublicKey;
    usdcAccount: PublicKey;
    stakingReward: PublicKey;
    treasury: PublicKey;
    referralReserve: PublicKey;
  }): Promise<TransactionInstruction> {
    return this.program.methods
      .updateFeePoolAccounts()
      .accounts(accounts)
      .instruction();
  }

  async withdrawTreasuryIx(accounts: {
    admin: PublicKey;
    feePool: PublicKey;
    treasury: PublicKey;
    destination: PublicKey;
  }, amount: bigint): Promise<TransactionInstruction> {
    return this.program.methods
      .withdrawTreasury({ amount: new BN(amount.toString()) })
      .accounts({ ...accounts, tokenProgram: TOKEN_PROGRAM_ID })
      .instruction();
  }

  async disburseReferralIx(accounts: {
    engineAuth: PublicKey;
    feePool: PublicKey;
    referralReserve: PublicKey;
    affiliateUsdc: PublicKey;
  }, amount: bigint, marketId: Uint8Array): Promise<TransactionInstruction> {
    return this.program.methods
      .disburseReferral({ amount: new BN(amount.toString()), marketId: Array.from(marketId) })
      .accounts({ ...accounts, tokenProgram: TOKEN_PROGRAM_ID })
      .instruction();
  }
}
