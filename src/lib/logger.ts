import { redactPhone } from "./phone";

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): number {
  const configured = (process.env.LOG_LEVEL as Level | undefined) ?? "info";
  return LEVEL_ORDER[configured] ?? LEVEL_ORDER.info;
}

/** Keys whose values must never reach the log, at any level. */
const SECRET_KEYS = /^(auth_?token|token|password|secret|api_?key|service_?role|signature)$/i;
/** Keys holding phone numbers. Always redacted, at every level. */
const PHONE_KEYS = /(phone|from|to|caller|number)$/i;

function scrub(value: unknown, key?: string): unknown {
  if (key && SECRET_KEYS.test(key)) return "[redacted]";
  if (typeof value === "string") {
    if (key && PHONE_KEYS.test(key) && value.startsWith("+")) return redactPhone(value);
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => scrub(v));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrub(v, k);
    }
    return out;
  }
  return value;
}

function emit(level: Level, message: string, context?: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < minLevel()) return;
  const line = {
    level,
    ts: new Date().toISOString(),
    msg: message,
    ...((scrub(context ?? {}) as Record<string, unknown>) ?? {}),
  };
  const serialized = JSON.stringify(line);
  if (level === "error") console.error(serialized);
  else if (level === "warn") console.warn(serialized);
  else console.log(serialized);
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit("debug", msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit("error", msg, ctx),
};
