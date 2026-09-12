// Minimal structured logging: levels + customizable format, zero new deps.
// `LOG_LEVEL=debug|info|warn|error` (default info), `LOG_FORMAT=text|json`
// (default text). Writes via console.* so existing console spies keep working.
// Meta values are redacted for secret-ish keys before printing — never log
// key material through here.
type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function level(): Level {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  console.warn(`[logging] unknown LOG_LEVEL "${process.env.LOG_LEVEL}", falling back to info`);
  return "info";
}

function jsonFormat(): boolean {
  return (process.env.LOG_FORMAT ?? "text").toLowerCase() === "json";
}

const SECRET_KEY = /token|secret|password|credential|private_key|api_key|operator_key/i;

export function redactMeta(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactMeta);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? "[REDACTED]" : redactMeta(v);
    }
    return out;
  }
  return value;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

// ponytail: one shared console sink, no transports/backends — add when logs
// need to leave stdout (shipper parses text/json already).
export function logger(scope: string): Logger {
  const emit = (lv: Level, message: string, meta?: Record<string, unknown>) => {
    if (ORDER[lv] < ORDER[level()]) return;
    const safe = meta ? redactMeta(meta) : undefined;
    if (jsonFormat()) {
      const line = JSON.stringify({ ts: new Date().toISOString(), level: lv.toUpperCase(), scope, msg: message, ...(safe as Record<string, unknown> | undefined) });
      if (lv === "error") console.error(line);
      else if (lv === "warn") console.warn(line);
      else console.log(line);
      return;
    }
    const line = `${new Date().toISOString()} [${lv.toUpperCase()}] (${scope}) ${message}${safe ? ` ${JSON.stringify(safe)}` : ""}`;
    if (lv === "debug") console.debug(line);
    else if (lv === "info") console.log(line);
    else if (lv === "warn") console.warn(line);
    else console.error(line);
  };
  return {
    debug: (m, meta) => emit("debug", m, meta),
    info: (m, meta) => emit("info", m, meta),
    warn: (m, meta) => emit("warn", m, meta),
    error: (m, meta) => emit("error", m, meta),
  };
}
