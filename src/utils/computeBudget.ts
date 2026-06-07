import { ComputeBudgetProgram, TransactionInstruction } from "@solana/web3.js";

/**
 * Prepend compute budget instructions to a list of instructions.
 * Suggested CU limits: trading 400k, liquidity 200k, crank 250k.
 *
 * **Defaults are not chain-safe under congestion** — `400_000` CU and `0` µ-lamports
 * priority often need tuning per route; measure in simulation and production.
 *
 * @param ixs - instructions to wrap
 * @param opts.units - compute unit limit (default 400_000)
 * @param opts.microLamports - priority fee per CU (default 0 = no priority fee)
 */
export function withComputeBudget(
  ixs: TransactionInstruction[],
  opts?: {
    units?: number;
    microLamports?: number;
  },
): TransactionInstruction[] {
  const units = opts?.units ?? 400_000;
  const prefix: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units }),
  ];
  if (opts?.microLamports && opts.microLamports > 0) {
    prefix.push(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: opts.microLamports }),
    );
  }
  return [...prefix, ...ixs];
}
