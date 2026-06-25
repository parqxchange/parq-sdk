import { Keypair, PublicKey, Transaction, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { buildRegisterTradingKeyIx } from "./tradingKey";

/**
 * Generate a fresh ephemeral session key (a delegate keypair).
 *
 * The public key is registered as a trading key (delegate) via
 * {@link buildEnableSession}; the secret key is held client-side (e.g. browser
 * session storage / a mobile secure enclave) and signs trade txs without
 * re-prompting the wallet. Treat the secret as session-scoped and disposable —
 * revoke (`revoke_trading_key`) when the session ends.
 */
export function generateSessionKey(): Keypair {
  return Keypair.generate();
}

/**
 * Build the instructions to enable a trading session for `wallet`, delegating to
 * `sessionPub` until `expiresAt` (unix seconds).
 *
 * This is just the `register_trading_key` instruction — the SPL delegate approve
 * is performed on-chain inside the register handler (register-approve), so no
 * separate approve ix is needed. The owner (`wallet`) must sign the returned ix.
 */
export async function buildEnableSession(opts: {
  wallet: PublicKey;
  sessionPub: PublicKey;
  expiresAt: bigint;
  ownerUsdc: PublicKey;
  program: Program;
  perpEngineId: PublicKey;
}): Promise<TransactionInstruction[]> {
  const ix = await buildRegisterTradingKeyIx({
    wallet: opts.wallet,
    delegate: opts.sessionPub,
    expiresAt: opts.expiresAt,
    ownerUsdc: opts.ownerUsdc,
    program: opts.program,
    perpEngineId: opts.perpEngineId,
  });
  return [ix];
}

/**
 * Partial-sign `tx` with the session key (a convenience over the raw web3.js
 * `partialSign`/`sign`). Works for both legacy and versioned transactions.
 * Returns the same tx for chaining.
 */
export function signWithSession<T extends Transaction | VersionedTransaction>(
  tx: T,
  sessionKey: Keypair,
): T {
  if (tx instanceof VersionedTransaction) {
    tx.sign([sessionKey]);
  } else {
    tx.partialSign(sessionKey);
  }
  return tx;
}
