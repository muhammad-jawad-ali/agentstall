"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { DataGrid } from "@/components/data-grid";
import { useApp } from "@/components/providers";
import { CountUp, Empty, ErrorNote, Spinner } from "@/components/ui";
import {
  api,
  groupQuestions,
  isSimulated,
  postJson,
  type AgentEvent,
  type Batch,
  type Fact,
  type FunnelSide,
  type Order,
  type Product,
  type Question,
  type StallInfo,
} from "@/lib/api";

interface Data {
  stall: StallInfo;
  funnel: { real: FunnelSide; simulated: FunnelSide };
  questions: Question[];
  orders: Order[];
  events: AgentEvent[];
  batches: Batch[];
  facts: Fact[];
  products: Product[];
}

export default function StallPage() {
  const { mode, toast } = useApp();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [simulating, setSimulating] = useState(false);
  const [simError, setSimError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      const [stall, funnel, questions, orders, events, batches, facts, products] = await Promise.all([
        api<StallInfo>("/api/stall"),
        api<Data["funnel"]>("/api/funnel"),
        api<Question[]>("/api/questions"),
        api<Order[]>("/api/orders"),
        api<AgentEvent[]>("/api/events"),
        api<Batch[]>("/api/batches"),
        api<Fact[]>("/api/facts"),
        api<Product[]>("/api/products"),
      ]);
      setData({ stall, funnel, questions, orders, events, batches, facts, products });
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Payments are confirmed asynchronously by PayPal, so keep the page live.
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  const simulate = async () => {
    setSimulating(true);
    setSimError(null);
    try {
      const r = await postJson<{ outcomes: Record<string, number> }>("/api/simulate", { count: 20 });
      toast(`20 test shoppers visited: ${r.outcomes.purchased} bought`);
      await refresh();
    } catch (e) {
      setSimError(e);
    } finally {
      setSimulating(false);
    }
  };

  const reset = async () => {
    if (!window.confirm("Reset your demo stall to the starting products? Your orders, answers and test shoppers will be cleared.")) return;
    await postJson("/api/demo/reset", {});
    toast("Demo stall reset");
    await refresh();
  };

  if (error && !data) return <main className="page"><ErrorNote error={error} onRetry={refresh} /></main>;
  if (!data) return <StallSkeleton />;

  const captured = data.orders.filter((o) => o.status === "captured");
  const revenue = captured.reduce((sum, o) => sum + Number(o.amount), 0);
  const allSessions = data.funnel.real.sessions + data.funnel.simulated.sessions;
  const groups = groupQuestions(data.questions);
  const lostToQuestions = data.funnel.real.leftAfterUnansweredQuestion + data.funnel.simulated.leftAfterUnansweredQuestion;
  const productsById = new Map(data.products.map((p) => [p.id, p]));

  return (
    <main className="page">
      <div className="page-head row between">
        <div>
          <h1>{data.stall.seller.name}</h1>
          <p className="lead" style={{ margin: 0 }}>What AI shoppers did at your stall.</p>
        </div>
        <button type="button" className="btn ghost small" onClick={reset}>
          ↺ Reset demo
        </button>
      </div>

      <div className="grid-4 stagger">
        <Stat value={allSessions} label="AI shoppers visited" />
        <Stat value={captured.length} label="bought" />
        <Stat value={revenue} label="earned through PayPal" prefix="$" decimals={2} />
        <Stat value={groups.length} label={groups.length === 1 ? "question to answer" : "questions to answer"} tone={groups.length ? "warn" : undefined} />
      </div>

      <div className="grid-2" style={{ marginTop: "1rem" }}>
        <section className="card stack">
          <h2>Questions shoppers asked</h2>
          {lostToQuestions > 0 && groups.length > 0 && (
            <div className="notice warn small fade-up">
              <span aria-hidden="true">⚠️</span>
              <span>
                <b>{lostToQuestions}</b> shopper{lostToQuestions === 1 ? "" : "s"} left without buying because nobody answered their question.
              </span>
            </div>
          )}
          {groups.length === 0 ? (
            <Empty icon="💬" title="No unanswered questions">
              <span className="small">When an AI shopper asks something your stall can&apos;t answer, it shows up here.</span>
            </Empty>
          ) : (
            <div className="stack stagger">
              {groups.map((g) => (
                <AnswerCard key={g.text} group={g} onAnswered={refresh} />
              ))}
            </div>
          )}
          {data.facts.length > 0 && (
            <details className="small">
              <summary className="muted">What your stall already knows ({data.facts.length})</summary>
              <ul className="stack tight" style={{ paddingLeft: "1.1rem", marginTop: ".5rem" }}>
                {data.facts.map((f) => (
                  <li key={f.id}>
                    <b>{f.question}</b>
                    <br />
                    <span className="muted">{f.answer}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="card stack">
          <div className="row between">
            <h2 style={{ margin: 0 }}>How shoppers moved</h2>
            <button type="button" className="btn primary small" onClick={simulate} disabled={simulating}>
              {simulating ? <Spinner label="Shoppers browsing…" /> : "Send 20 test shoppers"}
            </button>
          </div>
          {simError ? <ErrorNote error={simError} onRetry={simulate} /> : null}
          {data.batches.length === 0 ? (
            <Empty icon="🛒" title="No test shoppers yet">
              <span className="small">Send 20 test shoppers to see what AI assistants ask, and where they give up.</span>
            </Empty>
          ) : (
            <BeforeAfter batches={data.batches} />
          )}
          <p className="tiny muted" style={{ margin: 0 }}>
            Test shoppers are simulated AI agents. They use the same public agent address and PayPal checkout as real ones, and
            are always labelled as test shoppers.
          </p>
        </section>
      </div>

      <section className="card stack" style={{ marginTop: "1rem" }}>
        <div className="row between">
          <h2 style={{ margin: 0 }}>Recent orders</h2>
          <span className="badge plain">{data.orders.length}</span>
        </div>
        {data.orders.length === 0 ? (
          <Empty icon="📦" title="No orders yet">
            <Link href="/shop" className="btn small">Try buying as a shopper</Link>
          </Empty>
        ) : mode === "behind" ? (
          <DataGrid<Order>
            rows={data.orders}
            height={300}
            columns={[
              { field: "id", headerName: "PayPal order" },
              { field: "status", headerName: "Status", maxWidth: 150 },
              { field: "amount", headerName: "Amount", maxWidth: 110, valueFormatter: (p) => `$${p.value}` },
              { field: "customId", headerName: "custom_id (agent attribution)", flex: 2 },
              { field: "captureId", headerName: "Capture" },
              { field: "paypalEventId", headerName: "Webhook event" },
            ]}
          />
        ) : (
          <div className="stack tight stagger">
            {data.orders.slice(0, 8).map((o) => {
              const p = productsById.get(o.productId);
              return (
                <div key={o.id} className="order-card">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {p?.imageUrl ? <img src={p.imageUrl} alt="" /> : <span style={{ fontSize: "1.8rem" }}>📦</span>}
                  <div className="stack tight" style={{ gap: 0 }}>
                    <strong className="small">{p?.title ?? "Product"}</strong>
                    <span className="tiny muted">
                      {isSimulated(o.agent) ? "Test shopper" : o.agent === "agentstall-buyer-console" ? "AgentStall shopping assistant" : o.agent}
                      {" · "}
                      {new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <div className="stack tight" style={{ gap: 0, justifyItems: "end" }}>
                    <b>${o.amount}</b>
                    <span className={`badge ${o.status === "captured" ? "good" : "warn"}`}>{o.status === "captured" ? "Paid" : "Waiting for buyer"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="card stack" style={{ marginTop: "1rem" }}>
        <h2 style={{ margin: 0 }}>Your stall&apos;s address for AI agents</h2>
        <p className="small muted" style={{ margin: 0 }}>Any MCP-capable AI assistant can shop here. Share this like you&apos;d share a shop link.</p>
        <code className="code">{typeof window !== "undefined" ? window.location.origin : ""}{data.stall.mcpPath}</code>
        {mode === "behind" && (
          <>
            <h3 style={{ marginTop: ".5rem" }}>Agent activity log</h3>
            <DataGrid<AgentEvent>
              rows={data.events}
              height={300}
              columns={[
                { field: "at", headerName: "Time", maxWidth: 120, valueFormatter: (p) => new Date(p.value).toLocaleTimeString() },
                { field: "agent", headerName: "Agent (MCP client)" },
                { field: "tool", headerName: "Tool", maxWidth: 170 },
                { field: "outcome", headerName: "Outcome", maxWidth: 160 },
                { field: "detail", headerName: "Detail", flex: 2 },
              ]}
            />
          </>
        )}
      </section>
    </main>
  );
}

function Stat({ value, label, prefix, decimals, tone }: { value: number; label: string; prefix?: string; decimals?: number; tone?: "warn" }) {
  return (
    <div className="card stat">
      <span className="value" style={tone ? { color: "var(--warn)" } : undefined}>
        <CountUp value={value} prefix={prefix} decimals={decimals} />
      </span>
      <span className="label">{label}</span>
    </div>
  );
}

function AnswerCard({ group, onAnswered }: { group: ReturnType<typeof groupQuestions>[number]; onAnswered: () => void }) {
  const { toast } = useApp();
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const teach = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<{ alsoAnswered: number }>(`/api/questions/${group.questions[0].id}/answer`, { answer });
      toast(r.alsoAnswered > 0 ? `Saved. ${r.alsoAnswered} more waiting question${r.alsoAnswered === 1 ? "" : "s"} answered too.` : "Saved. Future shoppers get this answer.");
      setAnswer("");
      onAnswered();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card question-card stack tight" style={{ boxShadow: "none" }}>
      <strong>“{group.text}”</strong>
      <span className="tiny muted">
        Asked {group.questions.length}×{group.wordings > 1 ? ` in ${group.wordings} different wordings` : ""}
      </span>
      <textarea
        aria-label={`Your answer to: ${group.text}`}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={2}
        placeholder="Write it once. Every future shopper gets your answer."
      />
      {error ? <ErrorNote error={error} onRetry={teach} /> : null}
      <div>
        <button type="button" className="btn primary small" disabled={busy || !answer.trim()} onClick={teach}>
          {busy ? <Spinner label="Saving…" /> : "Answer once for everyone"}
        </button>
      </div>
    </div>
  );
}

/** First batch vs latest batch, so the effect of answering shows at a glance. */
function BeforeAfter({ batches }: { batches: Batch[] }) {
  const before = batches[0];
  const after = batches.length > 1 ? batches[batches.length - 1] : undefined;
  const rate = (b: Batch) => (b.count ? b.purchased / b.count : 0);
  const lift = after && rate(before) > 0 ? Math.round(((rate(after) - rate(before)) / rate(before)) * 100) : undefined;
  const rows: [string, (b: Batch) => number][] = [
    ["Visited", (b) => b.count],
    ["Bought", (b) => b.purchased],
    ["Left: unanswered question", (b) => b.abandonedUnanswered],
  ];

  return (
    <div className="funnel">
      <div className="funnel-row funnel-head">
        <span />
        <span>{after ? "Grey = first visit · colour = latest" : "First batch"}</span>
        <span>First</span>
        <span>{after ? "Latest" : ""}</span>
      </div>
      {rows.map(([label, pick]) => (
        <div key={label} className="funnel-row">
          <span>{label}</span>
          <div className="bar" role="img" aria-label={`${label}: first ${pick(before)}${after ? `, latest ${pick(after)}` : ""}`}>
            <span className="before" style={{ width: `${(pick(before) / before.count) * 100}%` }} />
            {after && <span className="after" style={{ width: `${(pick(after) / after.count) * 100}%`, opacity: 0.9 }} />}
          </div>
          <span>{pick(before)}</span>
          <span>{after ? pick(after) : ""}</span>
        </div>
      ))}
      {after && (
        <p className="small" style={{ margin: 0 }}>
          {after.factsKnown > before.factsKnown ? (
            <>
              After you answered {after.factsKnown - before.factsKnown} question{after.factsKnown - before.factsKnown === 1 ? "" : "s"}, sales went from{" "}
              <b>{Math.round(rate(before) * 100)}%</b> to <b>{Math.round(rate(after) * 100)}%</b>
              {lift !== undefined && lift > 0 && <span className="lift"> ▲ +{lift}%</span>}
            </>
          ) : (
            <>Answer a question on the left, then send test shoppers again to see the difference.</>
          )}
        </p>
      )}
      <p className="tiny muted" style={{ margin: 0 }}>{batches.length} batch{batches.length === 1 ? "" : "es"} so far</p>
    </div>
  );
}

function StallSkeleton() {
  return (
    <main className="page">
      <div className="skeleton" style={{ height: 36, width: 280, marginBottom: "1rem" }} />
      <div className="grid-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton" style={{ height: 92 }} />
        ))}
      </div>
      <div className="grid-2" style={{ marginTop: "1rem" }}>
        <div className="skeleton" style={{ height: 260 }} />
        <div className="skeleton" style={{ height: 260 }} />
      </div>
    </main>
  );
}
