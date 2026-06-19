import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { PoolClient } from "../programs/pool";
import { poolStatePDA, vaultAuthorityPDA, lpMintPDA, usdcVaultPDA, lpDeadPDA } from "../utils/pda";

export interface LiquidityOpts {
  poolClient:    PoolClient;
  poolProgramId: PublicKey;
  marketId:      Uint8Array;
}

export async function addLiquidity(
  opts: LiquidityOpts,
  accounts: {
    depositor: PublicKey;
    userUsdc:  PublicKey;
    userLp:    PublicKey;
  },
  args: { amountUsdc: bigint; minLpOut: bigint },
): Promise<TransactionInstruction[]> {
  const [poolState]      = poolStatePDA(opts.marketId, opts.poolProgramId);
  const [vaultAuthority] = vaultAuthorityPDA(opts.marketId, opts.poolProgramId);
  const [lpMint]         = lpMintPDA(opts.marketId, opts.poolProgramId);
  const [usdcVault]      = usdcVaultPDA(opts.marketId, opts.poolProgramId);
  const [lpDead]         = lpDeadPDA(opts.marketId, opts.poolProgramId);

  const ix = await opts.poolClient.depositIx(
    { poolState, usdcVault, vaultAuthority, lpMint, userLp: accounts.userLp, userUsdc: accounts.userUsdc, lpDead, depositor: accounts.depositor },
    { amount: args.amountUsdc, minLpOut: args.minLpOut },
  );
  return [ix];
}

export async function removeLiquidity(
  opts: LiquidityOpts,
  accounts: {
    withdrawer: PublicKey;
    userUsdc:   PublicKey;
    userLp:     PublicKey;
  },
  args: { lpAmount: bigint; minOut: bigint },
): Promise<TransactionInstruction[]> {
  const [poolState]      = poolStatePDA(opts.marketId, opts.poolProgramId);
  const [vaultAuthority] = vaultAuthorityPDA(opts.marketId, opts.poolProgramId);
  const [lpMint]         = lpMintPDA(opts.marketId, opts.poolProgramId);
  const [usdcVault]      = usdcVaultPDA(opts.marketId, opts.poolProgramId);

  const ix = await opts.poolClient.withdrawIx(
    { poolState, usdcVault, vaultAuthority, lpMint, userLp: accounts.userLp, userUsdc: accounts.userUsdc, withdrawer: accounts.withdrawer },
    { lpAmount: args.lpAmount, minOut: args.minOut },
  );
  return [ix];
}
