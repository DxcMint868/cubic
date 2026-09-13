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

// plan-13 EXACT — THE one secret-key pattern, shared by logging.ts and
// gateway/ingest.ts. Matches camelCase holders too (operatorKey, apiKey,
// privateKey) via the [_-]? alternates.
export const SECRET_KEY_RE = /token|secret|password|credential|private[_-]?key|api[_-]?key|operator[_-]?key/i;

// plan-13: raw error text is only ever logged, never surfaced — so string
// meta values are scrubbed of secret-ish `key: value` / `key=value` pairs
// before printing. The alternation is wrapped in a group (and extended to the
// full surrounding key token) so the `[:=] value` suffix binds to the whole
// key, not just the last alternative; benign words like "secretary" without
// a separator never match. Built from SECRET_KEY_RE, the single source of truth.
const SECRET_PAIR_RE = new RegExp(
  `([A-Za-z0-9_-]*(?:${SECRET_KEY_RE.source})[A-Za-z0-9_-]*)\\s*[:=]\\s*[^\\s,;"}]+`,
  "gi",
);

export function redactText(text: string): string {
  return text.replace(SECRET_PAIR_RE, (_match, key: string) => `${key}=[REDACTED]`);
}

export function redactMeta(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactMeta);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) ? "[REDACTED]" : redactMeta(v);
    }
    return out;
  }
  if (typeof value === "string") return redactText(value);
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
