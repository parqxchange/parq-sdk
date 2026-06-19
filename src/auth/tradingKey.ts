import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { tradingKeyPDA } from "../utils/pda";

const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");

/**
 * Build an unsigned `register_trading_key` instruction. Prefer this over
 * {@link registerTradingKey} when you simulate, batch, or route sends yourself.
 *
 * `ownerUsdc` is the wallet's USDC token account; register SPL-approves it over
 * the trading-key PDA so a delegate can move owner funds (Phase 1 register-approve).
 */
export async function buildRegisterTradingKeyIx(opts: {
  wallet: PublicKey;
  delegate: PublicKey;
  expiresAt: bigint;
  ownerUsdc: PublicKey;
  program: Program;
  perpEngineId: PublicKey;
}): Promise<TransactionInstruction> {
  const [tradingKeyPda] = tradingKeyPDA(opts.wallet, opts.perpEngineId);
  return opts.program.methods
    .registerTradingKey(opts.delegate, new BN(opts.expiresAt.toString()))
    .accounts({
      tradingKey: tradingKeyPda,
      wallet: opts.wallet,
      ownerUsdc: opts.ownerUsdc,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SYSTEM_PROGRAM,
    })
    .instruction();
}

/**
 * Build an unsigned `revoke_trading_key` instruction.
 *
 * `ownerUsdc` is the wallet's USDC token account; revoke SPL-revokes the
 * delegation approval the matching register installed (mirrors register's shape).
 */
export async function buildRevokeTradingKeyIx(opts: {
  wallet: PublicKey;
  ownerUsdc: PublicKey;
  program: Program;
  perpEngineId: PublicKey;
}): Promise<TransactionInstruction> {
  const [tradingKeyPda] = tradingKeyPDA(opts.wallet, opts.perpEngineId);
  return opts.program.methods
    .revokeTradingKey()
    .accounts({
      tradingKey: tradingKeyPda,
      wallet: opts.wallet,
      ownerUsdc: opts.ownerUsdc,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

/**
 * Register a trading key (delegate) for a wallet — **submits immediately** via `.rpc()`.
 *
 * @deprecated Prefer {@link buildRegisterTradingKeyIx} + your own send/simulate path
 *   (surprising `.rpc()` footgun in scripts — see SDK README “Sharp corners”).
 */
export async function registerTradingKey(opts: {
  wallet: Keypair;
  delegate: PublicKey;
  expiresAt: bigint;
  ownerUsdc: PublicKey;
  program: Program;
  perpEngineId: PublicKey;
}): Promise<string> {
  const [tradingKeyPda] = tradingKeyPDA(opts.wallet.publicKey, opts.perpEngineId);
  return opts.program.methods
    .registerTradingKey(opts.delegate, new BN(opts.expiresAt.toString()))
    .accounts({
      tradingKey: tradingKeyPda,
      wallet: opts.wallet.publicKey,
      ownerUsdc: opts.ownerUsdc,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SYSTEM_PROGRAM,
    })
    .signers([opts.wallet])
    .rpc();
}

/**
 * Revoke the trading key for a wallet — **submits immediately** via `.rpc()`.
 *
 * @deprecated Prefer {@link buildRevokeTradingKeyIx} + your own send path.
 */
export async function revokeTradingKey(opts: {
  wallet: Keypair;
  ownerUsdc: PublicKey;
  program: Program;
  perpEngineId: PublicKey;
}): Promise<string> {
  const [tradingKeyPda] = tradingKeyPDA(opts.wallet.publicKey, opts.perpEngineId);
  return opts.program.methods
    .revokeTradingKey()
    .accounts({
      tradingKey: tradingKeyPda,
      wallet: opts.wallet.publicKey,
      ownerUsdc: opts.ownerUsdc,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([opts.wallet])
    .rpc();
}

/**
 * Load a Keypair from a JSON key file (standard Solana format: array of 64 bytes).
 * Node.js only — use `Keypair.fromSecretKey()` directly in browsers.
 * For npm consumers, import from `@parqxchange/sdk/node` so bundlers do not pull `fs`.
 */
export function loadTradingKeypair(path: string): Keypair {
  if (typeof globalThis.process === "undefined") {
    throw new Error("loadTradingKeypair is Node.js only — use Keypair.fromSecretKey() in browsers");
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs") as typeof import("fs");
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    throw new Error("loadTradingKeypair: invalid key file (JSON parse failed)");
  }
  if (
    !Array.isArray(raw) ||
    raw.length !== 64 ||
    !raw.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
  ) {
    throw new Error("loadTradingKeypair: key file must be a JSON array of 64 byte values");
  }
  return Keypair.fromSecretKey(Uint8Array.from(raw as number[]));
}
