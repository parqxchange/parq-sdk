import { Connection, PublicKey } from "@solana/web3.js";
import { detectProgramVersion, PROGRAM_IDS_V4 } from "../src/utils/version";

function mockConnection(dataLen: number | null): Connection {
  return {
    getAccountInfo: jest.fn(async () =>
      dataLen === null ? null : { data: Buffer.alloc(dataLen) },
    ),
  } as unknown as Connection;
}

describe("detectProgramVersion", () => {
  it('returns "v3_511" for 511-byte MarketState (live mainnet layout)', async () => {
    const c = mockConnection(511);
    await expect(
      detectProgramVersion(c, new PublicKey("11111111111111111111111111111112")),
    ).resolves.toBe("v3_511");
  });

  it('returns "v2_476" for 476-byte layout (not "unknown")', async () => {
    const c = mockConnection(476);
    await expect(
      detectProgramVersion(c, new PublicKey("11111111111111111111111111111112")),
    ).resolves.toBe("v2_476");
  });

  it('returns "v1_460" for 460-byte LEN_V1', async () => {
    const c = mockConnection(460);
    await expect(
      detectProgramVersion(c, new PublicKey("11111111111111111111111111111112")),
    ).resolves.toBe("v1_460");
  });

  it("returns unknown for missing account", async () => {
    const c = mockConnection(null);
    await expect(
      detectProgramVersion(c, new PublicKey("11111111111111111111111111111112")),
    ).resolves.toBe("unknown");
  });

  it('returns "v2_adl_surface" for 500-byte ADL-era buffer', async () => {
    const c = mockConnection(500);
    await expect(
      detectProgramVersion(c, new PublicKey("11111111111111111111111111111112")),
    ).resolves.toBe("v2_adl_surface");
  });
});

describe("PROGRAM_IDS_V4", () => {
  it("matches docs/reference/program-ids.md staking row", () => {
    expect(PROGRAM_IDS_V4.STAKING_PROGRAM).toBe(
      "35HddZHf84u6DeyLoZL3Z3a8pZ59594xu1aizj7VrAGR",
    );
  });
});
