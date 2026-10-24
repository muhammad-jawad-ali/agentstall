"use client";

import { useEffect, useRef, useState } from "react";
import { api, getLastRunId, onRun, type Trace } from "@/lib/api";
import { useApp } from "./providers";

const KIND_LABEL: Record<Trace["kind"], string> = {
  mcp: "MCP",
  paypal: "PayPal",
  ai: "AI",
  webhook: "Webhook",
  app: "App",
};

const HELP: Record<Trace["kind"], string> = {
  mcp: "A tool call from an AI shopping agent to this stall's public MCP endpoint.",
  paypal: "A call to PayPal's REST API (mock until sandbox credentials are connected).",
  ai: "A Gemini call. Its output is checked against a strict schema before it's used.",
  webhook: "A payment confirmation event from PayPal.",
  app: "A call to another service, such as Instagram.",
};

/** "Behind the scenes": every real step the system took, live, newest at the bottom. */
export function XRay() {
  const { xrayOpen, setXrayOpen } = useApp();
  const [traces, setTraces] = useState<Trace[]>([]);
  const [onlyLast, setOnlyLast] = useState(false);
  const [runId, setRunId] = useState<string | undefined>(getLastRunId());
  const [kinds, setKinds] = useState<Set<Trace["kind"]>>(new Set(["mcp", "paypal", "ai", "webhook", "app"]));
  const since = useRef(new Date(Date.now() - 5 * 60 * 1000).toISOString());
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => onRun(setRunId), []);

  useEffect(() => {
    if (!xrayOpen) return;
    let stop = false;
    const load = async () => {
      try {
        const next = await api<Trace[]>(`/api/traces?since=${encodeURIComponent(since.current)}`);
        if (!stop) setTraces(next);
      } catch {
        // keep the last list; the shell shows connection problems
      }
    };
    load();
    const timer = setInterval(load, 1500);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [xrayOpen]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [traces.length]);

  if (!xrayOpen) return null;

  const shown = traces.filter((t) => kinds.has(t.kind) && (!onlyLast || t.runId === runId));
  const first = shown[0] ? new Date(shown[0].at).getTime() : 0;
  const toggleKind = (k: Trace["kind"]) =>
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <aside className="xray" aria-label="Behind the scenes">
      <header>
        <strong>⚙ Behind the scenes</strong>
        <span className="badge plain">{shown.length} steps</span>
        <span className="spacer" />
        <button type="button" className="btn ghost small" onClick={() => setXrayOpen(false)} aria-label="Close behind the scenes">
          ✕
        </button>
      </header>
      <div className="filters">
        {(Object.keys(KIND_LABEL) as Trace["kind"][]).map((k) => (
          <button
            key={k}
            type="button"
            className={`kind ${k}`}
            style={{ border: 0, cursor: "pointer", opacity: kinds.has(k) ? 1 : 0.35 }}
            aria-pressed={kinds.has(k)}
            title={HELP[k]}
            onClick={() => toggleKind(k)}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
        <span className="spacer" />
        <label className="row tiny" style={{ fontWeight: 600, gap: ".3rem" }}>
          <input type="checkbox" checked={onlyLast} onChange={(e) => setOnlyLast(e.target.checked)} style={{ width: "auto" }} />
          Last action only
        </label>
      </div>
      <ol ref={listRef} aria-live="polite">
        {shown.length === 0 && (
          <li className="empty small">
            <span className="ico">🔍</span>
            Do something (draft a listing, send a shopper) and every step the system takes shows up here.
          </li>
        )}
        {shown.map((t) => (
          <li key={t.id} className={`trace ${t.status === "error" ? "error" : ""}`}>
            <details>
              <summary>
                <span className={`kind ${t.kind}`}>{KIND_LABEL[t.kind]}</span>
                <span>{t.label}</span>
                <span className="muted tiny">
                  +{((new Date(t.at).getTime() - first) / 1000).toFixed(1)}s · {t.ms}ms
                </span>
              </summary>
              <p className="tiny muted" style={{ margin: ".4rem 0 0" }}>
                {HELP[t.kind]}
              </p>
              {t.input !== undefined && (
                <>
                  <div className="tiny" style={{ fontWeight: 700, marginTop: ".4rem" }}>Input</div>
                  <pre>{JSON.stringify(t.input, null, 2)}</pre>
                </>
              )}
              {t.output !== undefined && (
                <>
                  <div className="tiny" style={{ fontWeight: 700, marginTop: ".4rem" }}>Output</div>
                  <pre>{JSON.stringify(t.output, null, 2)}</pre>
                </>
              )}
            </details>
          </li>
        ))}
      </ol>
    </aside>
  );
}
