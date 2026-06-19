import { ComputeBudgetProgram, TransactionInstruction } from "@solana/web3.js";

/**
 * Per-family CU suggestions from the audit §3 simulate sweep (OPT-P2-10).
 * Used by the frontend (OPT-P1-7) and the volume tool — import from `@parquet/sdk`.
 * Re-measure before tightening; `tpsl` is intentionally above 200k (atomic sequence).
 */
export const SUGGESTED_CU = {
  open: 150_000,
  close: 150_000,
  margin: 100_000,
  cancel: 40_000,
  limit: 60_000,
  tpsl: 300_000,
} as const;

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
