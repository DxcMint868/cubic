import "./load-env";
import { z } from "zod";

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
  }
  return globalThis.__cubicConfig;
}
