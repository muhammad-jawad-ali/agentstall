import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { MockGateway, type PayPalGateway } from "@agentstall/paypal";
import { createApp } from "../src/app.js";
import { StallRegistry } from "../src/registry.js";

const PUBLIC_URL = "http://agentstall.test";

function setup(gateway: PayPalGateway = new MockGateway({ publicUrl: PUBLIC_URL, eventDelayMs: 0 })) {
  const registry = new StallRegistry(gateway, { dbPath: ":memory:", publicUrl: PUBLIC_URL });
  const { id: stallId, commerce } = registry.create();
  const raw = createApp(registry);
  // Every seller-API call targets this test's own stall, as the browser cookie would.
  const app = {
    request: (path: string, init: RequestInit = {}) =>
      raw.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), "x-stall-id": stallId } }),
  };
  const fetchApp = (url: string | URL, init?: RequestInit) => Promise.resolve(raw.fetch(new Request(url, init)));
  return { commerce, app, fetchApp, stallId, registry };
}

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

async function connectAgent(env: ReturnType<typeof setup>, name = "test-buyer") {
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${PUBLIC_URL}/s/${env.stallId}/mcp`), { fetch: env.fetchApp }));
  clients.push(client);
  return async (tool: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name: tool, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    if (res.isError) throw new Error(res.content[0].text);
    return JSON.parse(res.content[0].text);
  };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

describe("api", () => {
  it("reports health and PayPal mode", async () => {
    const res = await setup().app.request("/health");
    expect(await res.json()).toMatchObject({ ok: true, paypal: "mock" });
  });

  it("rejects MCP calls without initialize", async () => {
    const res = await setup().app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(400);
  });

  it("lets a buyer agent search, ask, check out and get confirmed through PayPal", async () => {
    const env = setup();
    const { commerce, app, fetchApp } = env;
    const call = await connectAgent(env);

    const search = await call("search_products", { query: "blue cotton scarf", max_price: 40, ship_to: "US" });
    expect(search.results.map((r: { id: string }) => r.id)).toContain("p_ocean");
    expect(search.results.every((r: { price: string }) => Number(r.price) <= 40)).toBe(true);

    const shipping = await call("ask_seller", { question: "How long does delivery to the US take?", product_id: "p_ocean" });
    expect(shipping).toMatchObject({ status: "answered", source: "policy:shipping" });

    const customs = await call("ask_seller", { question: "Will I pay customs duties on import?" });
    expect(customs).toMatchObject({ status: "unknown", answer: null });

    const checkout = await call("create_checkout", { product_id: "p_ocean" });
    expect(checkout.approveUrl).toBe(`${PUBLIC_URL}/mock-paypal/approve/${checkout.orderId}`);

    // Buyer approves on the (mock) PayPal page and is sent back to the merchant return URL.
    const approve = await app.request(`/mock-paypal/approve/${checkout.orderId}`, { method: "POST" });
    expect(approve.status).toBe(302);
    const returnUrl = new URL(approve.headers.get("location")!);
    expect(returnUrl.searchParams.get("token")).toBe(checkout.orderId);
    const returned = await app.request(`${returnUrl.pathname}${returnUrl.search}`);
    expect(returned.status).toBe(302);
    expect(returned.headers.get("location")).toBe(`/shop/done?status=paid&order=${checkout.orderId}`);

    await tick(); // capture event is asynchronous, like a real webhook
    expect(await call("get_order_status", { order_id: checkout.orderId })).toMatchObject({ status: "captured" });

    const order = commerce.store.orders.get(checkout.orderId)!;
    expect(order.customId).toMatch(/^agent:test-buyer:s_/);
    expect(commerce.store.products.get("p_ocean")!.stock).toBe(14);
    expect(commerce.store.events.map((e) => e.outcome)).toEqual([
      "searched",
      "answered",
      "unanswered",
      "checkout_created",
      "captured",
    ]);
  });

  it("captures instantly with the sandbox test card", async () => {
    const env = setup();
    const { fetchApp } = env;
    const call = await connectAgent(env, "judge-console");
    const checkout = await call("create_checkout", { product_id: "p_mini", quantity: 2, payment_method: "sandbox_test_card" });
    expect(checkout).toMatchObject({ paypalStatus: "COMPLETED", amount: "48.00" });
    expect(checkout).not.toHaveProperty("approveUrl");
    await tick();
    expect(await call("get_order_status", { order_id: checkout.orderId })).toMatchObject({ status: "captured" });
  });

  it("refuses checkout for out-of-stock products", async () => {
    const env = setup();
    const { fetchApp } = env;
    const call = await connectAgent(env);
    expect(await call("create_checkout", { product_id: "p_indigo" })).toEqual({ status: "out_of_stock", available: 0 });
  });

  it("teach once: the seller answers a queued question and the next agent gets it", async () => {
    const env = setup();
    const { app, fetchApp } = env;
    const first = await connectAgent(env, "agent-one");
    const { questionId } = await first("ask_seller", { question: "Will I pay customs duties on import?" });

    const res = await app.request(`/api/questions/${questionId}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answer: "Orders under $800 to the US arrive duty-free." }),
    });
    expect(res.status).toBe(200);

    const second = await connectAgent(env, "agent-two");
    expect(await second("ask_seller", { question: "Do I pay customs duties on import?" })).toMatchObject({
      status: "answered",
      answer: "Orders under $800 to the US arrive duty-free.",
    });
  });

  it("only accepts webhooks in sandbox mode, and only verified ones", async () => {
    expect((await setup().app.request("/webhooks/paypal", { method: "POST", body: "{}" })).status).toBe(503);

    let verified = false;
    const sandbox: PayPalGateway = Object.assign(Object.create(MockGateway.prototype), new MockGateway({ publicUrl: PUBLIC_URL }), {
      mode: "sandbox",
      verifyWebhook: async () => verified,
    });
    const { app } = setup(sandbox);
    const send = () =>
      app.request("/webhooks/paypal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} }),
      });
    expect((await send()).status).toBe(400);
    verified = true;
    expect((await send()).status).toBe(200);
  });
});

describe("stalls", () => {
  it("gives each visitor a private stall and persists it across restarts", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dbPath = `${mkdtempSync(`${tmpdir()}/agentstall-`)}/test.db`;
    const gateway = new MockGateway({ publicUrl: PUBLIC_URL, eventDelayMs: 0 });

    const first = new StallRegistry(gateway, { dbPath, publicUrl: PUBLIC_URL });
    const app = createApp(first);
    const res = await app.request("/api/stall");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/as_stall=/);
    const { id } = await res.json();
    const other = await (await app.request("/api/stall")).json();
    expect(other.id).not.toBe(id);

    first.get(id)!.store.addFact("Gift wrap?", "Yes, free.");
    first.close();

    const second = new StallRegistry(gateway, { dbPath, publicUrl: PUBLIC_URL });
    expect([...second.get(id)!.store.facts.values()].some((f) => f.answer === "Yes, free.")).toBe(true);
    second.close();
  });

  it("rate-limits AI-free test shopper batches per stall", async () => {
    const env = setup();
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await env.app.request("/api/simulate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ count: 1 }) })).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 429]);
  });

  it("records behind-the-scenes traces grouped by run", async () => {
    const env = setup();
    const res = await env.app.request("/api/simulate", { method: "POST", headers: { "content-type": "application/json", "x-run-id": "r_test" }, body: JSON.stringify({ count: 2 }) });
    expect(res.headers.get("x-run-id")).toBe("r_test");
    const traces = await (await env.app.request("/api/traces?run=r_test")).json();
    expect(traces.map((t: { kind: string }) => t.kind)).toEqual(expect.arrayContaining(["mcp", "paypal"]));
  });
});
