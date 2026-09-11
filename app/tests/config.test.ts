import { describe, expect, it } from "vitest";

const savedUrl = process.env.DATABASE_URL;

describe("config", () => {
  it("throws containing DATABASE_URL when unset", async () => {
    delete process.env.DATABASE_URL;
    delete globalThis.__cubicConfig;
    const { config } = await import("../src/server/config");
    expect(() => config()).toThrow(/DATABASE_URL/);
  });
});

describe("config after restore", () => {
  it("parses with DATABASE_URL set", async () => {
    process.env.DATABASE_URL = savedUrl;
    delete globalThis.__cubicConfig;
    const { config } = await import("../src/server/config");
    expect(config().DATABASE_URL).toBe(savedUrl);
    expect(config().LEDGER_PROVIDER).toBe("dev");
    expect(config().HEDERA_NETWORK).toBe("testnet");
    expect(config().X402_SCANNER_PRICE_CENTS).toBe(25);
  });
});
