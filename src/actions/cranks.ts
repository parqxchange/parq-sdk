import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { PerpClient } from "../programs/perp";
import { marketStatePDA, poolStatePDA } from "../utils/pda";

/**
 * Build instructions to crank the funding rate update (permissionless).
 * M-2 fix: now derives poolState PDA from poolProgramId.
 */
export async function crankFundingRate(opts: {
  perpClient:    PerpClient;
  perpEngineId:  PublicKey;
  poolProgramId: PublicKey;
  marketId:      Uint8Array;
}): Promise<TransactionInstruction[]> {
  const [marketState] = marketStatePDA(opts.marketId, opts.perpEngineId);
  const [poolState]   = poolStatePDA(opts.marketId, opts.poolProgramId);
  const ix = await opts.perpClient.updateFundingRateIx({ marketState, poolState });
  return [ix];
}
