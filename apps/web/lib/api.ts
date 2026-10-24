// Types mirror apps/api responses. Kept small: only the fields the UI reads.

export interface Product {
  id: string;
  title: string;
  description: string;
  price: string;
  currency: string;
  stock: number;
  shipsTo: string[];
  shippingDays: number;
  tags: string[];
  imageUrl?: string;
  paypalProductId?: string;
  status: "draft" | "published";
  materials?: string[];
  colors?: string[];
  needsReview?: string[];
  sourceCaption?: string;
  sourcePermalink?: string;
}

export interface ListingDraft {
  price_in_caption: string | null;
  caption_language: string;
  needs_review: string[];
}

export interface Order {
  id: string;
  productId: string;
  quantity: number;
  amount: string;
  currency: string;
  agent: string;
  customId: string;
  status: "awaiting_approval" | "captured" | "failed";
  approveUrl?: string;
  captureId?: string;
  paypalEventId?: string;
  createdAt: string;
}

export interface AgentEvent {
  id: string;
  sessionId: string;
  agent: string;
  tool: string;
  outcome: string;
  productId?: string;
  detail?: string;
  at: string;
}

export interface Question {
  id: string;
  agent: string;
  productId?: string;
  text: string;
  createdAt: string;
}

export interface Fact {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
}

export interface FunnelSide {
  sessions: number;
  stages: { searched: number; questioned: number; checkout_created: number; captured: number };
  leftAfterUnansweredQuestion: number;
}

export interface Batch {
  id: string;
  at: string;
  count: number;
  purchased: number;
  abandonedUnanswered: number;
  factsKnown: number;
}

export interface Health {
  ok: boolean;
  paypal: "sandbox" | "mock";
  ai: "gemini" | "off";
}

export interface StallInfo {
  id: string;
  seller: { name: string; story: string; shippingPolicy: string; returnsPolicy: string };
  mcpPath: string;
  paypal: "sandbox" | "mock";
  counts: { products: number; drafts: number; orders: number };
}

export interface Trace {
  id: string;
  runId?: string;
  at: string;
  kind: "mcp" | "paypal" | "ai" | "webhook" | "app";
  label: string;
  input?: unknown;
  output?: unknown;
  status: "ok" | "error";
  ms: number;
}

export interface AgentStep {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface InstagramPost {
  id: string;
  caption?: string;
  media_type: string;
  media_url: string;
  permalink: string;
  timestamp: string;
  imported: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/** The run id of the last action, so "Behind the scenes" can show exactly what it did. */
let lastRunId: string | undefined;
const runListeners = new Set<(id: string) => void>();
export const getLastRunId = () => lastRunId;
export function onRun(fn: (id: string) => void) {
  runListeners.add(fn);
  return () => void runListeners.delete(fn);
}
function noteRun(res: Response) {
  const id = res.headers.get("x-run-id");
  if (id && res.url && !res.url.includes("/api/traces")) {
    lastRunId = id;
    runListeners.forEach((fn) => fn(id));
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }
  if (init?.method && init.method !== "GET") noteRun(res);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const b = body as { error?: unknown; retryAfter?: number };
    throw new ApiError(typeof b.error === "string" ? b.error : `Something went wrong (${res.status}).`, res.status, b.retryAfter);
  }
  return body as T;
}

export const postJson = <T>(path: string, body: unknown, method = "POST") =>
  api<T>(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const isSimulated = (agent: string) => agent.startsWith("sim-persona-");

/** Streams server-sent events from a POST (EventSource only supports GET). */
export async function postStream(
  path: string,
  body: unknown,
  onEvent: (event: string, data: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }
  noteRun(res);
  if (!res.ok || !res.body) {
    const b = (await res.json().catch(() => ({}))) as { error?: string; retryAfter?: number };
    throw new ApiError(b.error ?? `Something went wrong (${res.status}).`, res.status, b.retryAfter);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let split: number;
    while ((split = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const event = /^event: ?(.*)$/m.exec(chunk)?.[1] ?? "message";
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.replace(/^data: ?/, ""))
        .join("\n");
      if (data) onEvent(event, JSON.parse(data));
    }
  }
}

/** Rough conversion so the seller gets a suggested USD price; they always confirm it. */
const USD_PER: Record<string, number> = { RM: 0.22, MYR: 0.22, IDR: 0.000063, RP: 0.000063, PHP: 0.017, "₱": 0.017, PKR: 0.0036, RS: 0.0036, "£": 1.27, GBP: 1.27, "€": 1.08, EUR: 1.08, SGD: 0.74, S$: 0.74, $: 1, USD: 1 };
export function suggestUsd(priceText: string | null | undefined): string | undefined {
  if (!priceText) return undefined;
  const m = /(RM|MYR|IDR|Rp|PHP|₱|PKR|Rs\.?|£|GBP|€|EUR|SGD|S\$|\$|USD)\s*([\d.,]+)|([\d.,]+)\s*(RM|MYR|IDR|PHP|PKR|GBP|EUR|SGD|USD)/i.exec(priceText);
  if (!m) return undefined;
  const currency = (m[1] ?? m[4]).toUpperCase().replace(".", "").replace("RS", "RS");
  const amount = Number((m[2] ?? m[3]).replace(/,/g, ""));
  const rate = USD_PER[currency] ?? USD_PER[(m[1] ?? m[4])];
  if (!rate || !Number.isFinite(amount)) return undefined;
  return (Math.round(amount * rate * 100) / 100).toFixed(2);
}

/** Groups differently-worded questions about the same thing ("customs duties" vs "import tax"). */
export function groupQuestions(questions: Question[]): { text: string; questions: Question[]; wordings: number }[] {
  const STOP = new Set("a an the and or of to in on for with is are do does can i you my me it this that what how will be any have pay there".split(" "));
  const SYN: Record<string, string> = { duties: "customs", duty: "customs", tax: "customs", taxes: "customs", import: "customs", vat: "customs", fees: "customs", fee: "customs" };
  const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => SYN[w] ?? w));
  const groups: { key: Set<string>; text: string; questions: Question[]; texts: Set<string> }[] = [];
  for (const q of questions) {
    const w = words(q.text);
    const g = groups.find((g) => [...w].filter((x) => g.key.has(x)).length / Math.max(1, Math.min(w.size, g.key.size)) >= 0.5);
    if (g) {
      g.questions.push(q);
      g.texts.add(q.text);
    } else groups.push({ key: w, text: q.text, questions: [q], texts: new Set([q.text]) });
  }
  return groups.map((g) => ({ text: g.text, questions: g.questions, wordings: g.texts.size })).sort((a, b) => b.questions.length - a.questions.length);
}
