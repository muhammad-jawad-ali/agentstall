import { describe, expect, it } from "vitest";
import { MockGateway } from "@agentstall/paypal";
import type { ZodType } from "zod";
import type { ChatTurn, Llm, Part, ToolCall } from "../src/ai/llm.js";
import { StallKeeper } from "../src/ai/stallkeeper.js";
import { createApp } from "../src/app.js";
import { Commerce } from "../src/commerce.js";
import { seedDemoStore } from "../src/store.js";

/** Scripted LLM: JSON replies come from `json`, tool-use steps from `steps` in order. */
class FakeLlm implements Llm {
  calls = 0;
  constructor(
    private readonly json: (prompt: string) => unknown,
    private readonly steps: (ToolCall[] | string)[] = [],
  ) {}
  async generateJson<T>({ parts, schema }: { parts: Part[]; schema: ZodType<T> }) {
    this.calls++;
    return schema.parse(this.json(parts.map((p) => ("text" in p ? p.text : "")).join("\n")));
  }
  async step(_: { history: ChatTurn[] }) {
    const next = this.steps.shift() ?? "done";
    return typeof next === "string"
      ? { text: next, toolCalls: [], modelTurn: { role: "model" as const, parts: [{ text: next }] } }
      : { toolCalls: next, modelTurn: { role: "model" as const, parts: [] } };
  }
}

function setup(llm: Llm) {
  const commerce = new Commerce(seedDemoStore(), new MockGateway({ publicUrl: "http://t", eventDelayMs: 0 }), {
    publicUrl: "http://t",
    answerer: new StallKeeper(llm),
  });
  return { commerce, app: createApp(commerce, { llm }) };
}

const post = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("listing extractor", () => {
  it("turns a caption into a draft, and publishing creates a PayPal catalog product", async () => {
    const llm = new FakeLlm(() => ({
      title: "Lotus Batik Scarf",
      description: "Hand-dyed batik scarf with pink lotus flowers.",
      price_usd: null,
      price_in_caption: "RM120",
      materials: ["cotton"],
      colors: ["pink"],
      dimensions: null,
      tags: ["Scarf", "scarf", "lotus"],
      caption_language: "Malay",
      needs_review: ["price: caption price is in MYR"],
    }));
    const { app } = setup(llm);
    const form = new FormData();
    form.set("caption", "Selendang batik bunga teratai, RM120, kain kapas");
    const res = await app.request("/api/listings/extract", { method: "POST", body: form });
    const { product } = await res.json();
    expect(product).toMatchObject({ status: "draft", price: "", tags: ["scarf", "lotus"] });

    expect((await app.request(`/api/products/${product.id}/publish`, { method: "POST" })).status).toBe(400);
    await app.request(`/api/products/${product.id}`, { ...post({ price: "28.00" }), method: "PATCH" });
    const published = await (await app.request(`/api/products/${product.id}/publish`, { method: "POST" })).json();
    expect(published).toMatchObject({ status: "published" });
    expect(published.paypalProductId).toMatch(/^PROD-/);
  });
});

describe("stall-keeper", () => {
  it("downgrades answers that cite no real fact to unknown", async () => {
    const store = seedDemoStore();
    const keeper = new StallKeeper(new FakeLlm(() => ({ status: "answered", answer: "No duties!", source_ids: ["fact:made-up"] })));
    expect(await keeper.answer("Any customs duties?", store)).toBeNull();
  });

  it("returns grounded answers and caches repeat questions", async () => {
    const store = seedDemoStore();
    const llm = new FakeLlm(() => ({ status: "answered", answer: "6–9 business days.", source_ids: ["policy:shipping"] }));
    const keeper = new StallKeeper(llm);
    expect(await keeper.answer("How long to the US?", store)).toEqual({ answer: "6–9 business days.", source: "policy:shipping" });
    await keeper.answer("how long to the US", store);
    expect(llm.calls).toBe(1);
  });
});

describe("agents", () => {
  it("simulated personas convert better after the seller answers the customs question", async () => {
    // The fake stall-keeper knows customs only once a fact mentions duties.
    const llm = new FakeLlm((prompt) =>
      /duty-free/i.test(prompt) ? { status: "answered", answer: "Duty-free under $800.", source_ids: [prompt.match(/\[(fact:f_[^\]]+)\][^\n]*\n?A: Duty/)?.[1] ?? "policy:shipping"] } : { status: "unknown", answer: null, source_ids: [] },
    );
    const { app } = setup(llm);
    const before = await (await app.request("/api/simulate", post({ count: 20 }))).json();
    expect(before.outcomes.abandoned_unanswered).toBe(10);

    const [question] = await (await app.request("/api/questions")).json();
    await app.request(`/api/questions/${question.id}/answer`, post({ answer: "Duty-free under $800 to the US." }));

    const after = await (await app.request("/api/simulate", post({ count: 20 }))).json();
    expect(after.outcomes.abandoned_unanswered).toBe(0);
    expect(after.conversion).toBeGreaterThan(before.conversion);

    const funnel = await (await app.request("/api/funnel")).json();
    expect(funnel.simulated.sessions).toBe(40);
  });

  it("Buyer Agent Console shops through MCP and pays", async () => {
    const llm = new FakeLlm(() => ({}), [
      [{ name: "search_products", args: { query: "silk scarf" } }],
      [{ name: "create_checkout", args: { product_id: "p_hibiscus", payment_method: "sandbox_test_card" } }],
      "Bought the Hibiscus Silk Batik Scarf for $58.",
    ]);
    const { app, commerce } = setup(llm);
    const res = await (await app.request("/api/console/run", post({ goal: "Buy a silk scarf", payment_method: "sandbox_test_card" }))).json();
    expect(res.steps.map((s: { tool: string }) => s.tool)).toEqual(["search_products", "create_checkout"]);
    expect(commerce.store.orders.get(res.orderId)?.agent).toBe("agentstall-buyer-console");
  });
});
