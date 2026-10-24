"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api,
  isSimulated,
  postJson,
  type AgentEvent,
  type BatchResult,
  type FunnelSide,
  type Order,
  type Question,
} from "@/lib/api";
import { DataGrid } from "./data-grid";

const STAGES: [keyof FunnelSide["stages"], string][] = [
  ["searched", "Found the stall"],
  ["questioned", "Asked the seller"],
  ["checkout_created", "Started checkout"],
  ["captured", "Paid via PayPal"],
];

export default function DeskPage() {
  const [funnel, setFunnel] = useState<{ real: FunnelSide; simulated: FunnelSide } | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [batches, setBatches] = useState<BatchResult[]>([]);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [f, q, o, e] = await Promise.all([
        api<{ real: FunnelSide; simulated: FunnelSide }>("/api/funnel"),
        api<Question[]>("/api/questions"),
        api<Order[]>("/api/orders"),
        api<AgentEvent[]>("/api/events"),
      ]);
      setFunnel(f);
      setQuestions(q);
      setOrders(o);
      setEvents(e);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Webhook-driven captures land asynchronously; poll so they appear live.
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  const simulate = async () => {
    setSimulating(true);
    setError(null);
    try {
      const result = await postJson<BatchResult>("/api/simulate", { count: 20 });
      setBatches((b) => [...b, result]);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSimulating(false);
    }
  };

  const reset = async () => {
    await postJson("/api/demo/reset", {});
    setBatches([]);
    await refresh();
  };

  const captured = orders.filter((o) => o.status === "captured");
  const revenue = captured.reduce((sum, o) => sum + Number(o.amount), 0);
  const agentsSeen = new Set(events.map((e) => e.sessionId)).size;

  return (
    <main className="page stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Agent Desk</h1>
          <p className="lead">Maya&apos;s view of the AI agents shopping her stall: what they asked, where they left, and what they paid.</p>
        </div>
        <button type="button" className="btn small" onClick={reset}>
          Reset demo data
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="grid-3">
        <Stat label="Agent sessions" value={agentsSeen} />
        <Stat label="Paid orders (PayPal)" value={captured.length} />
        <Stat label="Agent revenue" value={`$${revenue.toFixed(2)}`} />
        <Stat label="Unanswered questions" value={questions.length} tone={questions.length ? "warn" : undefined} />
      </div>

      <div className="grid-2">
        <section className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Agent funnel</h2>
            <button type="button" className="btn small primary" onClick={simulate} disabled={simulating}>
              {simulating ? "Running 20 simulated agents…" : "Run 20 simulated agents"}
            </button>
          </div>
          {funnel && <Funnel title="Simulated agents" side={funnel.simulated} />}
          {funnel && funnel.real.sessions > 0 && <Funnel title="Real agents" side={funnel.real} />}
          {batches.length > 0 && (
            <div className="row small">
              {batches.map((b, i) => (
                <span key={i} className="badge indigo">
                  Batch {i + 1}: {Math.round(b.conversion * 100)}% bought
                </span>
              ))}
            </div>
          )}
          <p className="small muted" style={{ margin: 0 }}>
            Simulated agents are scripted shoppers using the same public MCP endpoint and PayPal checkout. They are always
            labelled as simulated.
          </p>
        </section>

        <section className="card stack">
          <h2>Unanswered questions</h2>
          {questions.length === 0 ? (
            <p className="muted">No open questions. Agents got answers to everything they asked.</p>
          ) : (
            <QuestionList questions={questions} onAnswered={refresh} />
          )}
        </section>
      </div>

      <section className="card stack">
        <h2>Orders</h2>
        <DataGrid<Order>
          rows={orders}
          height={280}
          columns={[
            { field: "id", headerName: "PayPal order" },
            { field: "status", headerName: "Status", maxWidth: 160 },
            { field: "amount", headerName: "Amount", maxWidth: 120, valueFormatter: (p) => `$${p.value}` },
            { field: "agent", headerName: "Agent", valueFormatter: (p) => (isSimulated(p.value) ? `${p.value} (simulated)` : p.value) },
            { field: "productId", headerName: "Product", maxWidth: 140 },
            { field: "captureId", headerName: "Capture" },
            { field: "createdAt", headerName: "Created", valueFormatter: (p) => new Date(p.value).toLocaleTimeString() },
          ]}
        />
      </section>

      <section className="card stack">
        <h2>Agent activity</h2>
        <DataGrid<AgentEvent>
          rows={events}
          height={320}
          columns={[
            { field: "at", headerName: "Time", maxWidth: 130, valueFormatter: (p) => new Date(p.value).toLocaleTimeString() },
            { field: "agent", headerName: "Agent" },
            { field: "tool", headerName: "Tool", maxWidth: 170 },
            { field: "outcome", headerName: "Outcome", maxWidth: 170 },
            { field: "detail", headerName: "Detail", flex: 2 },
          ]}
        />
      </section>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "warn" }) {
  return (
    <div className="card stat">
      <span className="value" style={tone ? { color: "var(--warn)" } : undefined}>
        {value}
      </span>
      <span className="label">{label}</span>
    </div>
  );
}

function Funnel({ title, side }: { title: string; side: FunnelSide }) {
  const top = Math.max(1, side.stages.searched);
  return (
    <div className="funnel">
      <strong className="small">
        {title} · {side.sessions} sessions · {side.leftAfterUnansweredQuestion} left after an unanswered question
      </strong>
      {STAGES.map(([key, label]) => (
        <div key={key} className="funnel-row">
          <span>{label}</span>
          <div className="bar" role="img" aria-label={`${label}: ${side.stages[key]}`}>
            <span style={{ width: `${(side.stages[key] / top) * 100}%` }} />
          </div>
          <span>{side.stages[key]}</span>
        </div>
      ))}
    </div>
  );
}

function QuestionList({ questions, onAnswered }: { questions: Question[]; onAnswered: () => void }) {
  // Group identical wording so the seller answers each question once.
  const groups = new Map<string, Question[]>();
  for (const q of questions) groups.set(q.text, [...(groups.get(q.text) ?? []), q]);

  return (
    <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {[...groups.entries()].map(([text, qs]) => (
        <QuestionItem key={text} text={text} questions={qs} onAnswered={onAnswered} />
      ))}
    </ul>
  );
}

function QuestionItem({ text, questions, onAnswered }: { text: string; questions: Question[]; onAnswered: () => void }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);

  const teach = async () => {
    setBusy(true);
    try {
      await postJson(`/api/questions/${questions[0].id}/answer`, { answer });
      setAnswer("");
      onAnswered();
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="stack" style={{ gap: ".4rem" }}>
      <div className="row">
        <strong>“{text}”</strong>
        <span className="badge warn">asked by {questions.length} agent{questions.length > 1 ? "s" : ""}</span>
      </div>
      <div className="row">
        <input
          aria-label={`Answer: ${text}`}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Answer once; every future agent gets it"
          style={{ flex: 1, minWidth: "12rem" }}
        />
        <button type="button" className="btn primary small" disabled={busy || !answer.trim()} onClick={teach}>
          Teach
        </button>
      </div>
    </li>
  );
}
