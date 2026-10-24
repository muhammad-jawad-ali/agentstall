import { describe, expect, it, vi } from "vitest";
import {
  PayPalClient,
  PayPalError,
  SANDBOX_TEST_CARD,
  agentCustomId,
  approveLink,
  buildOrderBody,
  verifyWebhook,
} from "../src/index.js";

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("agentCustomId", () => {
  it("slugs the client name", () => {
    expect(agentCustomId("Shopping Assistant", "s_1")).toBe("agent:shopping-assistant:s_1");
  });

  it("never exceeds PayPal's 127-char limit", () => {
    expect(agentCustomId("x".repeat(200), "s").length).toBe(127);
  });

  it("falls back when the name has no usable characters", () => {
    expect(agentCustomId("!!!", "s")).toBe("agent:unknown:s");
  });
});

describe("buildOrderBody", () => {
  it("attaches the card for direct-card orders", () => {
    const body = buildOrderBody({ amount: "10.00", card: SANDBOX_TEST_CARD, customId: "agent:a:b" });
    expect(body).toMatchObject({
      intent: "CAPTURE",
      purchase_units: [{ amount: { currency_code: "USD", value: "10.00" }, custom_id: "agent:a:b" }],
      payment_source: { card: { number: SANDBOX_TEST_CARD.number } },
    });
  });

  it("uses a PayPal experience context when a return URL is given", () => {
    const body = buildOrderBody({ amount: "5.00", returnUrl: "https://example.com/done" });
    expect(body.payment_source).toMatchObject({ paypal: { experience_context: { return_url: "https://example.com/done" } } });
  });

  it("routes to a payee when given", () => {
    const body = buildOrderBody({ amount: "5.00", payeeEmail: "seller@example.com" });
    expect((body.purchase_units as any[])[0].payee).toEqual({ email_address: "seller@example.com" });
  });
});

describe("approveLink", () => {
  it("prefers payer-action or approve links", () => {
    expect(approveLink({ id: "1", status: "CREATED", links: [{ rel: "self", href: "a" }, { rel: "payer-action", href: "b" }] })).toBe("b");
  });
});

describe("PayPalClient", () => {
  const config = { clientId: "id", clientSecret: "secret" };

  it("caches the token and retries once on 401", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(200, { access_token: "t1", expires_in: 3600 }))
      .mockResolvedValueOnce(json(401, {}))
      .mockResolvedValueOnce(json(200, { access_token: "t2", expires_in: 3600 }))
      .mockResolvedValueOnce(json(200, { id: "ORDER" }));
    const client = new PayPalClient(config, fetchImpl);

    await expect(client.request("GET", "/v2/checkout/orders/ORDER")).resolves.toEqual({ id: "ORDER" });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl.mock.calls[3][1].headers.Authorization).toBe("Bearer t2");
  });

  it("surfaces the PayPal debug id on errors", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(200, { access_token: "t", expires_in: 3600 }))
      .mockResolvedValueOnce(json(422, { message: "Unprocessable" }, { "paypal-debug-id": "dbg123" }));
    const client = new PayPalClient(config, fetchImpl);

    const err = (await client.request("POST", "/v2/checkout/orders").catch((e: unknown) => e)) as PayPalError;
    expect(err).toBeInstanceOf(PayPalError);
    expect(err.debugId).toBe("dbg123");
    expect(err.message).toContain("Unprocessable");
  });
});

describe("verifyWebhook", () => {
  const headers: Record<string, string> = {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/cert",
    "paypal-transmission-id": "tid",
    "paypal-transmission-sig": "sig",
    "paypal-transmission-time": "2026-10-24T00:00:00Z",
  };

  it("returns false without calling PayPal when headers are missing", async () => {
    const fetchImpl = vi.fn();
    const client = new PayPalClient({ clientId: "id", clientSecret: "s" }, fetchImpl);
    await expect(verifyWebhook(client, "WH", () => undefined, {})).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns true when PayPal reports SUCCESS", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(200, { access_token: "t", expires_in: 3600 }))
      .mockResolvedValueOnce(json(200, { verification_status: "SUCCESS" }));
    const client = new PayPalClient({ clientId: "id", clientSecret: "s" }, fetchImpl);
    await expect(verifyWebhook(client, "WH", (h) => headers[h], { id: "evt" })).resolves.toBe(true);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toMatchObject({ webhook_id: "WH", transmission_id: "tid" });
  });
});
