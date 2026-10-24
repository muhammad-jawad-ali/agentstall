"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/providers";
import { ErrorNote, Json } from "@/components/ui";
import { ApiError, api, postStream, type AgentStep, type StallInfo } from "@/lib/api";

const EXAMPLES = [
  { label: "Blue scarf for my sister", goal: "A hand-dyed blue scarf under $40 for my sister in Austin, Texas. It needs to arrive within 10 days." },
  { label: "Gift, only if no customs", goal: "A colourful sarong as a gift, under $50, shipped to London. Only buy if you know whether I'll pay customs duties." },
  { label: "Silk scarf, ask about washing", goal: "A silk scarf for my mum in Toronto. Ask how to wash it before buying." },
];

interface ProductLite {
  id: string;
  title: string;
  price: string;
  imageUrl?: string;
  inStock?: boolean;
  estimatedShippingDays?: number;
  stock?: number;
}

type Message =
  | { kind: "user"; text: string }
  | { kind: "agent"; text: string; step?: AgentStep }
  | { kind: "seller"; text: string; step: AgentStep }
  | { kind: "checkout"; product?: ProductLite; amount: string; approveUrl?: string; orderId: string; paid: boolean; step: AgentStep }
  | { kind: "summary"; text: string };

/** Turns one agent tool call into plain-language chat messages. */
function narrate(step: AgentStep, seller: string, products: Map<string, ProductLite>): Message[] {
  const a = step.args as Record<string, string | number | undefined>;
  const r = (step.result ?? {}) as Record<string, unknown>;
  if (r.error) return [{ kind: "agent", text: "That step didn't work, so I'm trying another way.", step }];
  switch (step.tool) {
    case "search_products": {
      const results = (r.results as ProductLite[] | undefined) ?? [];
      results.forEach((p) => products.set(p.id, { ...products.get(p.id), ...p }));
      const lead = `Looking through ${seller} for “${a.query}”${a.max_price ? ` under $${a.max_price}` : ""}…`;
      const found = results.length
        ? `Found ${results.length} match${results.length > 1 ? "es" : ""}. ${results[0].title} ($${results[0].price}) looks closest.`
        : "Nothing matched. I'll try different words.";
      return [{ kind: "agent", text: `${lead} ${found}`, step }];
    }
    case "get_product": {
      const p = r as unknown as ProductLite;
      if (p.id) products.set(p.id, { ...products.get(p.id), ...p });
      return [{ kind: "agent", text: `Checking the details of ${p.title ?? "the item"}: ${p.inStock ? `${p.stock} in stock` : "out of stock"}, arrives in about ${p.estimatedShippingDays ?? "?"} days.`, step }];
    }
    case "ask_seller":
      return [
        { kind: "agent", text: `Asking the seller: “${a.question}”`, step },
        r.status === "answered"
          ? { kind: "seller", text: String(r.answer), step }
          : { kind: "seller", text: "The seller hasn't answered this yet. I've passed your question on to them.", step },
      ];
    case "create_checkout": {
      if (r.status === "out_of_stock") return [{ kind: "agent", text: "That one just sold out.", step }];
      const product = products.get(String(a.product_id));
      return [
        {
          kind: "checkout",
          product,
          amount: String(r.amount ?? product?.price ?? ""),
          approveUrl: r.approveUrl as string | undefined,
          orderId: String(r.orderId),
          paid: r.paypalStatus === "COMPLETED",
          step,
        },
      ];
    }
    case "get_order_status":
      return [{ kind: "agent", text: r.status === "captured" ? "PayPal confirmed the payment. ✓" : "Waiting for you to approve the payment in PayPal.", step }];
    default:
      return [{ kind: "agent", text: `Used ${step.tool}.`, step }];
  }
}

export default function ShopPage() {
  const { mode } = useApp();
  const [stall, setStall] = useState<StallInfo | null>(null);
  const [goal, setGoal] = useState("");
  const [payment, setPayment] = useState<"paypal" | "sandbox_test_card">("paypal");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const products = useRef(new Map<string, ProductLite>());
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<StallInfo>("/api/stall").then(setStall, () => setStall(null));
    api<ProductLite[]>("/api/products").then((list) => list.forEach((p) => products.current.set(p.id, p)), () => undefined);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, busy]);

  const run = async (text = goal) => {
    const wish = text.trim();
    if (!wish || busy) return;
    setBusy(true);
    setError(null);
    setGoal("");
    setMessages((m) => [...m, { kind: "user", text: wish }]);
    const seller = stall?.seller.name ?? "the stall";
    try {
      await postStream("/api/console/stream", { goal: wish, payment_method: payment }, (event, data) => {
        if (event === "step") setMessages((m) => [...m, ...narrate(data as AgentStep, seller, products.current)]);
        if (event === "done") {
          const { summary } = data as { summary: string };
          if (summary) setMessages((m) => [...m, { kind: "summary", text: summary }]);
        }
        if (event === "error") setError(new ApiError((data as { error: string }).error, 500));
      });
    } catch (e) {
      setError(e);
      if (!(e instanceof ApiError && e.status === 429)) setGoal(wish);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page narrow">
      <div className="page-head">
        <h1>Shop with an AI assistant</h1>
        <p className="lead">
          Say what you want in your own words. The assistant searches {stall ? <b>{stall.seller.name}</b> : "the stall"}, asks the seller
          questions, and only spends money after you approve in PayPal.
        </p>
      </div>

      <section className="card stack">
        {messages.length === 0 && (
          <div className="stack tight">
            <span className="small muted">Try one of these:</span>
            <div className="chips">
              {EXAMPLES.map((e) => (
                <button key={e.label} type="button" className="chip" onClick={() => run(e.goal)} disabled={busy}>
                  {e.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="chat" aria-live="polite">
          {messages.map((m, i) => (
            <ChatMessage key={i} m={m} technical={mode === "behind"} />
          ))}
          {busy && (
            <div className="bubble agent typing" aria-label="Assistant is working">
              <i />
              <i />
              <i />
            </div>
          )}
          <div ref={endRef} />
        </div>

        {error ? <ErrorNote error={error} onRetry={() => setError(null)} /> : null}

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <label className="sr-only" htmlFor="wish">
            What are you looking for?
          </label>
          <textarea
            id="wish"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                run();
              }
            }}
            rows={2}
            placeholder="e.g. A blue scarf under $40 for my sister in Austin"
            disabled={busy}
          />
          <button type="submit" className="btn primary" disabled={busy || !goal.trim()}>
            {busy ? "Shopping…" : "Send"}
          </button>
        </form>
        {mode === "behind" && (
          <label className="row small" style={{ fontWeight: 500 }}>
            Payment
            <select value={payment} onChange={(e) => setPayment(e.target.value as typeof payment)} style={{ width: "auto" }}>
              <option value="paypal">Buyer approves in PayPal (realistic)</option>
              <option value="sandbox_test_card">Sandbox test card (instant, for testing)</option>
            </select>
          </label>
        )}
      </section>
    </main>
  );
}

function ChatMessage({ m, technical }: { m: Message; technical: boolean }) {
  const tech = technical && "step" in m && m.step && (
    <details className="tech">
      <summary>
        MCP <code>{m.step.tool}</code>
      </summary>
      <div className="tiny">Arguments</div>
      <Json value={m.step.args} />
      <div className="tiny">Result</div>
      <Json value={m.step.result} />
    </details>
  );

  if (m.kind === "user") return <div className="bubble user">{m.text}</div>;
  if (m.kind === "seller")
    return (
      <div className="bubble seller">
        <span className="who">💬 Seller&apos;s stall</span>
        {m.text}
        {tech}
      </div>
    );
  if (m.kind === "summary")
    return (
      <div className="bubble agent">
        <span className="who">🤖 Assistant</span>
        <span style={{ whiteSpace: "pre-wrap" }}>
          {m.text
            .replace(/\*\*/g, "")
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1 (button above)")
            .replace(/^\s*[*-]\s+/gm, "• ")}
        </span>
      </div>
    );
  if (m.kind === "checkout")
    return (
      <div className="card product-card pop">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {m.product?.imageUrl ? <img src={m.product.imageUrl} alt="" /> : <div className="skeleton" style={{ width: 96, height: 96 }} />}
        <div className="stack tight">
          <strong>{m.product?.title ?? "Your item"}</strong>
          <span className="muted small">
            ${m.amount}
            {m.product?.estimatedShippingDays ? ` · arrives in about ${m.product.estimatedShippingDays} days` : ""}
          </span>
          {m.paid ? (
            <span className="badge good">✓ Paid with sandbox test card</span>
          ) : m.approveUrl ? (
            <div>
              <a className="btn primary" href={m.approveUrl}>
                Pay ${m.amount} with PayPal
              </a>
            </div>
          ) : null}
          <span className="tiny muted">The assistant can&apos;t pay by itself. You approve every payment.</span>
          {tech}
        </div>
      </div>
    );
  return (
    <div className="bubble agent">
      <span className="who">🤖 Assistant</span>
      {m.text}
      {tech}
    </div>
  );
}
