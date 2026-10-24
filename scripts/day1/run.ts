/**
 * Day-1 sandbox verification. Run with `npm run day1` after filling in .env.
 * Each check is independent; a failure is reported and the rest still run.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import {
  PayPalError,
  SANDBOX_TEST_CARD,
  agentCustomId,
  approveLink,
  clientFromEnv,
  createOrder,
  type PayPalClient,
} from "@agentstall/paypal";

type Result = { status: "PASS" | "FAIL" | "SKIP" | "MANUAL"; detail: string };
type Check = { id: string; name: string; run: () => Promise<Result> };

const MCP_URL = process.env.PAYPAL_MCP_URL ?? "https://mcp.sandbox.paypal.com/http";

let paypal: PayPalClient;

const checks: Check[] = [
  {
    id: "2",
    name: "OAuth token from sandbox",
    run: async () => {
      const token = await paypal.getAccessToken();
      return { status: "PASS", detail: `token ${token.slice(0, 8)}… from ${paypal.baseUrl}` };
    },
  },
  {
    id: "3",
    name: "Direct-card order completes without login",
    run: async () => {
      const order = await createOrder(paypal, {
        amount: "12.00",
        description: "AgentStall day-1 check",
        customId: agentCustomId("day1-check", `s_${Date.now()}`),
        card: SANDBOX_TEST_CARD,
      });
      const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
      return order.status === "COMPLETED"
        ? { status: "PASS", detail: `order ${order.id}, capture ${capture?.id}` }
        : { status: "FAIL", detail: `order ${order.id} is ${order.status}` };
    },
  },
  {
    id: "4",
    name: "Approve-link order (buyer approves in browser)",
    run: async () => {
      const order = await createOrder(paypal, {
        amount: "9.00",
        description: "AgentStall approve-link check",
        returnUrl: "https://example.com/agentstall/return",
      });
      const link = approveLink(order);
      if (!link) return { status: "FAIL", detail: `order ${order.id} has no approval link` };
      return {
        status: "MANUAL",
        detail: `log in as your sandbox PERSONAL account at ${link} then run: npm run day1:capture -- ${order.id}`,
      };
    },
  },
  {
    id: "5",
    name: "Transaction search (list transactions)",
    run: async () => {
      const end = new Date();
      const start = new Date(end.getTime() - 30 * 24 * 3600 * 1000);
      const qs = new URLSearchParams({
        start_date: start.toISOString().replace(/\.\d{3}Z$/, "Z"),
        end_date: end.toISOString().replace(/\.\d{3}Z$/, "Z"),
        fields: "transaction_info",
        page_size: "10",
      });
      const res = await paypal.request<{ total_items?: number }>("GET", `/v1/reporting/transactions?${qs}`);
      return {
        status: "PASS",
        detail: `${res.total_items ?? 0} transactions (new ones can take hours to appear)`,
      };
    },
  },
  {
    id: "6",
    name: "Agent Toolkit create_product + list_products",
    run: async () => {
      const toolkit = new PayPalAgentToolkit({
        clientId: process.env.PAYPAL_CLIENT_ID!,
        clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
        configuration: { actions: { products: { create: true, list: true } }, context: { sandbox: true } },
      });
      const tools = toolkit.getTools();
      const names = Object.keys(tools);
      const opts = { toolCallId: "day1", messages: [] };
      const created = await tools.create_product.execute!(
        { name: "Day-1 batik scarf", type: "PHYSICAL", description: "AgentStall toolkit check" },
        opts,
      );
      const listed = await tools.list_products.execute!({ page: 1, page_size: 5 }, opts);
      return {
        status: "PASS",
        detail: `tools=[${names.join(", ")}] created=${brief(created)} listed=${brief(listed)}`,
      };
    },
  },
  {
    id: "7",
    name: "Remote PayPal MCP server: list tools (+ commerce flag)",
    run: async () => {
      const token = await paypal.getAccessToken();
      const base = await listMcpTools({ Authorization: `Bearer ${token}` });
      const commerce = await listMcpTools({ Authorization: `Bearer ${token}`, "x-feature-flags": "commerce:true" });
      const extra = commerce.filter((t) => !base.includes(t));
      return {
        status: "PASS",
        detail: `${base.length} tools; commerce flag adds [${extra.join(", ") || "none"}]`,
      };
    },
  },
  {
    id: "10",
    name: "Route payment to a second sandbox business account",
    run: async () => {
      const payeeEmail = process.env.PAYPAL_SECOND_MERCHANT_EMAIL;
      if (!payeeEmail) return { status: "SKIP", detail: "set PAYPAL_SECOND_MERCHANT_EMAIL to test" };
      const order = await createOrder(paypal, { amount: "7.00", payeeEmail, card: SANDBOX_TEST_CARD });
      const payee = order.purchase_units?.[0]?.payee?.email_address;
      return order.status === "COMPLETED" && payee === payeeEmail
        ? { status: "PASS", detail: `order ${order.id} paid to ${payee}` }
        : { status: "FAIL", detail: `order ${order.id} is ${order.status}, payee ${payee}` };
    },
  },
];

async function listMcpTools(headers: Record<string, string>): Promise<string[]> {
  const client = new Client({ name: "agentstall-day1", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), { requestInit: { headers } });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    return tools.map((t) => t.name);
  } finally {
    await client.close();
  }
}

function brief(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

function describeError(err: unknown): string {
  if (err instanceof PayPalError) return `${err.message}${err.debugId ? ` [debug id ${err.debugId}]` : ""}`;
  return err instanceof Error ? err.message : String(err);
}

async function main() {
  try {
    paypal = clientFromEnv();
  } catch (err) {
    console.error(describeError(err));
    process.exit(1);
  }

  const results: (Check & Result)[] = [];
  for (const check of checks) {
    process.stdout.write(`#${check.id} ${check.name} … `);
    let result: Result;
    try {
      result = await check.run();
    } catch (err) {
      result = { status: "FAIL", detail: describeError(err) };
    }
    console.log(result.status);
    results.push({ ...check, ...result });
  }

  console.log("\nDay-1 results");
  for (const r of results) console.log(`  #${r.id.padEnd(3)} ${r.status.padEnd(6)} ${r.name}\n        ${r.detail}`);
  process.exit(results.some((r) => r.status === "FAIL") ? 1 : 0);
}

main();
