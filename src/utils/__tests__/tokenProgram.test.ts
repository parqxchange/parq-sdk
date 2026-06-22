// Jest globals: describe/test/expect/jest available via ts-jest preset.
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { probeTokenProgram } from "../tokenProgram";

function mockConn(owner: PublicKey | null): Connection {
  const conn = new Connection("http://127.0.0.1:8899", "confirmed");
  if (owner === null) {
    jest.spyOn(conn, "getAccountInfo").mockResolvedValue(null);
  } else {
    jest.spyOn(conn, "getAccountInfo").mockResolvedValue({
      data: Buffer.alloc(82),
      executable: false,
      lamports: 1,
      owner,
      rentEpoch: 0,
    } as never);
  }
  return conn;
}

describe("probeTokenProgram", () => {
  const mint = PublicKey.unique();

  test("returns TOKEN_2022_PROGRAM_ID when mint is owned by the 2022 program", async () => {
    const conn = mockConn(TOKEN_2022_PROGRAM_ID);
    const program = await probeTokenProgram(conn, mint);
    expect(program.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
  });

  test("returns TOKEN_PROGRAM_ID when mint is owned by the legacy program", async () => {
    const conn = mockConn(TOKEN_PROGRAM_ID);
    const program = await probeTokenProgram(conn, mint);
    expect(program.equals(TOKEN_PROGRAM_ID)).toBe(true);
  });

  test("throws when the mint account does not exist", async () => {
    const conn = mockConn(null);
    await expect(probeTokenProgram(conn, mint)).rejects.toThrow();
  });

  test("throws when the mint is owned by a non-token program", async () => {
    const conn = mockConn(PublicKey.unique());
    await expect(probeTokenProgram(conn, mint)).rejects.toThrow();
  });
});
