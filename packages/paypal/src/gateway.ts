import { randomUUID } from "node:crypto";
import { PayPalClient } from "./client.js";
import {
  type CreateOrderInput,
  type PayPalOrder,
  SANDBOX_TEST_CARD,
  captureOrder,
  createOrder,
  getOrder,
} from "./orders.js";
import { type HeaderGetter, verifyWebhook } from "./webhooks.js";

export interface PayPalEvent {
  id: string;
  event_type: string;
  resource: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CatalogProductInput {
  name: string;
  description?: string;
  type?: "PHYSICAL" | "DIGITAL" | "SERVICE";
  category?: string;
  imageUrl?: string;
}

/**
 * Everything OpenStall needs from PayPal. The sandbox implementation talks to PayPal;
 * the mock stands in until sandbox credentials are available.
 */
export interface PayPalGateway {
  readonly mode: "sandbox" | "mock";
  createOrder(input: CreateOrderInput): Promise<PayPalOrder>;
  captureOrder(orderId: string): Promise<PayPalOrder>;
  getOrder(orderId: string): Promise<PayPalOrder>;
  createCatalogProduct(input: CatalogProductInput): Promise<{ id: string }>;
  verifyWebhook(getHeader: HeaderGetter, event: unknown): Promise<boolean>;
  /** Subscribe to capture events. Sandbox events arrive through the webhook route instead. */
  onEvent(listener: (event: PayPalEvent) => void | Promise<void>): void;
}

export class SandboxGateway implements PayPalGateway {
  readonly mode = "sandbox" as const;

  constructor(
    readonly client: PayPalClient,
    private readonly webhookId?: string,
  ) {}

  createOrder(input: CreateOrderInput) {
    return createOrder(this.client, input);
  }

  captureOrder(orderId: string) {
    return captureOrder(this.client, orderId);
  }

  getOrder(orderId: string) {
    return getOrder(this.client, orderId);
  }

  async createCatalogProduct(input: CatalogProductInput) {
    return this.client.request<{ id: string }>("POST", "/v1/catalogs/products", {
      body: {
        name: input.name.slice(0, 127),
        description: input.description?.slice(0, 256),
        type: input.type ?? "PHYSICAL",
        category: input.category,
        image_url: input.imageUrl,
      },
      headers: { "PayPal-Request-Id": randomUUID() },
    });
  }

  async verifyWebhook(getHeader: HeaderGetter, event: unknown) {
    if (!this.webhookId) return false;
    return verifyWebhook(this.client, this.webhookId, getHeader, event);
  }

  onEvent() {
    // Sandbox events are delivered to POST /webhooks/paypal.
  }
}

/** In-memory PayPal stand-in that mirrors Orders v2 response shapes and emits capture events. */
export class MockGateway implements PayPalGateway {
  readonly mode = "mock" as const;
  private readonly orders = new Map<string, PayPalOrder & { returnUrl?: string }>();
  private readonly listeners: ((event: PayPalEvent) => void | Promise<void>)[] = [];

  constructor(
    private readonly options: { publicUrl: string; eventDelayMs?: number } = { publicUrl: "http://localhost:8787" },
  ) {}

  async createOrder(input: CreateOrderInput): Promise<PayPalOrder> {
    const id = `MOCK${randomUUID().replace(/-/g, "").slice(0, 13).toUpperCase()}`;
    const unit = {
      reference_id: "default",
      amount: { currency_code: input.currency ?? "USD", value: input.amount },
      custom_id: input.customId,
      description: input.description,
      payee: input.payeeEmail ? { email_address: input.payeeEmail } : undefined,
    };
    const order: PayPalOrder & { returnUrl?: string } = {
      id,
      status: "PAYER_ACTION_REQUIRED",
      purchase_units: [unit],
      links: [
        { rel: "self", href: `${this.options.publicUrl}/mock-paypal/orders/${id}`, method: "GET" },
        { rel: "payer-action", href: `${this.options.publicUrl}/mock-paypal/approve/${id}`, method: "GET" },
      ],
      returnUrl: input.returnUrl,
    };
    this.orders.set(id, order);
    if (input.card) {
      if (input.card.number !== SANDBOX_TEST_CARD.number) {
        throw new Error("Mock gateway only accepts the sandbox test card");
      }
      return this.complete(order);
    }
    return strip(order);
  }

  /** What the buyer's "Approve" click does on the mock approval page. Returns the merchant return URL. */
  approve(orderId: string): string | undefined {
    const order = this.require(orderId);
    if (order.status === "PAYER_ACTION_REQUIRED") order.status = "APPROVED";
    return order.returnUrl ? `${order.returnUrl}${order.returnUrl.includes("?") ? "&" : "?"}token=${orderId}` : undefined;
  }

  async captureOrder(orderId: string): Promise<PayPalOrder> {
    const order = this.require(orderId);
    if (order.status === "COMPLETED") return strip(order);
    if (order.status !== "APPROVED") {
      throw new Error(`ORDER_NOT_APPROVED: mock order ${orderId} is ${order.status}`);
    }
    return this.complete(order);
  }

  async getOrder(orderId: string): Promise<PayPalOrder> {
    return strip(this.require(orderId));
  }

  async createCatalogProduct(): Promise<{ id: string }> {
    return { id: `PROD-MOCK${randomUUID().slice(0, 8).toUpperCase()}` };
  }

  async verifyWebhook(): Promise<boolean> {
    return false;
  }

  onEvent(listener: (event: PayPalEvent) => void | Promise<void>) {
    this.listeners.push(listener);
  }

  private complete(order: PayPalOrder & { returnUrl?: string }): PayPalOrder {
    const unit = order.purchase_units![0] as Record<string, any>;
    const capture = {
      id: `MOCKCAP${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`,
      status: "COMPLETED",
      amount: unit.amount,
      custom_id: unit.custom_id,
      supplementary_data: { related_ids: { order_id: order.id } },
    };
    order.status = "COMPLETED";
    unit.payments = { captures: [capture] };

    const event: PayPalEvent = {
      id: `WH-MOCK-${randomUUID()}`,
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      create_time: new Date().toISOString(),
      resource: capture,
    };
    // Mirror PayPal's asynchronous webhook delivery.
    setTimeout(() => {
      for (const listener of this.listeners) void listener(event);
    }, this.options.eventDelayMs ?? 1500);
    return strip(order);
  }

  private require(orderId: string) {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`RESOURCE_NOT_FOUND: no mock order ${orderId}`);
    return order;
  }
}

function strip(order: PayPalOrder & { returnUrl?: string }): PayPalOrder {
  const { returnUrl: _returnUrl, ...rest } = order;
  return structuredClone(rest);
}

export function gatewayFromEnv(env: NodeJS.ProcessEnv = process.env): PayPalGateway {
  const hasCredentials = Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
  const publicUrl = env.PUBLIC_URL ?? `http://localhost:${env.PORT ?? 8787}`;
  if (env.PAYPAL_MODE === "mock" || !hasCredentials) {
    return new MockGateway({ publicUrl });
  }
  const client = new PayPalClient({
    clientId: env.PAYPAL_CLIENT_ID!,
    clientSecret: env.PAYPAL_CLIENT_SECRET!,
    baseUrl: env.PAYPAL_BASE_URL || undefined,
  });
  return new SandboxGateway(client, env.PAYPAL_WEBHOOK_ID);
}
