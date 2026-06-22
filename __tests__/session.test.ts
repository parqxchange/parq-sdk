/**
 * WP-6: session-key helper smoke tests.
 */
import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { generateSessionKey, buildEnableSession, signWithSession } from "../src/auth/session";

function makeMockProgram(): Program {
  const dummyIx = new TransactionInstruction({ keys: [], programId: PublicKey.default, data: Buffer.alloc(0) });
  const chain = {
    accounts: () => ({ instruction: async (): Promise<TransactionInstruction> => dummyIx }),
  };
  return { methods: { registerTradingKey: () => chain } } as unknown as Program;
}

describe("session-key helpers (WP-6)", () => {
  it("generateSessionKey returns a fresh Keypair each call", () => {
    const a = generateSessionKey();
    const b = generateSessionKey();
    expect(a).toBeInstanceOf(Keypair);
    expect(a.publicKey.equals(b.publicKey)).toBe(false);
  });

  it("buildEnableSession returns the register instruction", async () => {
    const ixs = await buildEnableSession({
      wallet: Keypair.generate().publicKey,
      sessionPub: generateSessionKey().publicKey,
      expiresAt: 1_800_000_000n,
      ownerUsdc: Keypair.generate().publicKey,
      program: makeMockProgram(),
      perpEngineId: new PublicKey("11111111111111111111111111111112"),
    });
    expect(ixs).toHaveLength(1);
    expect(ixs[0]).toBeInstanceOf(TransactionInstruction);
  });

  it("signWithSession partial-signs a legacy transaction", () => {
    const session = generateSessionKey();
    const tx = new Transaction();
    tx.recentBlockhash = "11111111111111111111111111111111";
    tx.feePayer = session.publicKey;
    tx.add(new TransactionInstruction({
      keys: [{ pubkey: session.publicKey, isSigner: true, isWritable: true }],
      programId: PublicKey.default,
      data: Buffer.alloc(0),
    }));
    const out = signWithSession(tx, session);
    expect(out).toBe(tx);
    expect(tx.signatures.some((s) => s.publicKey.equals(session.publicKey) && s.signature !== null)).toBe(true);
  });
});
