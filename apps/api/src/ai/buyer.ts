import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ChatTurn, Llm } from "./llm.js";

type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface AgentStep {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
}

async function connect(mcpUrl: string, name: string, fetchImpl?: FetchLike) {
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), fetchImpl ? { fetch: fetchImpl } : undefined));
  const call = async (tool: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name: tool, arguments: args })) as { content: { text?: string }[]; isError?: boolean };
    const text = res.content[0]?.text ?? "";
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // error messages come back as plain text
    }
    return res.isError ? { error: parsed } : parsed;
  };
  return { client, call };
}

const BUYER_SYSTEM = `You are a shopping agent buying on behalf of a person. You shop through the store's tools.
- Search first, check details, and ask the seller about anything the shopper's request depends on (delivery dates, customs, materials).
- If you asked the seller something the shopper cares about and the status is "unknown", do NOT create a checkout. Stop and tell the shopper what is missing; the seller has been notified.
- When a product fits, create a checkout. Never claim a payment happened unless get_order_status says it was captured.
- Finish with a short summary for the shopper.`;

/**
 * The hosted Buyer Agent Console: a real MCP client driven by the LLM, so judges without
 * their own AI key can watch an agent shop and pay.
 */
export async function runBuyerAgent(opts: {
  llm: Llm;
  mcpUrl: string;
  goal: string;
  paymentMethod?: "paypal" | "sandbox_test_card";
  fetchImpl?: FetchLike;
  maxSteps?: number;
}): Promise<{ steps: AgentStep[]; summary: string; orderId?: string }> {
  const { client, call } = await connect(opts.mcpUrl, "agentstall-buyer-console", opts.fetchImpl);
  const steps: AgentStep[] = [];
  let orderId: string | undefined;
  try {
    const { tools } = await client.listTools();
    const declarations = tools.map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema as Record<string, unknown> }));
    const payment =
      opts.paymentMethod === "sandbox_test_card"
        ? "When you create a checkout, use payment_method 'sandbox_test_card'."
        : "When you create a checkout, use payment_method 'paypal' and give the shopper the approveUrl.";
    const history: ChatTurn[] = [{ role: "user", parts: [{ text: `${opts.goal}\n\n${payment}` }] }];

    for (let i = 0; i < (opts.maxSteps ?? 10); i++) {
      const { text, toolCalls, modelTurn } = await opts.llm.step({ system: BUYER_SYSTEM, history, tools: declarations });
      history.push(modelTurn);
      if (toolCalls.length === 0) return { steps, summary: text ?? "", orderId };

      const responses = [];
      for (const tc of toolCalls) {
        const result = await call(tc.name, tc.args);
        steps.push({ tool: tc.name, args: tc.args, result });
        const id = (result as { orderId?: string })?.orderId;
        if (tc.name === "create_checkout" && id) orderId = id;
        responses.push({ functionResponse: { name: tc.name, response: { result } } });
      }
      history.push({ role: "user", parts: responses });
    }
    return { steps, summary: "Stopped after the step limit.", orderId };
  } finally {
    await client.close();
  }
}

export interface Persona {
  name: string;
  query: string;
  maxPrice: number;
  shipTo: string;
  /** A question this shopper won't buy without an answer to. */
  question?: string;
}

const QUESTIONS = [
  "Will I have to pay customs duties or import tax?",
  "Do I pay customs duties on import?",
  "Are there import taxes or customs fees on delivery?",
];
const WANTS = [
  { query: "blue cotton scarf", maxPrice: 40 },
  { query: "silk scarf gift", maxPrice: 70 },
  { query: "batik bandana set", maxPrice: 30 },
  { query: "green scarf", maxPrice: 35 },
  { query: "beach sarong wrap", maxPrice: 50 },
];
const COUNTRIES = ["US", "GB", "CA", "AU"];

/** Deterministic set of shopper personas; about half need a customs answer before buying. */
export function personas(count: number): Persona[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `sim-persona-${String(i + 1).padStart(2, "0")}`,
    ...WANTS[i % WANTS.length],
    shipTo: COUNTRIES[i % COUNTRIES.length],
    question: i % 2 === 0 ? QUESTIONS[i % QUESTIONS.length] : undefined,
  }));
}

export type PersonaOutcome = "purchased" | "abandoned_unanswered" | "no_match" | "out_of_stock" | "error";

/**
 * Simulated buyer agents: scripted (no LLM on the buyer side) so a batch of 40 is fast and free,
 * but they shop through the same public MCP endpoint and pay through PayPal like any agent.
 */
export async function runPersona(p: Persona, mcpUrl: string, fetchImpl?: FetchLike): Promise<PersonaOutcome> {
  const { client, call } = await connect(mcpUrl, p.name, fetchImpl);
  try {
    const search = (await call("search_products", { query: p.query, max_price: p.maxPrice, ship_to: p.shipTo })) as {
      results?: { id: string; inStock: boolean }[];
    };
    const pick = search.results?.find((r) => r.inStock);
    if (!pick) return search.results?.length ? "out_of_stock" : "no_match";
    if (p.question) {
      const reply = (await call("ask_seller", { question: p.question })) as { status?: string };
      if (reply.status !== "answered") return "abandoned_unanswered";
    }
    const checkout = (await call("create_checkout", { product_id: pick.id, payment_method: "sandbox_test_card" })) as {
      orderId?: string;
      status?: string;
    };
    if (checkout.status === "out_of_stock") return "out_of_stock";
    return checkout.orderId ? "purchased" : "error";
  } catch (err) {
    console.warn(`${p.name} failed: ${(err as Error).message}`);
    return "error";
  } finally {
    await client.close();
  }
}

export async function runPersonaBatch(count: number, mcpUrl: string, fetchImpl?: FetchLike, concurrency = 2) {
  const queue = personas(count);
  const outcomes: Record<PersonaOutcome, number> = { purchased: 0, abandoned_unanswered: 0, no_match: 0, out_of_stock: 0, error: 0 };
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let p = queue.shift(); p; p = queue.shift()) outcomes[await runPersona(p, mcpUrl, fetchImpl)]++;
    }),
  );
  return { count, outcomes, conversion: count ? outcomes.purchased / count : 0 };
}
