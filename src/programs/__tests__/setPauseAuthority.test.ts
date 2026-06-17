// Jest globals: describe/test/expect available via ts-jest preset.
// #127: PerpClient.setPauseAuthorityIx — least-privilege keeper pause signer.
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PerpClient } from "../perp";
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
  const conn = new Connection("http://127.0.0.1:8899", "confirmed");
  const provider = new AnchorProvider(conn, new Wallet(Keypair.generate()), {
    commitment: "confirmed",
  });
  const idl = loadPerpIdl() as Record<string, unknown>;
  const program = new Program({ ...idl, address: PERP_ID.toBase58() } as never, provider);
  return new PerpClient(program);
}

describe("PerpClient.setPauseAuthorityIx", () => {
  const admin = Keypair.generate().publicKey;
  const [protocolConfig] = protocolConfigPDA(PERP_ID);

  test.each<[string, PublicKey]>([
    ["a keeper signer", Keypair.generate().publicKey],
    ["the default (disable / kill-switch)", PublicKey.default],
  ])("newAuthority=%s → set_pause_authority disc + 32-byte pubkey + accounts", async (_label, newAuthority) => {
    const client = makeClient();
    const ix = await client.setPauseAuthorityIx(admin, newAuthority);

    expect(ix.programId.toBase58()).toBe(PERP_ID.toBase58());
    // data = 8-byte discriminator + 32-byte pubkey arg.
    expect(ix.data.subarray(0, 8).equals(disc("set_pause_authority"))).toBe(true);
    expect(ix.data.subarray(8, 40).equals(newAuthority.toBuffer())).toBe(true);
    expect(ix.data.length).toBe(40);

    // admin must be a signer.
    const adminMeta = ix.keys.find((k) => k.pubkey.equals(admin));
    expect(adminMeta?.isSigner).toBe(true);

    // protocol_config auto-resolved from its const seed, writable, non-signer.
    const pcMeta = ix.keys.find((k) => k.pubkey.equals(protocolConfig));
    expect(pcMeta).toBeDefined();
    expect(pcMeta?.isWritable).toBe(true);
    expect(pcMeta?.isSigner).toBe(false);
  });
});
