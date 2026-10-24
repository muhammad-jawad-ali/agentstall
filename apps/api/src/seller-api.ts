import { Hono, type Context } from "hono";
import { z } from "zod";
import { runBuyerAgent, runPersonaBatch } from "./ai/buyer.js";
import { extractListing } from "./ai/listings.js";
import type { Llm } from "./ai/llm.js";
import { tracedLlm } from "./ai/traced-llm.js";
import type { Commerce } from "./commerce.js";
import { LIMITS, type Limit, RateLimiter } from "./ratelimit.js";
import type { StallRegistry } from "./registry.js";

type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export type StallEnv = { Variables: { commerce: Commerce; stallId: string } };

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const ProductPatch = z
  .object({
    title: z.string().min(3).max(80),
    description: z.string().min(10).max(400),
    price: z.string().regex(/^\d+(\.\d{1,2})?$/),
    stock: z.number().int().min(0).max(10_000),
    tags: z.array(z.string().min(2).max(24)).max(10),
    shipsTo: z.array(z.string().length(2)).min(1),
    shippingDays: z.number().int().min(1).max(60),
  })
  .partial();

function clientIp(c: Context): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

/**
 * Seller-side API for the visitor's own stall: listing extraction and review, publishing, the
 * "My Stall" read models, behind-the-scenes traces, and the demo tools (shopping assistant,
 * test shopper batches, reset). The stall comes from the `stall` middleware in app.ts.
 */
export function sellerApi(
  registry: StallRegistry,
  opts: { llm?: Llm; agentLlm?: Llm; fetchImpl?: FetchLike; limiter?: RateLimiter },
): Hono<StallEnv> {
  const api = new Hono<StallEnv>();
  const limiter = opts.limiter ?? new RateLimiter();
  const mcpUrl = (stallId: string) => `http://agentstall.internal/s/${stallId}/mcp`;

  /** Applies a per-stall and per-IP limit plus the site-wide daily AI cap. Returns a 429 response or undefined. */
  const limited = (c: Context<StallEnv>, limit: Limit, ai = true) => {
    const checks: [string, Limit][] = [
      [`${limit.name}:stall:${c.get("stallId")}`, limit],
      [`${limit.name}:ip:${clientIp(c)}`, { ...limit, max: limit.max * 3 }],
      ...(ai ? ([["ai-daily", LIMITS.aiDaily]] as [string, Limit][]) : []),
    ];
    for (const [key, l] of checks) {
      const retryAfter = limiter.hit(key, l.max, l.windowMs);
      if (retryAfter) {
        return c.json(
          { error: `Demo limit reached for ${l.name}. Try again in ${formatWait(retryAfter)}.`, retryAfter, limit: l.name },
          429,
          { "retry-after": String(retryAfter) },
        );
      }
    }
    return undefined;
  };
  const noAi = (c: Context) => c.json({ error: "AI is not configured on this server (GEMINI_API_KEY is missing)." }, 503);

  api.onError((err, c) => {
    console.error(err);
    const status = /^No (product|question|order)/.test(err.message) ? 404 : 500;
    return c.json({ error: friendly(err.message) }, status);
  });

  const store = (c: Context<StallEnv>) => c.get("commerce").store;

  api.get("/stall", (c) => {
    const s = store(c);
    return c.json({
      id: c.get("stallId"),
      seller: s.seller,
      mcpPath: `/s/${c.get("stallId")}/mcp`,
      paypal: c.get("commerce").gateway.mode,
      counts: {
        products: s.publishedProducts().length,
        drafts: [...s.products.values()].filter((p) => p.status === "draft").length,
        orders: s.orders.size,
      },
    });
  });

  api.get("/products", (c) => c.json([...store(c).products.values()]));

  // Photo + caption -> validated draft listing. Nothing is published until the seller approves.
  api.post("/listings/extract", async (c) => {
    if (!opts.llm) return noAi(c);
    const blocked = limited(c, LIMITS.extract);
    if (blocked) return blocked;
    const form = await c.req.formData();
    const caption = String(form.get("caption") ?? "").trim();
    const file = form.get("image");
    const source = String(form.get("source") ?? "");
    if (!caption && !(file instanceof File)) return c.json({ error: "Add a photo or a caption first." }, 400);

    let image: { mimeType: string; base64: string } | undefined;
    if (file instanceof File) {
      if (!file.type.startsWith("image/")) return c.json({ error: "That file isn't an image." }, 400);
      if (file.size > MAX_IMAGE_BYTES) return c.json({ error: "Please use a photo under 5 MB." }, 400);
      image = { mimeType: file.type, base64: Buffer.from(await file.arrayBuffer()).toString("base64") };
    }

    const s = store(c);
    const draft = await extractListing(tracedLlm(opts.llm, s, "Listing extractor reads the post"), { image, caption });
    const product = s.addProduct({
      title: draft.title,
      description: draft.description,
      price: draft.price_usd ?? "",
      currency: "USD",
      stock: 1,
      shipsTo: ["US", "GB", "CA", "AU"],
      shippingDays: 7,
      tags: draft.tags,
      materials: draft.materials,
      colors: draft.colors,
      needsReview: draft.needs_review,
      sourceCaption: caption,
      sourcePermalink: source || undefined,
      imageUrl: image ? `data:${image.mimeType};base64,${image.base64}` : undefined,
      status: "draft",
    });
    return c.json({ product, draft });
  });

  api.patch("/products/:id", async (c) => {
    const product = store(c).products.get(c.req.param("id"));
    if (!product) return c.json({ error: "That product no longer exists." }, 404);
    const patch = ProductPatch.safeParse(await c.req.json());
    if (!patch.success) return c.json({ error: "Some fields aren't valid.", fields: patch.error.flatten().fieldErrors }, 400);
    Object.assign(product, patch.data);
    return c.json(product);
  });

  // Seller approves a listing: it becomes a PayPal Catalog product and agents can find it.
  api.post("/products/:id/publish", async (c) => {
    const s = store(c);
    const product = s.products.get(c.req.param("id"));
    if (!product) return c.json({ error: "That product no longer exists." }, 404);
    if (!/^\d+(\.\d{1,2})?$/.test(product.price)) return c.json({ error: "Set a price in US dollars first, like 28.00." }, 400);
    if (!product.paypalProductId) {
      const input = { name: product.title, description: product.description, type: "PHYSICAL" as const };
      const { id } = await s.traced("paypal", "Create catalog product · POST /v1/catalogs/products", input, () =>
        c.get("commerce").gateway.createCatalogProduct(input),
      );
      product.paypalProductId = id;
    }
    product.status = "published";
    product.needsReview = [];
    return c.json(product);
  });

  api.delete("/products/:id", (c) => {
    const removed = store(c).products.delete(c.req.param("id"));
    return removed ? c.json({ ok: true }) : c.json({ error: "That product no longer exists." }, 404);
  });

  api.get("/orders", (c) => c.json([...store(c).orders.values()].reverse()));
  api.get("/events", (c) => c.json(store(c).events.slice(-500).reverse()));
  api.get("/questions", (c) => c.json([...store(c).questions.values()].filter((q) => q.status === "open")));
  api.get("/facts", (c) => c.json([...store(c).facts.values()].reverse()));
  api.post("/questions/:id/answer", async (c) => {
    const { answer } = await c.req.json<{ answer?: string }>();
    if (!answer?.trim()) return c.json({ error: "Type an answer first." }, 400);
    const fact = store(c).answerQuestion(c.req.param("id"), answer.trim());
    const alsoAnswered = await c.get("commerce").resolveOpenQuestions();
    return c.json({ ...fact, alsoAnswered });
  });

  // Behind-the-scenes trace: everything one action did (?run=) or everything since a time (?since=).
  api.get("/traces", (c) => {
    const run = c.req.query("run");
    const since = c.req.query("since");
    const traces = store(c).traces.filter((t) => (run ? t.runId === run : true) && (since ? t.at > since : true));
    return c.json(traces.slice(-200));
  });

  // Agent funnel: furthest stage each agent session reached. Simulated personas are counted separately.
  api.get("/funnel", (c) => {
    const stages = ["searched", "questioned", "checkout_created", "captured"] as const;
    const rank: Record<string, number> = { searched: 0, viewed: 0, answered: 1, unanswered: 1, checkout_created: 2, captured: 3 };
    const sessions = new Map<string, { agent: string; stage: number; unanswered: boolean }>();
    for (const e of store(c).events) {
      const s = sessions.get(e.sessionId) ?? { agent: e.agent, stage: 0, unanswered: false };
      s.stage = Math.max(s.stage, rank[e.outcome] ?? 0);
      if (e.outcome === "unanswered") s.unanswered = true;
      sessions.set(e.sessionId, s);
    }
    const summarise = (simulated: boolean) => {
      const list = [...sessions.values()].filter((s) => s.agent.startsWith("sim-persona-") === simulated);
      return {
        sessions: list.length,
        stages: Object.fromEntries(stages.map((name, i) => [name, list.filter((s) => s.stage >= i).length])),
        leftAfterUnansweredQuestion: list.filter((s) => s.unanswered && s.stage < 2).length,
      };
    };
    return c.json({ real: summarise(false), simulated: summarise(true) });
  });

  // Shopping assistant: an AI agent shops this stall over MCP, so anyone can watch an agent buy.
  api.post("/console/run", async (c) => {
    if (!opts.llm) return noAi(c);
    const blocked = limited(c, LIMITS.shop);
    if (blocked) return blocked;
    const body = await c.req.json<{ goal?: string; payment_method?: "paypal" | "sandbox_test_card" }>();
    const goal = body.goal?.trim().slice(0, 500);
    if (!goal) return c.json({ error: "Tell the assistant what you're looking for." }, 400);
    const result = await runBuyerAgent({
      llm: tracedLlm(opts.agentLlm ?? opts.llm, store(c), "Shopping assistant"),
      mcpUrl: mcpUrl(c.get("stallId")),
      goal,
      paymentMethod: body.payment_method,
      fetchImpl: opts.fetchImpl,
    });
    return c.json(result);
  });

  // Batch of simulated test shoppers (labelled as simulated everywhere they appear).
  api.post("/simulate", async (c) => {
    const blocked = limited(c, LIMITS.simulate);
    if (blocked) return blocked;
    const { count = 20 } = await c.req.json<{ count?: number }>().catch(() => ({ count: 20 }));
    const n = Math.min(Math.max(1, Math.floor(count)), 40);
    return c.json(await runPersonaBatch(n, mcpUrl(c.get("stallId")), opts.fetchImpl));
  });

  api.post("/demo/reset", (c) => {
    registry.reset(c.get("stallId"));
    return c.json({ ok: true });
  });

  return api;
}

function formatWait(seconds: number): string {
  if (seconds < 90) return `${seconds} seconds`;
  if (seconds < 5400) return `${Math.ceil(seconds / 60)} minutes`;
  return `${Math.ceil(seconds / 3600)} hours`;
}

/** Turns internal errors into something a non-technical visitor can act on. */
function friendly(message: string): string {
  if (/Gemini .*(429|503)|aborted|timeout/i.test(message)) return "The AI is busy right now (free tier). Please try again in a minute.";
  if (/schema validation/i.test(message)) return "The AI's answer didn't pass our checks. Please try again.";
  if (/^No (product|question|order)/.test(message)) return "That item no longer exists. Try refreshing the page.";
  return "Something went wrong on our side. Please try again.";
}
