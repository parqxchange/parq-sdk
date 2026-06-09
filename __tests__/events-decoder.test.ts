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
