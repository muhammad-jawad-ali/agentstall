import type { PayPalClient } from "./client.js";

const SIGNATURE_HEADERS = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

export type HeaderGetter = (name: string) => string | undefined | null;

/**
 * Verifies a webhook delivery with PayPal's verify-webhook-signature API.
 * Only real deliveries verify; events from the dashboard simulator never will.
 */
export async function verifyWebhook(
  client: PayPalClient,
  webhookId: string,
  getHeader: HeaderGetter,
  event: unknown,
): Promise<boolean> {
  const headers: Record<string, string> = {};
  for (const [field, header] of Object.entries(SIGNATURE_HEADERS)) {
    const value = getHeader(header);
    if (!value) return false;
    headers[field] = value;
  }
  const res = await client.request<{ verification_status: string }>(
    "POST",
    "/v1/notifications/verify-webhook-signature",
    { body: { ...headers, webhook_id: webhookId, webhook_event: event } },
  );
  return res.verification_status === "SUCCESS";
}
