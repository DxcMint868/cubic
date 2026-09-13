import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __cubicDb: ReturnType<typeof makeDb> | undefined;
}

function makeDb() {
  const client = postgres(config().DATABASE_URL, { max: 5 });
  return drizzle(client, { schema });
}

export function db() {
  if (!globalThis.__cubicDb) globalThis.__cubicDb = makeDb();
  return globalThis.__cubicDb;
}
