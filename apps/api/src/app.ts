import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { MockGateway, type PayPalEvent } from "@agentstall/paypal";
import type { Llm } from "./ai/llm.js";
import { RateLimiter } from "./ratelimit.js";
import { SHOWCASE_STALL, type StallRegistry } from "./registry.js";
import { sellerApi, type StallEnv } from "./seller-api.js";
import { withRun } from "./trace.js";

const STALL_COOKIE = "as_stall";

export function createApp(registry: StallRegistry, opts: { llm?: Llm; agentLlm?: Llm; limiter?: RateLimiter } = {}): Hono {
  const app = new Hono();
  const { gateway } = registry;
  // Internal agents (shopping assistant, test shoppers) reach the MCP endpoint in-process, exactly as outside agents do over HTTP.
  const inProcessFetch = (url: string | URL, init?: RequestInit) => Promise.resolve(app.fetch(new Request(url, init)));

  // Every request runs under a run id, so the UI can show exactly what one action did behind the scenes.
  app.use("*", async (c, next) => {
    const runId = c.req.header("x-run-id")?.slice(0, 64) || `r_${randomUUID().slice(0, 8)}`;
    await withRun(runId, async () => {
      await next();
      c.header("x-run-id", runId);
    });
  });

  app.get("/health", (c) => c.json({ ok: true, service: "agentstall-api", paypal: gateway.mode, ai: opts.llm ? "gemini" : "off" }));

  // Openly licensed demo photos (see demo-photos/CREDITS.md) for the onboarding demo.
  const photosDir = new URL("../../../demo-photos/", import.meta.url);
  app.get("/api/demo/photos", async (c) => {
    const lines = (await readFile(new URL("captions.txt", photosDir), "utf8").catch(() => "")).split("\n");
    return c.json(
      lines
        .map((l) => l.split(" | "))
        .filter(([file, caption]) => file && caption)
        .map(([file, caption]) => ({ file: file.trim(), caption: caption.trim(), url: `/demo-photos/${file.trim()}` })),
    );
  });
  app.get("/demo-photos/:file", async (c) => {
    const file = c.req.param("file");
    if (!/^\d{2}\.jpg$/.test(file)) return c.notFound();
    const data = await readFile(new URL(file, photosDir)).catch(() => null);
    return data ? c.body(data, 200, { "content-type": "image/jpeg", "cache-control": "public, max-age=86400" }) : c.notFound();
  });

  // Public MCP endpoints: one per stall, and /mcp for the shared showcase stall.
  app.all("/s/:stallId/mcp", (c) => {
    const handler = registry.mcpHandler(c.req.param("stallId"));
    return handler ? handler(c.req.raw) : c.json({ error: "No such stall" }, 404);
  });
  app.all("/mcp", (c) => registry.mcpHandler(SHOWCASE_STALL)!(c.req.raw));

  app.post("/webhooks/paypal", async (c) => {
    if (gateway.mode !== "sandbox") return c.json({ error: "webhooks need sandbox credentials" }, 503);
    const event = (await c.req.json()) as PayPalEvent;
    const verified = await gateway.verifyWebhook((h) => c.req.header(h), event);
    console.log(JSON.stringify({ msg: "paypal webhook", id: event?.id, type: event?.event_type, verified }));
    if (!verified) return c.json({ error: "signature verification failed" }, 400);
    registry.dispatch(event);
    return c.json({ received: true });
  });

  // Buyer returns here after approving in PayPal (`token` is the PayPal order id).
  app.get("/checkout/return", async (c) => {
    const orderId = c.req.query("token");
    const commerce = orderId ? registry.findByOrder(orderId) : undefined;
    if (!orderId || !commerce) return c.redirect("/shop/done?status=missing");
    try {
      await commerce.captureApproved(orderId);
      return c.redirect(`/shop/done?status=paid&order=${encodeURIComponent(orderId)}`);
    } catch (err) {
      console.error(err);
      return c.redirect(`/shop/done?status=failed&order=${encodeURIComponent(orderId)}`);
    }
  });
  app.get("/checkout/cancel", (c) => c.redirect("/shop/done?status=cancelled"));

  // The visitor's own demo stall, kept in a cookie. Tests and API clients can pass x-stall-id instead.
  const stalls = new Hono<StallEnv>();
  stalls.use("*", async (c, next) => {
    const requested = c.req.header("x-stall-id") ?? getCookie(c, STALL_COOKIE);
    let stallId = requested;
    let commerce = requested ? registry.get(requested) : undefined;
    if (!commerce) {
      ({ id: stallId, commerce } = registry.create());
      setCookie(c, STALL_COOKIE, stallId!, { path: "/", httpOnly: true, sameSite: "Lax", maxAge: 7 * 24 * 3600 });
    }
    c.set("commerce", commerce);
    c.set("stallId", stallId!);
    await next();
    // Direct field edits (stock, statuses) don't flag the store, so mark every write request as a change.
    if (c.req.method !== "GET") commerce.store.dirty = true;
  });
  stalls.route("/", sellerApi(registry, { llm: opts.llm, agentLlm: opts.agentLlm, fetchImpl: inProcessFetch, limiter: opts.limiter }));
  app.route("/api", stalls);

  if (gateway instanceof MockGateway) {
    // Stand-in for sandbox.paypal.com approval while there are no credentials.
    app.get("/mock-paypal/approve/:id", (c) => {
      const commerce = registry.findByOrder(c.req.param("id"));
      const order = commerce?.store.orders.get(c.req.param("id"));
      if (!commerce || !order) return c.html(mockPage("Order not found", "<p>This payment link has expired.</p>"), 404);
      const product = commerce.store.products.get(order.productId);
      return c.html(
        mockPage(
          "Review your payment",
          `<div class="row"><span>${escapeHtml(product?.title ?? "Item")} × ${order.quantity}</span><b>$${order.amount}</b></div>
           <div class="row muted"><span>Pay to</span><span>${escapeHtml(commerce.store.seller.name)}</span></div>
           <form method="post"><button type="submit">Pay $${order.amount}</button></form>
           <a class="cancel" href="/checkout/cancel">Cancel and return</a>`,
        ),
      );
    });
    app.post("/mock-paypal/approve/:id", (c) => {
      const id = c.req.param("id");
      if (!registry.findByOrder(id)) return c.html(mockPage("Order not found", "<p>This payment link has expired.</p>"), 404);
      const returnUrl = gateway.approve(id);
      return returnUrl ? c.redirect(returnUrl) : c.html(mockPage("Approved", "<p>You can close this tab.</p>"));
    });
  }

  return app;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** A checkout-style page, clearly labelled as a mock so nobody mistakes it for PayPal. */
function mockPage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Mock PayPal</title><style>
:root{color-scheme:light dark}body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f4f1ec;color:#1f1b16}
.banner{background:#fbf0d9;color:#7a4f00;text-align:center;font-weight:600;font-size:.85rem;padding:.4rem}
.card{max-width:26rem;margin:3rem auto;background:#fff;border-radius:14px;padding:1.5rem;box-shadow:0 4px 24px rgb(0 0 0/8%)}
h1{font-size:1.3rem;margin:0 0 1rem}.row{display:flex;justify-content:space-between;gap:1rem;padding:.4rem 0}.muted{color:#6b6258}
button{width:100%;margin-top:1.2rem;font:inherit;font-weight:700;padding:.8rem;border:0;border-radius:999px;background:#b4532a;color:#fff;cursor:pointer}
.cancel{display:block;text-align:center;margin-top:.8rem;color:#6b6258}
@media (prefers-color-scheme:dark){body{background:#17140f;color:#f1ebe2}.card{background:#211d17}.muted,.cancel{color:#b3a898}}
</style></head><body><div class="banner">MOCK PAYPAL · demo only, no real money · real PayPal sandbox is connected later</div>
<main class="card"><h1>${title}</h1>${body}</main></body></html>`;
}
