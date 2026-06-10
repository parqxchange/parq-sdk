import { createHash } from "node:crypto";
import { decodeAnchorEvent } from "../src/events/decoder";

function eventDisc(name: string): Buffer {
  return createHash("sha256").update(`event:${name}`).digest().subarray(0, 8) as Buffer;
}

describe("decodeRewardIndexUpdated", () => {
  it("decodes u128 reward_index @8 and u64 new_rewards @24 (32-byte payload)", () => {
    const buf = Buffer.alloc(32);
    eventDisc("RewardIndexUpdated").copy(buf, 0);
    buf.writeBigUInt64LE(0x1122334455667788n, 8);
    buf.writeBigUInt64LE(0x0102030405060708n, 16);
    buf.writeBigUInt64LE(999n, 24);
    const b64 = buf.toString("base64");
    const ev = decodeAnchorEvent(b64);
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe("rewardIndexUpdated");
    if (ev!.type === "rewardIndexUpdated") {
      const low = 0x1122334455667788n;
      const high = 0x0102030405060708n;
      expect(ev.data.rewardIndex).toBe(low + (high << 64n));
      expect(ev.data.newRewards).toBe(999n);
    }
  });

  it("returns null for truncated payload with valid discriminator", () => {
    const buf = Buffer.alloc(16);
    eventDisc("RewardIndexUpdated").copy(buf, 0);
    const b64 = buf.toString("base64");
    expect(decodeAnchorEvent(b64)).toBeNull();
  });
});

describe("decodePositionClosed (#183 net-PnL fields)", () => {
  function baseClosedBuf(len: number): Buffer {
    const buf = Buffer.alloc(len);
    eventDisc("PositionClosed").copy(buf, 0);
    Buffer.alloc(32, 1).copy(buf, 8);          // owner
    Buffer.alloc(32, 2).copy(buf, 40);         // market_id
    buf.writeBigInt64LE(10_000_000n, 72);      // pnl = +10 USDC (gross)
    buf.writeBigUInt64LE(29_500_000n, 80);     // net_return
    buf.writeBigUInt64LE(110_000_000_000n, 88); // exit_price
    return buf;
  }

  it("decodes a full 121-byte PositionClosed with fundingCharge/collateral/sizeUsdc/closedBy", () => {
    const buf = baseClosedBuf(121);
    buf.writeBigInt64LE(-250_000n, 96);        // funding_charge (trader received)
    buf.writeBigUInt64LE(20_000_000n, 104);    // collateral
    buf.writeBigUInt64LE(100_000_000n, 112);   // size_usdc
    buf.writeUInt8(1, 120);                    // closed_by = keeper execute_decrease

    const ev = decodeAnchorEvent(buf.toString("base64"));
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe("positionClosed");
    if (ev!.type === "positionClosed") {
      expect(ev.data.pnl).toBe(10_000_000n);
      expect(ev.data.netReturn).toBe(29_500_000n);
      expect(ev.data.fundingCharge).toBe(-250_000n);
      expect(ev.data.collateral).toBe(20_000_000n);
      expect(ev.data.sizeUsdc).toBe(100_000_000n);
      expect(ev.data.closedBy).toBe(1);
    }
  });

  it("decodes a legacy 96-byte PositionClosed — appended fields undefined", () => {
    const ev = decodeAnchorEvent(baseClosedBuf(96).toString("base64"));
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe("positionClosed");
    if (ev!.type === "positionClosed") {
      expect(ev.data.pnl).toBe(10_000_000n);
      expect(ev.data.fundingCharge).toBeUndefined();
      expect(ev.data.collateral).toBeUndefined();
      expect(ev.data.sizeUsdc).toBeUndefined();
      expect(ev.data.closedBy).toBeUndefined();
    }
  });

  it("decodes a 104-byte (#172-era) PositionClosed — funding present, #183 fields undefined", () => {
    const buf = baseClosedBuf(104);
    buf.writeBigInt64LE(1_250_000n, 96);
    const ev = decodeAnchorEvent(buf.toString("base64"));
    expect(ev).not.toBeNull();
    if (ev!.type === "positionClosed") {
      expect(ev.data.fundingCharge).toBe(1_250_000n);
      expect(ev.data.collateral).toBeUndefined();
      expect(ev.data.sizeUsdc).toBeUndefined();
      expect(ev.data.closedBy).toBeUndefined();
    }
  });
});
