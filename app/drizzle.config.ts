import "./src/server/load-env";
import { defineConfig } from "drizzle-kit";
import { config } from "./src/server/config";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: config().DATABASE_URL },
});
