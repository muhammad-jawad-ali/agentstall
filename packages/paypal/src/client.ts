export const SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
}

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly debugId: string | undefined,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

/** Thin REST client: OAuth token caching, one retry on 401, PayPal debug ids on errors. */
export class PayPalClient {
  private token?: CachedToken;

  constructor(
    private readonly config: PayPalConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get baseUrl(): string {
    return this.config.baseUrl ?? SANDBOX_BASE_URL;
  }

  async getAccessToken(): Promise<string> {
    // Refresh a minute early; sandbox tokens live a few hours.
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;

    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const res = await this.fetchImpl(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const body = await readBody(res);
    if (!res.ok) throw toError("OAuth token request failed", res, body);

    const { access_token, expires_in } = body as { access_token: string; expires_in: number };
    this.token = { value: access_token, expiresAt: Date.now() + expires_in * 1000 };
    return access_token;
  }

  async request<T>(
    method: string,
    path: string,
    options: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.getAccessToken();
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      if (res.status === 401 && attempt === 0) {
        this.token = undefined;
        continue;
      }
      const body = await readBody(res);
      if (!res.ok) throw toError(`${method} ${path} failed`, res, body);
      return body as T;
    }
  }
}

export function clientFromEnv(env: NodeJS.ProcessEnv = process.env): PayPalClient {
  const clientId = env.PAYPAL_CLIENT_ID;
  const clientSecret = env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set (see .env.example)");
  }
  return new PayPalClient({ clientId, clientSecret, baseUrl: env.PAYPAL_BASE_URL || undefined });
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toError(prefix: string, res: Response, body: unknown): PayPalError {
  const debugId = res.headers.get("paypal-debug-id") ?? undefined;
  const detail =
    body && typeof body === "object"
      ? ((body as { message?: string; error_description?: string }).message ??
        (body as { error_description?: string }).error_description)
      : undefined;
  return new PayPalError(`${prefix} (${res.status})${detail ? `: ${detail}` : ""}`, res.status, debugId, body);
}
