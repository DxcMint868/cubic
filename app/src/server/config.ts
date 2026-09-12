import "./load-env";
import { z } from "zod";
import { logger } from "./logging";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DEMO_TENANT_SLUG: z.string().default("demo"),
  LEDGER_PROVIDER: z.enum(["dev", "ledger"]).default("dev"),
  HEDERA_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  X402_SCANNER_PRICE_CENTS: z.coerce.number().int().default(25),
  X402_DEV_BYPASS: z.enum(["0", "1"]).default("0"),
  X402_SIMULATE_FAILURE: z.enum(["0", "1"]).default("0"),
  AGENT0_SUBGRAPH_URL: z.string().min(1).optional(),
  LLM_INTENT_PROVIDER: z.string().min(1).optional(),
  GITHUB_TOKEN: z.string().min(1).optional(),
  LEDGER_WALLET_CLI_PATH: z.string().min(1).optional(),
  HEDERA_OPERATOR_ID: z.string().min(1).optional(),
  HEDERA_OPERATOR_KEY: z.string().min(1).optional(),
});

export type Config = z.infer<typeof schema>;

declare global {
  // eslint-disable-next-line no-var
  var __cubicConfig: Config | undefined;
}

export function config(): Config {
  if (!globalThis.__cubicConfig) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(
        `Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
    }
    globalThis.__cubicConfig = parsed.data;
    // Effective config, once per process: presence-only for secrets, so a
    // misconfigured env shows up in logs instead of failing silently later.
    logger("config").info("effective config", {
      DEMO_TENANT_SLUG: parsed.data.DEMO_TENANT_SLUG,
      LEDGER_PROVIDER: parsed.data.LEDGER_PROVIDER,
      HEDERA_NETWORK: parsed.data.HEDERA_NETWORK,
      X402_SCANNER_PRICE_CENTS: parsed.data.X402_SCANNER_PRICE_CENTS,
      X402_DEV_BYPASS: parsed.data.X402_DEV_BYPASS,
      X402_SIMULATE_FAILURE: parsed.data.X402_SIMULATE_FAILURE,
      AGENT0_SUBGRAPH_URL: parsed.data.AGENT0_SUBGRAPH_URL ? "set" : "unset",
      GITHUB_TOKEN: parsed.data.GITHUB_TOKEN ? "set" : "unset",
      HEDERA_OPERATOR_ID: parsed.data.HEDERA_OPERATOR_ID ? "set" : "unset",
      HEDERA_OPERATOR_KEY: parsed.data.HEDERA_OPERATOR_KEY ? "set" : "unset",
      X402_PAY_TO_ACCOUNT: process.env.X402_PAY_TO_ACCOUNT ? "set" : "unset",
    });
  }
  return globalThis.__cubicConfig;
}
