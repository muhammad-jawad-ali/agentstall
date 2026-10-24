import { AsyncLocalStorage } from "node:async_hooks";

export type TraceKind = "mcp" | "paypal" | "ai" | "webhook" | "app";

/** One step of what really happened behind the scenes, shown in the UI's "Behind the scenes" panel. */
export interface TraceEntry {
  id: string;
  /** Groups the traces of one user action (one request, including the agent calls it triggers). */
  runId?: string;
  at: string;
  kind: TraceKind;
  label: string;
  input?: unknown;
  output?: unknown;
  status: "ok" | "error";
  ms: number;
}

const runContext = new AsyncLocalStorage<{ runId: string }>();

/** Runs `fn` with a run id, keeping an outer one if already set (agent calls made in-process inherit it). */
export function withRun<T>(runId: string, fn: () => T): T {
  const outer = runContext.getStore();
  return outer ? fn() : runContext.run({ runId }, fn);
}

export function currentRunId(): string | undefined {
  return runContext.getStore()?.runId;
}

/** Keeps trace payloads small enough to store and send: long strings and big arrays are cut. */
export function compact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    if (value.startsWith("data:")) return `${value.slice(0, 30)}… (${value.length} chars)`;
    return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => compact(v, depth + 1));
  if (value && typeof value === "object") {
    if (depth > 6) return "…";
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, compact(v, depth + 1)]));
  }
  return value;
}
