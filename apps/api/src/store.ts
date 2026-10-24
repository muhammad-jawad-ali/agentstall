import { randomUUID } from "node:crypto";

export interface Seller {
  id: string;
  name: string;
  story: string;
  country: string;
  shippingPolicy: string;
  returnsPolicy: string;
}

export interface Product {
  id: string;
  title: string;
  description: string;
  price: string;
  currency: "USD";
  stock: number;
  shipsTo: string[];
  shippingDays: number;
  tags: string[];
  imageUrl?: string;
  paypalProductId?: string;
  status: "draft" | "published";
  materials?: string[];
  colors?: string[];
  /** Fields the extractor wasn't sure about; shown to the seller before publishing. */
  needsReview?: string[];
  sourceCaption?: string;
}

/** A question the seller has answered once; every future agent gets the answer. */
export interface SellerFact {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
}

export interface Question {
  id: string;
  sessionId: string;
  agent: string;
  productId?: string;
  text: string;
  status: "open" | "answered";
  factId?: string;
  createdAt: string;
}

export type AgentOutcome =
  | "searched"
  | "viewed"
  | "answered"
  | "unanswered"
  | "checkout_created"
  | "captured"
  | "error";

export interface AgentEvent {
  id: string;
  sessionId: string;
  agent: string;
  tool: string;
  outcome: AgentOutcome;
  productId?: string;
  detail?: string;
  at: string;
}

export interface Order {
  id: string;
  productId: string;
  quantity: number;
  amount: string;
  currency: string;
  sessionId: string;
  agent: string;
  customId: string;
  status: "awaiting_approval" | "captured" | "failed";
  approveUrl?: string;
  captureId?: string;
  paypalEventId?: string;
  createdAt: string;
  updatedAt: string;
}

/** In-memory store. Swapped for Postgres once hosting is set up; callers only see these methods. */
export class Store {
  seller: Seller;
  readonly products = new Map<string, Product>();
  readonly facts = new Map<string, SellerFact>();
  readonly questions = new Map<string, Question>();
  readonly orders = new Map<string, Order>();
  readonly events: AgentEvent[] = [];

  constructor(seller: Seller) {
    this.seller = seller;
  }

  publishedProducts(): Product[] {
    return [...this.products.values()].filter((p) => p.status === "published");
  }

  addProduct(product: Omit<Product, "id"> & { id?: string }): Product {
    const saved = { ...product, id: product.id ?? `p_${randomUUID().slice(0, 8)}` };
    this.products.set(saved.id, saved);
    return saved;
  }

  addFact(question: string, answer: string): SellerFact {
    const fact = { id: `f_${randomUUID().slice(0, 8)}`, question, answer, createdAt: now() };
    this.facts.set(fact.id, fact);
    return fact;
  }

  addQuestion(q: Omit<Question, "id" | "status" | "createdAt">): Question {
    const question: Question = { ...q, id: `q_${randomUUID().slice(0, 8)}`, status: "open", createdAt: now() };
    this.questions.set(question.id, question);
    return question;
  }

  /** The seller answers an open question once; it becomes a fact and similar open questions close. */
  answerQuestion(questionId: string, answer: string): SellerFact {
    const question = this.questions.get(questionId);
    if (!question) throw new Error(`No question ${questionId}`);
    const fact = this.addFact(question.text, answer);
    question.status = "answered";
    question.factId = fact.id;
    return fact;
  }

  logEvent(e: Omit<AgentEvent, "id" | "at">): AgentEvent {
    const event = { ...e, id: `e_${randomUUID().slice(0, 8)}`, at: now() };
    this.events.push(event);
    return event;
  }

  saveOrder(order: Order): Order {
    this.orders.set(order.id, order);
    return order;
  }
}

export function now(): string {
  return new Date().toISOString();
}

/** Demo seller for the golden path: Maya, hand-dyed batik scarves, diaspora buyers in the US and UK. */
export function seedDemoStore(): Store {
  const store = new Store({
    id: "s_maya",
    name: "Maya's Batik Corner",
    story: "Hand-dyed batik scarves made at home and sold through a photo feed and DMs.",
    country: "MY",
    shippingPolicy: "Ships worldwide from Malaysia. US and UK delivery in 6–9 business days with tracking.",
    returnsPolicy: "Returns accepted within 14 days of delivery if unworn; buyer pays return shipping.",
  });
  const base = { currency: "USD" as const, status: "published" as const, shipsTo: ["US", "GB", "CA", "AU", "MY", "SG"] };
  store.addProduct({
    ...base,
    id: "p_ocean",
    title: "Ocean Wave Batik Scarf",
    description: "Hand-dyed cotton batik scarf in deep blues with a wave motif. 180 x 50 cm.",
    price: "34.00",
    stock: 15,
    shippingDays: 7,
    tags: ["scarf", "blue", "cotton", "batik", "handmade", "gift"],
  });
  store.addProduct({
    ...base,
    id: "p_hibiscus",
    title: "Hibiscus Silk Batik Scarf",
    description: "Silk batik scarf with red hibiscus flowers, hand-painted wax resist. 170 x 45 cm.",
    price: "58.00",
    stock: 8,
    shippingDays: 7,
    tags: ["scarf", "red", "silk", "batik", "floral", "handmade", "gift"],
  });
  store.addProduct({
    ...base,
    id: "p_forest",
    title: "Forest Fern Batik Scarf",
    description: "Green and earth-tone cotton batik scarf with fern leaves. 180 x 50 cm.",
    price: "32.00",
    stock: 14,
    shippingDays: 7,
    tags: ["scarf", "green", "cotton", "batik", "handmade"],
  });
  store.addProduct({
    ...base,
    id: "p_sunset",
    title: "Sunset Gradient Batik Sarong",
    description: "Large orange-to-purple gradient batik sarong, doubles as a beach wrap. 200 x 110 cm.",
    price: "45.00",
    stock: 10,
    shippingDays: 8,
    tags: ["sarong", "wrap", "orange", "purple", "cotton", "batik", "beach"],
  });
  store.addProduct({
    ...base,
    id: "p_mini",
    title: "Mini Batik Bandana Set (3)",
    description: "Three small cotton batik bandanas in blue, green and red. 55 x 55 cm each.",
    price: "24.00",
    stock: 20,
    shippingDays: 7,
    tags: ["bandana", "set", "cotton", "batik", "gift", "multicolor"],
  });
  store.addProduct({
    ...base,
    id: "p_indigo",
    title: "Indigo Night Batik Scarf",
    description: "Natural indigo-dyed cotton batik scarf with a starry pattern. 180 x 50 cm.",
    price: "39.00",
    stock: 0,
    shippingDays: 7,
    tags: ["scarf", "blue", "indigo", "cotton", "batik", "natural dye"],
  });
  store.addFact("Can I wash the scarves?", "Hand wash cold with mild soap and dry in the shade; the dyes are colourfast after the first wash.");
  return store;
}
