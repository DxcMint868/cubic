// MUST be the first import in every non-Next entrypoint (config.ts, drizzle.config.ts,
// vitest setup, tsx scripts). Next.js loads app/.env.local itself; nothing else does.
import { config as loadEnvFile } from "dotenv";
import { resolve } from "node:path";

loadEnvFile({ path: resolve(process.cwd(), ".env.local") });
