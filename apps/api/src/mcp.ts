import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AgentContext, Commerce } from "./commerce.js";

/** One MCP session per connected buyer agent; its clientInfo is how orders get attributed. */
interface Session {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
}

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function buildServer(commerce: Commerce, sessionId: () => string): McpServer {
  const server = new McpServer({ name: "agentstall", version: "0.1.0" });
  const ctx = (): AgentContext => ({
    sessionId: sessionId(),
    agent: server.server.getClientVersion()?.name ?? "unknown-agent",
  });
  const seller = commerce.store.seller;

  server.registerTool(
    "search_products",
    {
      title: "Search products",
      description: `Search ${seller.name}'s products. ${seller.story}`,
      inputSchema: {
        query: z.string().describe("What the shopper wants, e.g. 'blue cotton scarf'"),
        max_price: z.number().positive().optional().describe("Maximum price in USD"),
        ship_to: z.string().length(2).optional().describe("Destination country, ISO 3166-1 alpha-2, e.g. US"),
        limit: z.number().int().min(1).max(20).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, max_price, ship_to, limit }) =>
      json(commerce.search(ctx(), { query, maxPrice: max_price, shipTo: ship_to, limit })),
  );

  server.registerTool(
    "get_product",
    {
      title: "Get product details",
      description: "Full details for one product, including shipping and returns policies.",
      inputSchema: { product_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ product_id }) => json(commerce.getProduct(ctx(), product_id)),
  );

  server.registerTool(
    "ask_seller",
    {
      title: "Ask the seller",
      description:
        "Ask the seller a question (customs, sizing, materials, delivery dates...). Answers come only from what the seller has confirmed. If the status is 'unknown', the seller has not answered yet: do not guess.",
      inputSchema: { question: z.string().min(3).max(500), product_id: z.string().optional() },
    },
    async ({ question, product_id }) => json(await commerce.askSeller(ctx(), question, product_id)),
  );

  server.registerTool(
    "create_checkout",
    {
      title: "Create a PayPal checkout",
      description:
        "Create a PayPal order for a product. Returns an approveUrl where the buyer approves the payment in PayPal. The buyer must approve; this tool never charges anyone by itself.",
      inputSchema: {
        product_id: z.string(),
        quantity: z.number().int().min(1).max(10).optional(),
        payment_method: z
          .enum(["paypal", "sandbox_test_card"])
          .optional()
          .describe("'paypal' (default) returns an approval link. 'sandbox_test_card' pays instantly with PayPal's sandbox test card, for demos."),
      },
    },
    async ({ product_id, quantity, payment_method }) =>
      json(await commerce.createCheckout(ctx(), { productId: product_id, quantity, paymentMethod: payment_method })),
  );

  server.registerTool(
    "get_order_status",
    {
      title: "Get order status",
      description: "Check whether a checkout has been approved and captured by PayPal.",
      inputSchema: { order_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ order_id }) => json(await commerce.orderStatus(order_id)),
  );

  return server;
}

/** Handles POST/GET/DELETE on the public /mcp endpoint (MCP streamable HTTP). */
export function createMcpHandler(commerce: Commerce) {
  const sessions = new Map<string, Session>();

  return async (req: Request): Promise<Response> => {
    const sessionId = req.headers.get("mcp-session-id");
    const existing = sessionId ? sessions.get(sessionId) : undefined;
    if (existing) return existing.transport.handleRequest(req);

    if (req.method !== "POST") {
      return Response.json(
        { jsonrpc: "2.0", error: { code: -32000, message: "Unknown or missing MCP session" }, id: null },
        { status: sessionId ? 404 : 400 },
      );
    }

    const body = await req.json();
    if (!isInitializeRequest(body)) {
      return Response.json(
        { jsonrpc: "2.0", error: { code: -32000, message: "Send an initialize request first" }, id: null },
        { status: 400 },
      );
    }

    let id = "";
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => `s_${randomUUID()}`,
      enableJsonResponse: true,
      onsessioninitialized: (newId) => {
        id = newId;
        sessions.set(newId, { transport, server });
      },
    });
    transport.onclose = () => {
      if (id) sessions.delete(id);
    };
    const server = buildServer(commerce, () => id);
    await server.connect(transport);
    return transport.handleRequest(req, { parsedBody: body });
  };
}
