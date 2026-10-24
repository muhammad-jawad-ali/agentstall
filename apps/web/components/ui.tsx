"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";

/** Counts up to `value` when it changes. */
export function CountUp({ value, prefix = "", decimals = 0 }: { value: number; prefix?: string; decimals?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 700);
      setShown(a + (value - a) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <>
      {prefix}
      {shown.toFixed(decimals)}
    </>
  );
}

const COLORS = ["#b4532a", "#2f3f73", "#e0a43a", "#2f7a4f", "#c9466b"];

/** A short celebration burst. Hidden for people who prefer reduced motion (via CSS). */
export function Confetti() {
  const pieces = Array.from({ length: 28 }, (_, i) => i);
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((i) => (
        <i
          key={i}
          style={{
            left: `${(i * 37) % 100}%`,
            background: COLORS[i % COLORS.length],
            animationDelay: `${(i % 7) * 0.06}s`,
          }}
        />
      ))}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <span className="ico" aria-hidden="true">
        {icon}
      </span>
      <strong style={{ color: "var(--ink)" }}>{title}</strong>
      {children}
    </div>
  );
}

/**
 * Plain-language error with a retry button. Rate limits show a countdown and retry when it ends
 * (only if the visitor is still on the page).
 */
export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const retryAfter = error instanceof ApiError ? error.retryAfter : undefined;
  const [left, setLeft] = useState(retryAfter ?? 0);
  useEffect(() => {
    setLeft(retryAfter ?? 0);
    if (!retryAfter) return;
    const timer = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearInterval(timer);
  }, [retryAfter, error]);

  const message = error instanceof Error ? error.message : "Something went wrong. Please try again.";
  return (
    <div className="notice bad fade-up" role="alert">
      <span aria-hidden="true">⚠️</span>
      <div className="stack tight" style={{ flex: 1 }}>
        <span>{message}</span>
        {onRetry && (
          <div>
            <button type="button" className="btn small" onClick={onRetry} disabled={left > 0}>
              {left > 0 ? `Try again in ${left}s` : "Try again"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" style={{ gap: ".4rem" }}>
      <span className="spinner" aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  );
}

/** Pretty JSON for the technical view. */
export function Json({ value }: { value: unknown }) {
  return <pre className="code" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(value, null, 2)}</pre>;
}
