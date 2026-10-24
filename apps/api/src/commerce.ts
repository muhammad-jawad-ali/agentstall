import {
  type PayPalEvent,
  type PayPalGateway,
  SANDBOX_TEST_CARD,
  agentCustomId,
  approveLink,
} from "@agentstall/paypal";
import { type Order, type Product, type Store, now } from "./store.js";

export interface AgentContext {
  sessionId: string;
  /** Self-declared MCP client name. Attribution, not verified identity. */
  agent: string;
}

export interface SearchInput {
  query: string;
  maxPrice?: number;
  shipTo?: string;
  limit?: number;
}

/** Answers buyer-agent questions only from the seller's approved facts and policies. */
export interface SellerAnswerer {
  answer(question: string, store: Store, product?: Product): Promise<{ answer: string; source: string } | null>;
}

const STOPWORDS = new Set(
  "a an the and or of to in on for with is are do does can i you my me it this that what how much many any be will your".split(" "),
);

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map((t) => t.replace(/(es|s)$/, ""));
}

function overlap(a: string[], b: string[]): number {
  const set = new Set(b);
  return a.filter((t) => set.has(t)).length;
}

/**
 * Keyword answerer used until the LLM stall-keeper lands. Only answers when a seller fact or policy
 * clearly matches; anything else is "unknown" and goes to the seller's queue.
 */
export class KeywordAnswerer implements SellerAnswerer {
  async answer(question: string, store: Store) {
    const q = tokens(question);
    let best: { score: number; answer: string; source: string } | null = null;
    for (const fact of store.facts.values()) {
      const score = overlap(q, tokens(fact.question)) / Math.max(1, Math.min(q.length, tokens(fact.question).length));
      if (!best || score > best.score) best = { score, answer: fact.answer, source: `fact:${fact.id}` };
    }
    const policies = [
      { keys: ["ship", "shipping", "deliver", "delivery", "arrive", "long", "day"], text: store.seller.shippingPolicy, source: "policy:shipping" },
      { keys: ["return", "refund", "exchange"], text: store.seller.returnsPolicy, source: "policy:returns" },
    ];
    for (const p of policies) {
      const hits = overlap(q, tokens(p.keys.join(" ")));
      // Policy matches are weaker than a direct fact match.
      const score = hits > 0 ? 0.5 + 0.1 * hits : 0;
      if (!best || score > best.score) best = { score, answer: p.text, source: p.source };
    }
    return best && best.score >= 0.5 ? { answer: best.answer, source: best.source } : null;
  }
}

export class Commerce {
  constructor(
    public store: Store,
    readonly gateway: PayPalGateway,
    private readonly options: { publicUrl: string; answerer?: SellerAnswerer; listen?: boolean },
  ) {
    // A stall registry dispatches events itself; standalone use (tests) subscribes directly.
    if (options.listen !== false) gateway.onEvent((event) => this.handlePayPalEvent(event));
  }

  /**
   * After the seller teaches a new fact, re-ask every open question: the ones the new fact answers
   * (in any phrasing) close, so the seller answers each real question once.
   */
  async resolveOpenQuestions(): Promise<number> {
    const open = [...this.store.questions.values()].filter((q) => q.status === "open");
    let closed = 0;
    for (const q of open) {
      const product = q.productId ? this.store.products.get(q.productId) : undefined;
      const result = await this.answerer.answer(q.text, this.store, product);
      if (result) {
        q.status = "answered";
        q.factId = result.source.match(/fact:(f_[\w-]+)/)?.[1];
        closed++;
      }
    }
    return closed;
  }

  /** Swap in a fresh store (demo reset). */
  reset(store: Store) {
    this.store = store;
  }

  private get answerer(): SellerAnswerer {
    return this.options.answerer ?? new KeywordAnswerer();
  }

  search(ctx: AgentContext, input: SearchInput) {
    const q = tokens(input.query);
    const shipTo = input.shipTo?.toUpperCase();
    const results = this.store
      .publishedProducts()
      .filter((p) => (input.maxPrice === undefined ? true : Number(p.price) <= input.maxPrice))
      .filter((p) => (shipTo ? p.shipsTo.includes(shipTo) : true))
      .map((p) => ({ p, score: q.length ? overlap(q, tokens(`${p.title} ${p.description} ${p.tags.join(" ")}`)) : 1 }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || Number(a.p.price) - Number(b.p.price))
      .slice(0, input.limit ?? 5)
      .map(({ p }) => publicProduct(p));
    this.store.logEvent({ ...ctx, tool: "search_products", outcome: "searched", detail: input.query });
    return { seller: this.store.seller.name, results };
  }

  getProduct(ctx: AgentContext, productId: string) {
    const product = this.requireProduct(productId);
    this.store.logEvent({ ...ctx, tool: "get_product", outcome: "viewed", productId });
    return {
      ...publicProduct(product),
      shippingPolicy: this.store.seller.shippingPolicy,
      returnsPolicy: this.store.seller.returnsPolicy,
    };
  }

  async askSeller(ctx: AgentContext, question: string, productId?: string) {
    const product = productId ? this.requireProduct(productId) : undefined;
    const result = await this.answerer.answer(question, this.store, product);
    if (result) {
      this.store.logEvent({ ...ctx, tool: "ask_seller", outcome: "answered", productId, detail: question });
      return { status: "answered" as const, answer: result.answer, source: result.source };
    }
    const q = this.store.addQuestion({ ...ctx, productId, text: question });
    this.store.logEvent({ ...ctx, tool: "ask_seller", outcome: "unanswered", productId, detail: question });
    return {
      status: "unknown" as const,
      answer: null,
      note: "The seller hasn't answered this yet. It has been passed to them; do not assume an answer.",
      questionId: q.id,
    };
  }

  async createCheckout(
    ctx: AgentContext,
    input: { productId: string; quantity?: number; paymentMethod?: "paypal" | "sandbox_test_card" },
  ) {
    const product = this.requireProduct(input.productId);
    const quantity = input.quantity ?? 1;
    if (product.stock < quantity) {
      this.store.logEvent({ ...ctx, tool: "create_checkout", outcome: "error", productId: product.id, detail: "out of stock" });
      return { status: "out_of_stock" as const, available: product.stock };
    }
    const amount = (Number(product.price) * quantity).toFixed(2);
    const customId = agentCustomId(ctx.agent, ctx.sessionId);
    const orderInput = {
      amount,
      currency: product.currency,
      description: `${quantity} x ${product.title}`.slice(0, 127),
      customId,
      card: input.paymentMethod === "sandbox_test_card" ? SANDBOX_TEST_CARD : undefined,
      returnUrl: `${this.options.publicUrl}/checkout/return`,
      cancelUrl: `${this.options.publicUrl}/checkout/cancel`,
    };
    const paypalOrder = await this.store.traced(
      "paypal",
      "Create order · POST /v2/checkout/orders",
      { ...orderInput, card: orderInput.card ? "sandbox test card" : undefined },
      () => this.gateway.createOrder(orderInput),
    );
    const order = this.store.saveOrder({
      id: paypalOrder.id,
      productId: product.id,
      quantity,
      amount,
      currency: product.currency,
      ...ctx,
      customId,
      status: "awaiting_approval",
      approveUrl: approveLink(paypalOrder),
      createdAt: now(),
      updatedAt: now(),
    });
    this.store.logEvent({ ...ctx, tool: "create_checkout", outcome: "checkout_created", productId: product.id, detail: order.id });
    return {
      orderId: order.id,
      amount,
      currency: order.currency,
      paypalStatus: paypalOrder.status,
      approveUrl: paypalOrder.status === "COMPLETED" ? undefined : order.approveUrl,
      next:
        paypalOrder.status === "COMPLETED"
          ? "Payment captured. PayPal confirmation will arrive shortly; check get_order_status."
          : "Send the buyer to approveUrl to approve the payment in PayPal, then check get_order_status.",
    };
  }

  async orderStatus(orderId: string) {
    const order = this.store.orders.get(orderId);
    if (!order) throw new Error(`No order ${orderId}`);
    return { orderId, status: order.status, amount: order.amount, currency: order.currency, captureId: order.captureId };
  }

  /** Buyer came back from PayPal approval: capture the order. Confirmation arrives by event. */
  async captureApproved(orderId: string): Promise<Order> {
    const order = this.store.orders.get(orderId);
    if (!order) throw new Error(`No order ${orderId}`);
    if (order.status === "awaiting_approval") {
      await this.store.traced("paypal", "Capture order · POST /v2/checkout/orders/{id}/capture", { orderId }, () =>
        this.gateway.captureOrder(orderId),
      );
    }
    return order;
  }

  /** Applies a verified PayPal event (webhook in sandbox, in-process in mock). Idempotent. */
  handlePayPalEvent(event: PayPalEvent) {
    if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") return;
    const resource = event.resource as { id?: string; supplementary_data?: { related_ids?: { order_id?: string } } };
    const orderId = resource.supplementary_data?.related_ids?.order_id;
    const order = orderId ? this.store.orders.get(orderId) : undefined;
    if (!order || order.status === "captured") return;

    this.store.trace({ kind: "webhook", label: "PayPal event · PAYMENT.CAPTURE.COMPLETED", input: { eventId: event.id, orderId, captureId: resource.id }, output: { verified: this.gateway.mode === "sandbox" ? true : "mock event" } });
    order.status = "captured";
    order.captureId = resource.id;
    order.paypalEventId = event.id;
    order.updatedAt = now();
    const product = this.store.products.get(order.productId);
    if (product) product.stock = Math.max(0, product.stock - order.quantity);
    this.store.dirty = true;
    this.store.logEvent({
      sessionId: order.sessionId,
      agent: order.agent,
      tool: "paypal_webhook",
      outcome: "captured",
      productId: order.productId,
      detail: event.id,
    });
  }

  private requireProduct(productId: string): Product {
    const product = this.store.products.get(productId);
    if (!product || product.status !== "published") throw new Error(`No product ${productId}`);
    return product;
  }
}

function publicProduct(p: Product) {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    price: p.price,
    currency: p.currency,
    inStock: p.stock > 0,
    stock: p.stock,
    shipsTo: p.shipsTo,
    estimatedShippingDays: p.shippingDays,
    imageUrl: p.imageUrl,
  };
}
