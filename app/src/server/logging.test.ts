import { afterEach, describe, expect, it, vi } from "vitest";
import { logger, redactMeta } from "./logging";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("logging", () => {
  it("filters below LOG_LEVEL and writes levels to their console sink", () => {
    vi.stubEnv("LOG_LEVEL", "warn");
    vi.stubEnv("LOG_FORMAT", "text");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const l = logger("test");
    l.debug("d");
    l.info("i");
    l.warn("w", { a: 1 });
    l.error("e");
    expect(debug).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    expect(err).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/\[WARN\] \(test\) w \{"a":1\}/);
  });

  it("json format emits one parseable line with scope and level", () => {
    vi.stubEnv("LOG_LEVEL", "info");
    vi.stubEnv("LOG_FORMAT", "json");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logger("scope9").info("hello", { n: 2 });
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({
      level: "INFO",
      scope: "scope9",
      msg: "hello",
      n: 2,
    });
  });

  it("redacts secret-ish meta keys at any depth", () => {
    expect(
      redactMeta({ amount: 25, nested: { HEDERA_OPERATOR_KEY: "0xabc", ok: true }, list: [{ token: "t" }] }),
    ).toEqual({ amount: 25, nested: { HEDERA_OPERATOR_KEY: "[REDACTED]", ok: true }, list: [{ token: "[REDACTED]" }] });
  });
});
