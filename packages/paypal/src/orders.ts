import { randomUUID } from "node:crypto";
import type { PayPalClient } from "./client.js";

/** PayPal's published sandbox test card; orders paid with it complete without a buyer login. */
export const SANDBOX_TEST_CARD = {
  number: "4111111111111111",
  expiry: "2030-12",
  name: "Test Buyer",
  security_code: "123",
} as const;

const CUSTOM_ID_MAX = 127;

/**
 * Stamps which agent created an order onto PayPal's `custom_id`, e.g. `agent:shopping-assistant:s_123`.
 * PayPal caps custom_id at 127 characters.
 */
export function agentCustomId(clientName: string, sessionId: string): string {
  const slug =
    clientName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown";
  return `agent:${slug}:${sessionId}`.slice(0, CUSTOM_ID_MAX);
}

export interface CreateOrderInput {
  amount: string;
  currency?: string;
  description?: string;
  customId?: string;
  /** Route funds to a different sandbox business account. */
  payeeEmail?: string;
  /** Pay immediately with a card instead of returning an approval link. */
  card?: typeof SANDBOX_TEST_CARD;
  returnUrl?: string;
  cancelUrl?: string;
  requestId?: string;
}

export interface PayPalOrder {
  id: string;
  status: string;
  links?: { href: string; rel: string; method?: string }[];
  purchase_units?: {
    custom_id?: string;
    payee?: { email_address?: string; merchant_id?: string };
    payments?: { captures?: { id: string; status: string }[] };
  }[];
}

export function buildOrderBody(input: CreateOrderInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: { currency_code: input.currency ?? "USD", value: input.amount },
        ...(input.description && { description: input.description }),
        ...(input.customId && { custom_id: input.customId }),
        ...(input.payeeEmail && { payee: { email_address: input.payeeEmail } }),
      },
    ],
  };
  if (input.card) {
    body.payment_source = { card: input.card };
  } else if (input.returnUrl) {
    body.payment_source = {
      paypal: {
        experience_context: {
          return_url: input.returnUrl,
          cancel_url: input.cancelUrl ?? input.returnUrl,
          user_action: "PAY_NOW",
        },
      },
    };
  }
  return body;
}

export function createOrder(client: PayPalClient, input: CreateOrderInput): Promise<PayPalOrder> {
  return client.request<PayPalOrder>("POST", "/v2/checkout/orders", {
    body: buildOrderBody(input),
    headers: { "PayPal-Request-Id": input.requestId ?? randomUUID(), Prefer: "return=representation" },
  });
}

export function captureOrder(client: PayPalClient, orderId: string, requestId?: string): Promise<PayPalOrder> {
  return client.request<PayPalOrder>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    headers: { "PayPal-Request-Id": requestId ?? randomUUID(), Prefer: "return=representation" },
  });
}

export function getOrder(client: PayPalClient, orderId: string): Promise<PayPalOrder> {
  return client.request<PayPalOrder>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}

export function approveLink(order: PayPalOrder): string | undefined {
  return order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
}
