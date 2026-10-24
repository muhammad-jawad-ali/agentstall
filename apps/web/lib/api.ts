// Types mirror apps/api responses. Kept hand-written and small: only the fields the UI reads.

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

export interface FunnelSide {
  sessions: number;
  stages: { searched: number; questioned: number; checkout_created: number; captured: number };
  leftAfterUnansweredQuestion: number;
}

export interface Health {
  ok: boolean;
  paypal: "sandbox" | "mock";
  ai: "gemini" | "off";
}

export interface AgentStep {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface BatchResult {
  count: number;
  outcomes: Record<string, number>;
  conversion: number;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = (body as { error?: unknown }).error;
    throw new Error(typeof error === "string" ? error : `Request failed (${res.status})`);
  }
  return body as T;
}

export const postJson = <T>(path: string, body: unknown, method = "POST") =>
  api<T>(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const isSimulated = (agent: string) => agent.startsWith("sim-persona-");
