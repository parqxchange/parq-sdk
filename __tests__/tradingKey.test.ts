import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import {
  buildRegisterTradingKeyIx,
  buildRevokeTradingKeyIx,
} from "../src/auth/tradingKey";

function makeMockProgram(): Program {
  const dummyIx = new TransactionInstruction({ keys: [], programId: PublicKey.default, data: Buffer.alloc(0) });
  const chain = {
    accounts: () => ({
      instruction: async (): Promise<TransactionInstruction> => dummyIx,
    }),
  };
  return {
    methods: {
      registerTradingKey: () => chain,
      revokeTradingKey: () => chain,
    },
  } as unknown as Program;
}

describe("trading-key ix builders", () => {
  const program = makeMockProgram();
  const perpEngineId = new PublicKey("11111111111111111111111111111112");
  const wallet = Keypair.generate().publicKey;
  const delegate = Keypair.generate().publicKey;
  const ownerUsdc = Keypair.generate().publicKey;

  it("buildRegisterTradingKeyIx returns an instruction", async () => {
    const ix = await buildRegisterTradingKeyIx({
      wallet,
      delegate,
      expiresAt: 1_700_000_000n,
      ownerUsdc,
      program,
      perpEngineId,
    });
    expect(ix).toBeInstanceOf(TransactionInstruction);
  });

  it("buildRevokeTradingKeyIx returns an instruction", async () => {
    const ix = await buildRevokeTradingKeyIx({
      wallet,
      ownerUsdc,
      program,
      perpEngineId,
    });
    expect(ix).toBeInstanceOf(TransactionInstruction);
  });
});
