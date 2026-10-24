"use client";

import { useState } from "react";
import { postJson, type AgentStep } from "@/lib/api";

const PRESETS = [
  "Find me a hand-dyed blue scarf under $40 that can reach Austin, Texas within 10 days, and buy it.",
  "I want a colourful sarong as a gift, under $50, shipped to London. I only buy if I know whether I'll pay customs duties.",
  "Buy a silk scarf for my mum in Toronto. Ask how to wash it first.",
];

const TOOL_LABELS: Record<string, string> = {
  search_products: "Searched the stall",
  get_product: "Checked product details",
  ask_seller: "Asked the seller",
  create_checkout: "Created a PayPal checkout",
  get_order_status: "Checked PayPal order status",
};

export default function ConsolePage() {
  const [goal, setGoal] = useState(PRESETS[0]);
  const [method, setMethod] = useState<"sandbox_test_card" | "paypal">("sandbox_test_card");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ steps: AgentStep[]; summary: string; orderId?: string } | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await postJson("/api/console/run", { goal, payment_method: method }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const approveUrl = result?.steps
    .map((s) => (s.result as { approveUrl?: string } | null)?.approveUrl)
    .find(Boolean);

  return (
    <main className="page stack">
      <div>
        <h1>Buyer Agent Console</h1>
        <p className="lead">
          An AI shopping agent connects to this stall over MCP, exactly like an outside agent would. It can search, ask the
          seller and create a PayPal checkout. It can&apos;t move money by itself: the buyer approves in PayPal.
        </p>
      </div>

      <section className="card stack">
        <label>
          What should the agent buy?
          <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={3} />
        </label>
        <div className="row">
          {PRESETS.map((p, i) => (
            <button key={p} type="button" className="btn small" onClick={() => setGoal(p)}>
              Example {i + 1}
            </button>
          ))}
        </div>
        <div className="row" style={{ alignItems: "end" }}>
          <label style={{ width: "18rem" }}>
            Payment
            <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              <option value="sandbox_test_card">Sandbox test card (instant)</option>
              <option value="paypal">PayPal approval link</option>
            </select>
          </label>
          <button type="button" className="btn primary" disabled={busy || !goal.trim()} onClick={run}>
            {busy ? "Agent is shopping…" : "Run agent"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      {result && (
        <div className="grid-2">
          <section className="card">
            <h2>What the agent did</h2>
            <ol className="timeline">
              {result.steps.map((s, i) => (
                <li key={i}>
                  <strong>{TOOL_LABELS[s.tool] ?? s.tool}</strong> <code className="muted small">{s.tool}</code>
                  <pre>{JSON.stringify(s.args)}</pre>
                  <details>
                    <summary className="small muted">Result</summary>
                    <pre>{JSON.stringify(s.result, null, 2)}</pre>
                  </details>
                </li>
              ))}
            </ol>
          </section>
          <section className="card stack">
            <h2>Agent&apos;s summary</h2>
            <p style={{ whiteSpace: "pre-wrap" }}>{result.summary}</p>
            {result.orderId && <span className="badge good">PayPal order {result.orderId}</span>}
            {approveUrl && (
              <a className="btn primary" href={approveUrl} target="_blank" rel="noreferrer">
                Approve payment in PayPal
              </a>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
