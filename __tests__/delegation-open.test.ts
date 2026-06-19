/**
 * WP-6: assert the open-position action threads the owner/signer split through
 * to the PerpClient builder — the Position PDA must seed on the OWNER (not the
 * delegate signer), and `owner` + `tradingKey` must reach the builder.
 *
 * Strategy: a stub PerpClient records the accounts dict openPositionIx receives;
 * the action does the PDA derivation, so the assertion is purely TS-side.
 */
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { openPosition } from "../src/actions/trading";
import { positionPDA } from "../src/utils/pda";
import type { PerpClient, OpenPositionArgs } from "../src/programs/perp";

const PERP = new PublicKey("6QrsMTMEu9rsLpyxQgRdvQsWoPgHGY9npNNiwTtXsbdc");
const POOL = new PublicKey("11111111111111111111111111111112");
const ORACLE = new PublicKey("11111111111111111111111111111113");

const ARGS: OpenPositionArgs = {
  side: { long: {} },
  sizeUsdc: 1_000_000n,
  walletCollateral: 100_000n,
  fromQueueAmount: 0n,
  acceptablePrice: 0n,
  minOutputUsdc: 0n,
  positionNonce: 7n,
  referralCode: new Array(32).fill(0),
};

function stubClient(): { client: PerpClient; seen: () => Record<string, unknown> } {
  let captured: Record<string, unknown> = {};
  const client = {
    openPositionIx: async (accounts: Record<string, unknown>) => {
      captured = accounts;
      return new TransactionInstruction({ keys: [], programId: PublicKey.default, data: Buffer.alloc(0) });
    },
  } as unknown as PerpClient;
  return { client, seen: () => captured };
}

describe("openPosition owner/signer split (WP-6)", () => {
  const marketId = new Uint8Array(16).fill(3);
  const owner = Keypair.generate().publicKey;     // wallet owner
  const signer = Keypair.generate().publicKey;    // delegate
  const tradingKey = Keypair.generate().publicKey;
  const signerUsdc = Keypair.generate().publicKey;

  const opts = {
    perpEngineId: PERP, poolProgramId: POOL, oracleProgramId: ORACLE,
    marketId,
    primaryFeedAccount: PublicKey.default,
    secondaryFeedAccount: PublicKey.default,
  };

  it("derives the Position PDA from owner (not the delegate signer)", async () => {
    const { client, seen } = stubClient();
    await openPosition(
      { ...opts, perpClient: client },
      { signer, owner, signerUsdc, tradingKey },
      ARGS,
    );
    const accounts = seen();
    const [expected] = positionPDA(owner, marketId, ARGS.positionNonce, PERP);
    expect((accounts.position as PublicKey).equals(expected)).toBe(true);
    expect((accounts.owner as PublicKey).equals(owner)).toBe(true);
    expect((accounts.tradingKey as PublicKey).equals(tradingKey)).toBe(true);
    // and it must NOT be the delegate-seeded PDA
    const [delegateSeeded] = positionPDA(signer, marketId, ARGS.positionNonce, PERP);
    expect((accounts.position as PublicKey).equals(delegateSeeded)).toBe(false);
  });

  it("defaults owner to signer + tradingKey to null for a non-delegated open", async () => {
    const { client, seen } = stubClient();
    await openPosition(
      { ...opts, perpClient: client },
      { signer, signerUsdc },
      ARGS,
    );
    const accounts = seen();
    const [expected] = positionPDA(signer, marketId, ARGS.positionNonce, PERP);
    expect((accounts.position as PublicKey).equals(expected)).toBe(true);
    expect((accounts.owner as PublicKey).equals(signer)).toBe(true);
    expect(accounts.tradingKey).toBeNull();
  });
});
