import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { MockGateway, type PayPalGateway } from "@openstall/paypal";
import { createApp } from "../src/app.js";
import { Commerce } from "../src/commerce.js";
import { seedDemoStore } from "../src/store.js";

const PUBLIC_URL = "http://openstall.test";

function setup(gateway: PayPalGateway = new MockGateway({ publicUrl: PUBLIC_URL, eventDelayMs: 0 })) {
  const commerce = new Commerce(seedDemoStore(), gateway, { publicUrl: PUBLIC_URL });
  const app = createApp(commerce);
  const fetchApp = (url: string | URL, init?: RequestInit) => Promise.resolve(app.fetch(new Request(url, init)));
  return { commerce, app, fetchApp };
}

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

async function connectAgent(fetchApp: ReturnType<typeof setup>["fetchApp"], name = "test-buyer") {
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${PUBLIC_URL}/mcp`), { fetch: fetchApp }));
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
    const { commerce, app, fetchApp } = setup();
    const call = await connectAgent(fetchApp);

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
    expect(returned.status).toBe(200);

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
    const { fetchApp } = setup();
    const call = await connectAgent(fetchApp, "judge-console");
    const checkout = await call("create_checkout", { product_id: "p_mini", quantity: 2, payment_method: "sandbox_test_card" });
    expect(checkout).toMatchObject({ paypalStatus: "COMPLETED", amount: "48.00" });
    expect(checkout).not.toHaveProperty("approveUrl");
    await tick();
    expect(await call("get_order_status", { order_id: checkout.orderId })).toMatchObject({ status: "captured" });
  });

  it("refuses checkout for out-of-stock products", async () => {
    const { fetchApp } = setup();
    const call = await connectAgent(fetchApp);
    expect(await call("create_checkout", { product_id: "p_indigo" })).toEqual({ status: "out_of_stock", available: 0 });
  });

  it("teach once: the seller answers a queued question and the next agent gets it", async () => {
    const { app, fetchApp } = setup();
    const first = await connectAgent(fetchApp, "agent-one");
    const { questionId } = await first("ask_seller", { question: "Will I pay customs duties on import?" });

    const res = await app.request(`/api/questions/${questionId}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answer: "Orders under $800 to the US arrive duty-free." }),
    });
    expect(res.status).toBe(200);

    const second = await connectAgent(fetchApp, "agent-two");
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
