import { Hono } from "hono";
import { MockGateway, type PayPalEvent } from "@openstall/paypal";
import type { Commerce } from "./commerce.js";
import type { Llm } from "./ai/llm.js";
import { createMcpHandler } from "./mcp.js";
import { sellerApi } from "./seller-api.js";
import { seedDemoStore } from "./store.js";

export function createApp(commerce: Commerce, opts: { llm?: Llm; agentLlm?: Llm } = {}): Hono {
  const app = new Hono();
  const { gateway } = commerce;
  const mcp = createMcpHandler(commerce);
  // Internal agents (Buyer Console, personas) reach the MCP endpoint in-process, exactly as external agents do over HTTP.
  const inProcessFetch = (url: string | URL, init?: RequestInit) => Promise.resolve(app.fetch(new Request(url, init)));

  app.get("/health", (c) => c.json({ ok: true, service: "openstall-api", paypal: gateway.mode }));

  app.all("/mcp", (c) => mcp(c.req.raw));

  app.post("/webhooks/paypal", async (c) => {
    if (gateway.mode !== "sandbox") return c.json({ error: "webhooks need sandbox credentials" }, 503);
    const event = (await c.req.json()) as PayPalEvent;
    const verified = await gateway.verifyWebhook((h) => c.req.header(h), event);
    console.log(JSON.stringify({ msg: "paypal webhook", id: event?.id, type: event?.event_type, verified }));
    if (!verified) return c.json({ error: "signature verification failed" }, 400);
    commerce.handlePayPalEvent(event);
    return c.json({ received: true });
  });

  // Buyer returns here after approving in PayPal (`token` is the PayPal order id).
  app.get("/checkout/return", async (c) => {
    const orderId = c.req.query("token");
    if (!orderId || !commerce.store.orders.has(orderId)) return c.html(page("Order not found", "We couldn't find that order."), 404);
    try {
      await commerce.captureApproved(orderId);
      return c.html(page("Payment approved", `Thanks! Order <code>${orderId}</code> is being confirmed by PayPal. You can close this tab.`));
    } catch (err) {
      console.error(err);
      return c.html(page("Payment not completed", "PayPal couldn't complete this payment. Please try again."), 502);
    }
  });

  app.route(
    "/api",
    sellerApi(commerce, {
      llm: opts.llm,
      agentLlm: opts.agentLlm,
      mcpUrl: "http://openstall.internal/mcp",
      fetchImpl: inProcessFetch,
      reseed: () => commerce.reset(seedDemoStore()),
    }),
  );

  app.get("/checkout/cancel", (c) => c.html(page("Checkout cancelled", "No payment was taken.")));

  if (gateway instanceof MockGateway) {
    // Stand-in for sandbox.paypal.com approval while there are no credentials.
    app.get("/mock-paypal/approve/:id", (c) => {
      const order = commerce.store.orders.get(c.req.param("id"));
      if (!order) return c.html(page("Mock PayPal", "Unknown order."), 404);
      return c.html(
        page(
          "MOCK PAYPAL — not real",
          `Approve payment of <b>${order.amount} ${order.currency}</b> to ${commerce.store.seller.name}?
           <form method="post"><button type="submit">Approve (mock)</button></form>`,
        ),
      );
    });
    app.post("/mock-paypal/approve/:id", (c) => {
      const returnUrl = gateway.approve(c.req.param("id"));
      return returnUrl ? c.redirect(returnUrl) : c.html(page("Mock PayPal", "Approved."));
    });
  }

  return app;
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem}button{font:inherit;padding:.5rem 1rem}</style>
</head><body><h1>${title}</h1><p>${body}</p></body></html>`;
}
