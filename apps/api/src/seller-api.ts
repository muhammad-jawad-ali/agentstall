import { Hono } from "hono";
import { z } from "zod";
import { runBuyerAgent, runPersonaBatch } from "./ai/buyer.js";
import { extractListing } from "./ai/listings.js";
import type { Llm } from "./ai/llm.js";
import type { Commerce } from "./commerce.js";

type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Fixed-window limiter so the public demo can't burn through the free AI quota. */
function limiter(max: number, windowMs: number) {
  let windowStart = Date.now();
  let used = 0;
  return () => {
    if (Date.now() - windowStart > windowMs) {
      windowStart = Date.now();
      used = 0;
    }
    return ++used <= max;
  };
}

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

/**
 * Seller-side API: listing extraction and review, product publishing, the Agent Desk read models,
 * and the demo tools (Buyer Agent Console, simulated persona batch, reset).
 */
export function sellerApi(
  commerce: Commerce,
  opts: { llm?: Llm; agentLlm?: Llm; mcpUrl: string; fetchImpl?: FetchLike; reseed?: () => void },
): Hono {
  const api = new Hono();
  const store = () => commerce.store;
  const aiAllowed = limiter(60, 60 * 60 * 1000);
  const needLlm = () => (opts.llm ? undefined : { error: "AI is not configured (set GEMINI_API_KEY)" });

  api.onError((err, c) => {
    console.error(err);
    const status = /^No (product|question|order)/.test(err.message) ? 404 : 500;
    return c.json({ error: err.message }, status);
  });

  api.get("/products", (c) => c.json([...store().products.values()]));

  // Photo + caption -> validated draft listing. Nothing is published until the seller approves.
  api.post("/listings/extract", async (c) => {
    if (needLlm()) return c.json(needLlm(), 503);
    if (!aiAllowed()) return c.json({ error: "Demo AI limit reached, try again later" }, 429);
    const form = await c.req.formData();
    const caption = String(form.get("caption") ?? "").trim();
    const file = form.get("image");
    if (!caption && !(file instanceof File)) return c.json({ error: "Send an image and/or a caption" }, 400);

    let image: { mimeType: string; base64: string } | undefined;
    if (file instanceof File) {
      if (!file.type.startsWith("image/")) return c.json({ error: "image must be an image file" }, 400);
      if (file.size > MAX_IMAGE_BYTES) return c.json({ error: "image must be under 5 MB" }, 400);
      image = { mimeType: file.type, base64: Buffer.from(await file.arrayBuffer()).toString("base64") };
    }

    const draft = await extractListing(opts.llm!, { image, caption });
    const product = store().addProduct({
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
      imageUrl: image ? `data:${image.mimeType};base64,${image.base64}` : undefined,
      status: "draft",
    });
    return c.json({ product, draft });
  });

  api.patch("/products/:id", async (c) => {
    const product = store().products.get(c.req.param("id"));
    if (!product) return c.json({ error: "No product" }, 404);
    const patch = ProductPatch.safeParse(await c.req.json());
    if (!patch.success) return c.json({ error: patch.error.flatten() }, 400);
    Object.assign(product, patch.data);
    return c.json(product);
  });

  // Seller approves a listing: it becomes a PayPal Catalog product and agents can find it.
  api.post("/products/:id/publish", async (c) => {
    const product = store().products.get(c.req.param("id"));
    if (!product) return c.json({ error: "No product" }, 404);
    if (!/^\d+(\.\d{1,2})?$/.test(product.price)) return c.json({ error: "Set a USD price before publishing" }, 400);
    if (!product.paypalProductId) {
      const { id } = await commerce.gateway.createCatalogProduct({
        name: product.title,
        description: product.description,
        type: "PHYSICAL",
      });
      product.paypalProductId = id;
    }
    product.status = "published";
    product.needsReview = [];
    return c.json(product);
  });

  api.get("/orders", (c) => c.json([...store().orders.values()].reverse()));
  api.get("/events", (c) => c.json(store().events.slice(-500).reverse()));
  api.get("/questions", (c) => c.json([...store().questions.values()].filter((q) => q.status === "open")));
  api.post("/questions/:id/answer", async (c) => {
    const { answer } = await c.req.json<{ answer?: string }>();
    if (!answer?.trim()) return c.json({ error: "answer required" }, 400);
    const fact = store().answerQuestion(c.req.param("id"), answer.trim());
    const alsoAnswered = await commerce.resolveOpenQuestions();
    return c.json({ ...fact, alsoAnswered });
  });

  // Agent funnel: furthest stage each agent session reached. Simulated personas are counted separately.
  api.get("/funnel", (c) => {
    const stages = ["searched", "questioned", "checkout_created", "captured"] as const;
    const rank: Record<string, number> = { searched: 0, viewed: 0, answered: 1, unanswered: 1, checkout_created: 2, captured: 3 };
    const sessions = new Map<string, { agent: string; stage: number; unanswered: boolean }>();
    for (const e of store().events) {
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

  // Hosted Buyer Agent Console: judges watch an AI agent shop without their own AI key.
  api.post("/console/run", async (c) => {
    if (needLlm()) return c.json(needLlm(), 503);
    if (!aiAllowed()) return c.json({ error: "Demo AI limit reached, try again later" }, 429);
    const body = await c.req.json<{ goal?: string; payment_method?: "paypal" | "sandbox_test_card" }>();
    const goal = body.goal?.trim().slice(0, 500);
    if (!goal) return c.json({ error: "goal required" }, 400);
    const result = await runBuyerAgent({
      llm: opts.agentLlm ?? opts.llm!,
      mcpUrl: opts.mcpUrl,
      goal,
      paymentMethod: body.payment_method,
      fetchImpl: opts.fetchImpl,
    });
    return c.json(result);
  });

  // Batch of simulated buyer agents (labelled as simulated everywhere they appear).
  api.post("/simulate", async (c) => {
    const { count = 40 } = await c.req.json<{ count?: number }>().catch(() => ({ count: 40 }));
    const n = Math.min(Math.max(1, Math.floor(count)), 60);
    return c.json(await runPersonaBatch(n, opts.mcpUrl, opts.fetchImpl));
  });

  api.post("/demo/reset", (c) => {
    opts.reseed?.();
    return c.json({ ok: true });
  });

  return api;
}
