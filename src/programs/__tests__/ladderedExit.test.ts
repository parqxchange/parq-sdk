// Jest globals: describe/test/expect available via ts-jest preset.
import { Connection, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PerpClient } from "../perp";
import {
  type ExitRung,
  resolveExitMinOutput,
  MARK_TP_SLIPPAGE_BPS,
  MARK_SL_SLIPPAGE_BPS,
  MAX_EXIT_RUNGS,
} from "../perp";
import { orderPDA } from "../../utils/pda";

const PERP_ID = new PublicKey("6QrsMTMEu9rsLpyxQgRdvQsWoPgHGY9npNNiwTtXsbdc");

function loadPerpIdl(): unknown {
  const candidates = [
    join(__dirname, "../../../idl/perp_engine.json"),
    join(__dirname, "../../../../target/idl/perp_engine.json"),
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

// create_order ix data layout after the 8-byte discriminator:
//   order_type(1) side(1) size_usdc(8) collateral_usdc(8) trigger_price(8)
//   acceptable_price(8) min_output_usdc(8) referral_code(32) position_nonce(8)
const OFF_ORDER_TYPE = 8;
const OFF_SIDE = 9;
const OFF_SIZE = 10;
const OFF_COLLATERAL = 18;
const OFF_TRIGGER = 26;
const OFF_ACCEPTABLE = 34;
const OFF_MIN_OUTPUT = 42;
const OFF_REFERRAL = 50;
const OFF_POSITION_NONCE = 82;

function u64(data: Buffer, off: number): bigint {
  return data.readBigUInt64LE(off);
}

interface Decoded {
  orderType: number;
  side: number;
  sizeUsdc: bigint;
  collateralUsdc: bigint;
  triggerPrice: bigint;
  acceptablePrice: bigint;
  minOutputUsdc: bigint;
  positionNonce: bigint;
  referralCode: number[];
}

function decode(ix: TransactionInstruction): Decoded {
  const data = ix.data as Buffer;
  expect(data.subarray(0, 8).equals(disc("create_order"))).toBe(true);
  return {
    orderType: data[OFF_ORDER_TYPE],
    side: data[OFF_SIDE],
    sizeUsdc: u64(data, OFF_SIZE),
    collateralUsdc: u64(data, OFF_COLLATERAL),
    triggerPrice: u64(data, OFF_TRIGGER),
    acceptablePrice: u64(data, OFF_ACCEPTABLE),
    minOutputUsdc: u64(data, OFF_MIN_OUTPUT),
    positionNonce: u64(data, OFF_POSITION_NONCE),
    referralCode: Array.from(data.subarray(OFF_REFERRAL, OFF_REFERRAL + 32)),
  };
}

// OrderType enum index: MarketIncrease=0 LimitIncrease=1 StopIncrease=2
//   MarketDecrease=3 LimitDecrease=4 StopLossDecrease=5
const ORDER_LIMIT_DECREASE = 4;
const ORDER_STOP_LOSS_DECREASE = 5;
// Side enum: Long=0 Short=1
const SIDE_LONG = 0;
const SIDE_SHORT = 1;

const owner = Keypair.generate().publicKey;
const marketId = new Uint8Array(32).fill(7);
const orderNonce = Keypair.generate().publicKey;
const ownerUsdc = Keypair.generate().publicKey;
const vaultUsdc = Keypair.generate().publicKey;
const poolProgram = Keypair.generate().publicKey;
const engineAuth = Keypair.generate().publicKey;
const marketState = Keypair.generate().publicKey;
const poolState = Keypair.generate().publicKey;

function baseCommon() {
  return {
    marketState,
    poolState,
    orderNonce,
    owner,
    ownerUsdc,
    vaultUsdc,
    poolProgram,
    engineAuth,
    marketId,
  };
}

describe("PerpClient.buildLadderedExitIxs", () => {
  test("N rungs → N ixs with monotonic nonces (startNonce + i)", async () => {
    const client = makeClient();
    const startNonce = 17n;
    const rungs: ExitRung[] = [
      { triggerPrice: 100n * 10n ** 9n, sizeUsdc: 30_000_000n },
      { triggerPrice: 110n * 10n ** 9n, sizeUsdc: 40_000_000n },
      { triggerPrice: 120n * 10n ** 9n, sizeUsdc: 30_000_000n },
    ];
    const ixs = await client.buildLadderedExitIxs(baseCommon(), {
      positionSide: { long: {} },
      orderType: { limitDecrease: {} },
      positionSize: 100_000_000n,
      positionNonce: 5n,
      startNonce,
      rungs,
      referralCode: Array(32).fill(0),
    });

    expect(ixs).toHaveLength(3);
    ixs.forEach((ix, i) => {
      const d = decode(ix);
      expect(d.orderType).toBe(ORDER_LIMIT_DECREASE);
      expect(d.side).toBe(SIDE_LONG);
      expect(d.sizeUsdc).toBe(rungs[i].sizeUsdc);
      expect(d.triggerPrice).toBe(rungs[i].triggerPrice);
      expect(d.positionNonce).toBe(5n);
      // collateral 0n per rung (reduce-only)
      expect(d.collateralUsdc).toBe(0n);
      // order PDA derived from startNonce + i
      const [expectedOrder] = orderPDA(owner, marketId, startNonce + BigInt(i), PERP_ID);
      const orderMeta = ix.keys.find((k) => k.pubkey.equals(expectedOrder));
      expect(orderMeta).toBeDefined();
    });
  });

  test("collateralUsdc === 0n on every rung (reduce-only)", async () => {
    const client = makeClient();
    const ixs = await client.buildLadderedExitIxs(baseCommon(), {
      positionSide: { short: {} },
      orderType: { stopLossDecrease: {} },
      positionSize: 50_000_000n,
      positionNonce: 9n,
      startNonce: 0n,
      rungs: [{ triggerPrice: 90n * 10n ** 9n, sizeUsdc: 50_000_000n }],
      referralCode: Array(32).fill(0),
    });
    expect(ixs).toHaveLength(1);
    const d = decode(ixs[0]);
    expect(d.collateralUsdc).toBe(0n);
    expect(d.orderType).toBe(ORDER_STOP_LOSS_DECREASE);
    expect(d.side).toBe(SIDE_SHORT);
  });

  test("position side carried verbatim — NOT flipped (long & short)", async () => {
    const client = makeClient();
    const longIxs = await client.buildLadderedExitIxs(baseCommon(), {
      positionSide: { long: {} },
      orderType: { stopLossDecrease: {} },
      positionSize: 10_000_000n,
      positionNonce: 1n,
      startNonce: 0n,
      rungs: [{ triggerPrice: 1n, sizeUsdc: 10_000_000n }],
      referralCode: Array(32).fill(0),
    });
    expect(decode(longIxs[0]).side).toBe(SIDE_LONG);

    const shortIxs = await client.buildLadderedExitIxs(baseCommon(), {
      positionSide: { short: {} },
      orderType: { limitDecrease: {} },
      positionSize: 10_000_000n,
      positionNonce: 1n,
      startNonce: 0n,
      rungs: [{ triggerPrice: 1n, sizeUsdc: 10_000_000n }],
      referralCode: Array(32).fill(0),
    });
    expect(decode(shortIxs[0]).side).toBe(SIDE_SHORT);
  });

  test("category arg threaded to EVERY rung (engine_auth in remaining_accounts)", async () => {
    const client = makeClient();
    const engine = Keypair.generate().publicKey;
    const ixs = await client.buildLadderedExitIxs(
      baseCommon(),
      {
        positionSide: { long: {} },
        orderType: { limitDecrease: {} },
        positionSize: 60_000_000n,
        positionNonce: 2n,
        startNonce: 3n,
        rungs: [
          { triggerPrice: 1n, sizeUsdc: 20_000_000n },
          { triggerPrice: 2n, sizeUsdc: 20_000_000n },
          { triggerPrice: 3n, sizeUsdc: 20_000_000n },
        ],
        referralCode: Array(32).fill(0),
      },
      { engineAuth: engine },
    );
    expect(ixs).toHaveLength(3);
    for (const ix of ixs) {
      const meta = ix.keys.find((k) => k.pubkey.equals(engine));
      expect(meta).toBeDefined();
      expect(meta?.isWritable).toBe(false);
      expect(meta?.isSigner).toBe(false);
    }
  });

  test("rejects rungs.length > MAX_EXIT_RUNGS", async () => {
    const client = makeClient();
    const rungs: ExitRung[] = Array.from({ length: MAX_EXIT_RUNGS + 1 }, (_v, i) => ({
      triggerPrice: BigInt(i + 1),
      sizeUsdc: 1_000_000n,
    }));
    await expect(
      client.buildLadderedExitIxs(baseCommon(), {
        positionSide: { long: {} },
        orderType: { limitDecrease: {} },
        positionSize: 1_000_000_000n,
        positionNonce: 1n,
        startNonce: 0n,
        rungs,
        referralCode: Array(32).fill(0),
      }),
    ).rejects.toThrow(/MAX_EXIT_RUNGS/);
  });

  test("rejects sum(sizeUsdc) > positionSize", async () => {
    const client = makeClient();
    await expect(
      client.buildLadderedExitIxs(baseCommon(), {
        positionSide: { long: {} },
        orderType: { limitDecrease: {} },
        positionSize: 100_000_000n,
        positionNonce: 1n,
        startNonce: 0n,
        rungs: [
          { triggerPrice: 1n, sizeUsdc: 60_000_000n },
          { triggerPrice: 2n, sizeUsdc: 50_000_000n },
        ],
        referralCode: Array(32).fill(0),
      }),
    ).rejects.toThrow(/exceeds positionSize/);
  });

  test("rejects empty rung list", async () => {
    const client = makeClient();
    await expect(
      client.buildLadderedExitIxs(baseCommon(), {
        positionSide: { long: {} },
        orderType: { limitDecrease: {} },
        positionSize: 100_000_000n,
        positionNonce: 1n,
        startNonce: 0n,
        rungs: [],
        referralCode: Array(32).fill(0),
      }),
    ).rejects.toThrow(/at least one rung/);
  });

  test("sum(sizeUsdc) == positionSize is allowed (boundary)", async () => {
    const client = makeClient();
    const ixs = await client.buildLadderedExitIxs(baseCommon(), {
      positionSide: { long: {} },
      orderType: { limitDecrease: {} },
      positionSize: 100_000_000n,
      positionNonce: 1n,
      startNonce: 0n,
      rungs: [
        { triggerPrice: 1n, sizeUsdc: 60_000_000n },
        { triggerPrice: 2n, sizeUsdc: 40_000_000n },
      ],
      referralCode: Array(32).fill(0),
    });
    expect(ixs).toHaveLength(2);
  });

  test("explicit per-rung minOutputUsdc wins (incl. 0n to disable)", async () => {
    const client = makeClient();
    const ixs = await client.buildLadderedExitIxs(baseCommon(), {
      positionSide: { long: {} },
      orderType: { limitDecrease: {} },
      positionSize: 100_000_000n,
      positionNonce: 1n,
      startNonce: 0n,
      rungs: [
        { triggerPrice: 1n, sizeUsdc: 50_000_000n, minOutputUsdc: 12_345_678n },
        { triggerPrice: 2n, sizeUsdc: 50_000_000n, minOutputUsdc: 0n, expectedNetPayoutUsdc: 9_999n },
      ],
      referralCode: Array(32).fill(0),
    });
    expect(decode(ixs[0]).minOutputUsdc).toBe(12_345_678n);
    // explicit 0n disables even though expectedNetPayout is supplied
    expect(decode(ixs[1]).minOutputUsdc).toBe(0n);
  });

  test("default-band floor derived from expectedNetPayout (tight TP / wide SL)", async () => {
    const client = makeClient();
    const expected = 1_000_000n;
    const tpIxs = await client.buildLadderedExitIxs(baseCommon(), {
      positionSide: { long: {} },
      orderType: { limitDecrease: {} },
      positionSize: 100_000_000n,
      positionNonce: 1n,
      startNonce: 0n,
      rungs: [{ triggerPrice: 1n, sizeUsdc: 50_000_000n, expectedNetPayoutUsdc: expected }],
      referralCode: Array(32).fill(0),
    });
    // TP floor = 1_000_000 * (10000 - 25) / 10000 = 997_500
    expect(decode(tpIxs[0]).minOutputUsdc).toBe(997_500n);

    const slIxs = await client.buildLadderedExitIxs(baseCommon(), {
      positionSide: { long: {} },
      orderType: { stopLossDecrease: {} },
      positionSize: 100_000_000n,
      positionNonce: 1n,
      startNonce: 0n,
      rungs: [{ triggerPrice: 1n, sizeUsdc: 50_000_000n, expectedNetPayoutUsdc: expected }],
      referralCode: Array(32).fill(0),
    });
    // SL floor = 1_000_000 * (10000 - 1000) / 10000 = 900_000
    expect(decode(slIxs[0]).minOutputUsdc).toBe(900_000n);
  });

  test("no band, no explicit floor → 0n (today's no-floor behavior)", async () => {
    const client = makeClient();
    const ixs = await client.buildLadderedExitIxs(baseCommon(), {
      positionSide: { long: {} },
      orderType: { limitDecrease: {} },
      positionSize: 100_000_000n,
      positionNonce: 1n,
      startNonce: 0n,
      rungs: [{ triggerPrice: 1n, sizeUsdc: 50_000_000n }],
      referralCode: Array(32).fill(0),
    });
    expect(decode(ixs[0]).minOutputUsdc).toBe(0n);
  });
});

describe("resolveExitMinOutput", () => {
  test("explicit floor wins over band", () => {
    expect(resolveExitMinOutput({ triggerPrice: 1n, sizeUsdc: 1n, minOutputUsdc: 42n, expectedNetPayoutUsdc: 1_000_000n }, true)).toBe(42n);
  });
  test("TP band 0.25%", () => {
    expect(resolveExitMinOutput({ triggerPrice: 1n, sizeUsdc: 1n, expectedNetPayoutUsdc: 1_000_000n }, true))
      .toBe((1_000_000n * (10000n - MARK_TP_SLIPPAGE_BPS)) / 10000n);
  });
  test("SL band 10%", () => {
    expect(resolveExitMinOutput({ triggerPrice: 1n, sizeUsdc: 1n, expectedNetPayoutUsdc: 1_000_000n }, false))
      .toBe((1_000_000n * (10000n - MARK_SL_SLIPPAGE_BPS)) / 10000n);
  });
  test("no inputs → 0n", () => {
    expect(resolveExitMinOutput({ triggerPrice: 1n, sizeUsdc: 1n }, true)).toBe(0n);
    expect(resolveExitMinOutput({ triggerPrice: 1n, sizeUsdc: 1n }, false)).toBe(0n);
  });
  test("zero/negative expectedNetPayout → 0n (no floor)", () => {
    expect(resolveExitMinOutput({ triggerPrice: 1n, sizeUsdc: 1n, expectedNetPayoutUsdc: 0n }, true)).toBe(0n);
  });
});
