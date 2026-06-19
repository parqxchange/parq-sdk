// Jest globals: describe/test/expect/jest available via ts-jest preset.
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PerpClient } from "../perp";
import { HaltMode } from "../../types";
import { protocolConfigPDA } from "../../utils/pda";

const PERP_ID = new PublicKey("6QrsMTMEu9rsLpyxQgRdvQsWoPgHGY9npNNiwTtXsbdc");

function loadPerpIdl(): unknown {
  const candidates = [
    join(__dirname, "../../../idl/perp_engine.json"), // bundled in sdk/idl/
    join(__dirname, "../../../../target/idl/perp_engine.json"), // anchor build output
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch {
      /* try next */
    }
  }
  throw new Error("perp_engine IDL not found — run `anchor build`.");
}

/** Anchor global instruction discriminator: sha256("global:<name>")[0..8]. */
function disc(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function makeClient(): PerpClient {
  // Const-seed PDA resolution + ix encoding are local — no RPC is issued, so a
  // dummy connection is fine.
  const conn = new Connection("http://127.0.0.1:8899", "confirmed");
  const provider = new AnchorProvider(conn, new Wallet(Keypair.generate()), {
    commitment: "confirmed",
  });
  const idl = loadPerpIdl() as Record<string, unknown>;
  const program = new Program({ ...idl, address: PERP_ID.toBase58() } as never, provider);
  return new PerpClient(program);
}

describe("PerpClient.setTradingHaltIx", () => {
  const admin = Keypair.generate().publicKey;
  const [protocolConfig] = protocolConfigPDA(PERP_ID);

  test.each<[string, HaltMode]>([
    ["None", HaltMode.None],
    ["ReduceOnly", HaltMode.ReduceOnly],
    ["Full", HaltMode.Full],
  ])("mode=%s → set_trading_halt disc + mode byte + accounts", async (_label, mode) => {
    const client = makeClient();
    const ix = await client.setTradingHaltIx(admin, mode);

    expect(ix.programId.toBase58()).toBe(PERP_ID.toBase58());
    // data = 8-byte discriminator + 1-byte u8 mode.
    expect(ix.data.subarray(0, 8).equals(disc("set_trading_halt"))).toBe(true);
    expect(ix.data[8]).toBe(mode);
    expect(ix.data.length).toBe(9);

    // admin must be a signer.
    const adminMeta = ix.keys.find((k) => k.pubkey.equals(admin));
    expect(adminMeta).toBeDefined();
    expect(adminMeta?.isSigner).toBe(true);

    // protocol_config auto-resolved from its const seed, writable, non-signer.
    const pcMeta = ix.keys.find((k) => k.pubkey.equals(protocolConfig));
    expect(pcMeta).toBeDefined();
    expect(pcMeta?.isWritable).toBe(true);
    expect(pcMeta?.isSigner).toBe(false);
  });
});

describe("PerpClient.getHaltMode", () => {
  function mockAccount(client: PerpClient, byte41: number | null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conn = (client as any).program.provider.connection as Connection;
    if (byte41 === null) {
      jest.spyOn(conn, "getAccountInfo").mockResolvedValue(null);
      return;
    }
    const data = Buffer.alloc(126);
    data[41] = byte41; // halt_mode offset
    jest.spyOn(conn, "getAccountInfo").mockResolvedValue({
      data,
      executable: false,
      lamports: 1,
      owner: PERP_ID,
      rentEpoch: 0,
    } as never);
  }

  test.each<[string, number, HaltMode]>([
    ["None", 0, HaltMode.None],
    ["ReduceOnly", 1, HaltMode.ReduceOnly],
    ["Full", 2, HaltMode.Full],
    ["unknown clamps to None", 7, HaltMode.None],
  ])("byte41=%s → %s", async (_label, byte41, expected) => {
    const client = makeClient();
    mockAccount(client, byte41);
    expect(await client.getHaltMode()).toBe(expected);
  });

  test("missing account → None", async () => {
    const client = makeClient();
    mockAccount(client, null);
    expect(await client.getHaltMode()).toBe(HaltMode.None);
  });
});
