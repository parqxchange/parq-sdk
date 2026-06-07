import {
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  PublicKey,
  AddressLookupTableAccount,
} from "@solana/web3.js";

/**
 * Build a versioned (v0) transaction from instructions.
 * Optional: pass address lookup tables for compressed account keys.
 */
export function buildVersionedTransaction(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  blockhash: string,
  lookupTables?: AddressLookupTableAccount[],
): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTables);
  return new VersionedTransaction(message);
}
