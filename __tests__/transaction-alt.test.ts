/**
 * transaction-alt.test.ts — PERF-3 (the single biggest tx-size lever).
 *
 * `buildVersionedTransaction(instructions, payer, blockhash, lookupTables?)` has a
 * `lookupTables?` param that historically had ZERO runtime callers (the keeper
 * liquidate passed no tables, the web trade builders used a legacy `Transaction`,
 * mobile built a 0-table v0). This net pins the SDK's ALT compile path so the
 * web + mobile adopters (Task 3.3) can rely on it:
 *
 *  1. compiling WITH a venue + per-market ALT that covers the static keys produces
 *     a v0 message with `addressLookupTableAccounts` (the keys are collapsed to
 *     1-B indices), where compiling WITHOUT carries them all inline;
 *  2. HC3 — the ALT changes key ENCODING only: the ALT-resolved key set
 *     (staticAccountKeys ∪ the keys the LUT references) equals the no-ALT key set;
 *  3. a realistic many-static-key tx (mirrors a category open/close surface)
 *     serializes WELL under the 1232-B packet cap WITH the ALT (the audit's
 *     ~400–500 B target), and FALLBACK (no ALT) still compiles + serializes.
 *
 * The synthetic ALT is built locally (no RPC) from the same key set the web/mobile
 * loaders fetch via `getAddressLookupTable`, so the test exercises the production
 * `compileToV0Message([...alts])` resolution path.
 */
import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { buildVersionedTransaction } from "../src/utils/transaction";

const BLOCKHASH = "11111111111111111111111111111111";

/** A synthetic, RPC-free ALT — exactly the shape `getAddressLookupTable` returns. */
function syntheticAlt(addresses: PublicKey[]): AddressLookupTableAccount {
  return new AddressLookupTableAccount({
    key: Keypair.generate().publicKey,
    state: {
      addresses,
      deactivationSlot: BigInt("18446744073709551615"), // never-deactivated sentinel
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      authority: PublicKey.default,
    },
  });
}

/**
 * Build a single ix that references `payer` (signer) + every static key in
 * `staticKeys` as a non-signer read-only key + `n` dynamic (owner/nonce-derived)
 * keys that can NOT be pre-warmed (positions/queue entries). Mirrors the account
 * surface shape of a category open/close (many static + a few dynamic).
 */
function ixWithKeys(
  payer: PublicKey,
  staticKeys: PublicKey[],
  dynamicKeys: PublicKey[],
  programId: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      ...staticKeys.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })),
      ...dynamicKeys.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
    ],
    data: Buffer.alloc(64), // ~ ix args payload
  });
}

const PAYER = Keypair.generate().publicKey;
const PROGRAM = Keypair.generate().publicKey;

// ~26 static keys — the venue + per-market surface a category open/close threads.
const STATIC_KEYS = Array.from({ length: 26 }, () => Keypair.generate().publicKey);
// 4 dynamic keys — position, queue entries, claims, ATA (NOT ALT-able).
const DYNAMIC_KEYS = Array.from({ length: 4 }, () => Keypair.generate().publicKey);

const VENUE_ALT = syntheticAlt(STATIC_KEYS.slice(0, 13));
const MARKET_ALT = syntheticAlt(STATIC_KEYS.slice(13));
const ALTS = [VENUE_ALT, MARKET_ALT];

/** The full key set a tx references, ALT-resolved: static inline keys (incl. the
 *  program id implicitly) ∪ the keys each referenced LUT carries for this msg. */
function resolvedKeySet(tx: VersionedTransaction): Set<string> {
  const msg = tx.message;
  const out = new Set<string>(msg.staticAccountKeys.map((k) => k.toBase58()));
  const lookups = msg.addressTableLookups ?? [];
  for (const lk of lookups) {
    // Find the table this lookup references; map its writable/readonly indexes.
    const table = ALTS.find((a) => a.key.equals(lk.accountKey));
    if (!table) continue;
    for (const i of lk.writableIndexes) out.add(table.state.addresses[i]!.toBase58());
    for (const i of lk.readonlyIndexes) out.add(table.state.addresses[i]!.toBase58());
  }
  return out;
}

describe("PERF-3: buildVersionedTransaction threads lookupTables into the v0 compile", () => {
  const ix = ixWithKeys(PAYER, STATIC_KEYS, DYNAMIC_KEYS, PROGRAM);

  test("WITHOUT an ALT, all static keys are inline (no addressTableLookups)", () => {
    const tx = buildVersionedTransaction([ix], PAYER, BLOCKHASH);
    expect(tx.message.addressTableLookups ?? []).toHaveLength(0);
    // every static key + the dynamic keys are in staticAccountKeys.
    const inline = new Set(tx.message.staticAccountKeys.map((k) => k.toBase58()));
    for (const k of STATIC_KEYS) expect(inline.has(k.toBase58())).toBe(true);
  });

  test("WITH the ALT, static keys collapse to LUT lookups", () => {
    const tx = buildVersionedTransaction([ix], PAYER, BLOCKHASH, ALTS);
    const lookups = tx.message.addressTableLookups ?? [];
    expect(lookups.length).toBeGreaterThan(0);
    // The 26 static keys are no longer all inline — most live in the LUTs now.
    const inline = new Set(tx.message.staticAccountKeys.map((k) => k.toBase58()));
    const inlineStatic = STATIC_KEYS.filter((k) => inline.has(k.toBase58()));
    expect(inlineStatic.length).toBeLessThan(STATIC_KEYS.length);
  });

  test("HC3: ALT-resolved key set == the no-ALT key set (encoding only)", () => {
    const noAlt = buildVersionedTransaction([ix], PAYER, BLOCKHASH);
    const withAlt = buildVersionedTransaction([ix], PAYER, BLOCKHASH, ALTS);
    const noAltKeys = new Set(noAlt.message.staticAccountKeys.map((k) => k.toBase58()));
    const withAltKeys = resolvedKeySet(withAlt);
    expect(withAltKeys).toEqual(noAltKeys);
  });

  test("WITH the ALT serializes well under 1232 B (the ~400–500 B target)", () => {
    const tx = buildVersionedTransaction([ix], PAYER, BLOCKHASH, ALTS);
    const bytes = tx.serialize().length;
    expect(bytes).toBeLessThan(700);
  });

  test("WITHOUT the ALT the same tx is much larger (the ALT buys the headroom)", () => {
    const withAlt = buildVersionedTransaction([ix], PAYER, BLOCKHASH, ALTS).serialize().length;
    const noAlt = buildVersionedTransaction([ix], PAYER, BLOCKHASH).serialize().length;
    expect(noAlt).toBeGreaterThan(withAlt + 400); // ~25 keys × ~31 B saved each
  });

  test("FALLBACK: an empty ALT list still compiles + serializes (no ALT yet)", () => {
    const tx = buildVersionedTransaction([ix], PAYER, BLOCKHASH, []);
    expect(tx.message.addressTableLookups ?? []).toHaveLength(0);
    expect(tx.serialize().length).toBeGreaterThan(0);
  });
});
