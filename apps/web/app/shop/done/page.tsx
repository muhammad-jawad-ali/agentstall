"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { Confetti } from "@/components/ui";
import { api, type Order } from "@/lib/api";

export default function DonePage() {
  return (
    <Suspense fallback={<main className="page narrow"><div className="skeleton" style={{ height: 240 }} /></main>}>
      <Done />
    </Suspense>
  );
}

function Done() {
  const [params, setParams] = useState<{ status: string; order?: string } | null>(null);
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setParams({ status: q.get("status") ?? "missing", order: q.get("order") ?? undefined });
  }, []);

  // PayPal confirms the capture asynchronously (webhook), so poll the order until it shows as paid.
  useEffect(() => {
    if (!params?.order) return;
    let stop = false;
    const load = () =>
      api<Order[]>("/api/orders").then((list) => {
        if (stop) return;
        const o = list.find((x) => x.id === params.order) ?? null;
        setOrder(o);
        if (!o || o.status !== "captured") setTimeout(load, 1500);
      }, () => undefined);
    load();
    return () => {
      stop = true;
    };
  }, [params?.order]);

  if (!params) return null;

  if (params.status === "cancelled" || params.status === "failed" || params.status === "missing") {
    const text = {
      cancelled: ["Payment cancelled", "No money was taken. You can go back and try again any time."],
      failed: ["Payment didn't go through", "PayPal couldn't complete this payment. No money was taken."],
      missing: ["We couldn't find that order", "The link may have expired. Start a new search."],
    }[params.status as "cancelled" | "failed" | "missing"];
    return (
      <main className="page narrow">
        <section className="card stack center fade-up" style={{ padding: "2rem" }}>
          <div style={{ fontSize: "2.5rem" }} aria-hidden="true">🛍️</div>
          <h1>{text[0]}</h1>
          <p className="muted">{text[1]}</p>
          <div>
            <Link href="/shop" className="btn primary">
              Back to shopping
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const confirmed = order?.status === "captured";
  return (
    <main className="page narrow">
      <section className="card stack center pop" style={{ position: "relative", overflow: "hidden", padding: "2rem" }}>
        {confirmed && <Confetti />}
        <div style={{ fontSize: "2.8rem" }} aria-hidden="true">{confirmed ? "✅" : "⏳"}</div>
        <h1>{confirmed ? "Payment complete" : "Confirming with PayPal…"}</h1>
        <p className="muted">
          {confirmed ? `You paid $${order?.amount}. The seller has been notified.` : "This usually takes a few seconds."}
        </p>
        <ol className="stack tight" style={{ listStyle: "none", padding: 0, margin: "0 auto", textAlign: "left", width: "fit-content" }}>
          <li>✓ Order created by your assistant</li>
          <li>✓ You approved in PayPal</li>
          <li className={confirmed ? "" : "pulse"}>{confirmed ? "✓" : "◌"} PayPal confirmed the payment</li>
          <li className="muted">○ Seller ships it</li>
        </ol>
        {order && <p className="tiny muted">Order {order.id}</p>}
        <div className="row" style={{ justifyContent: "center" }}>
          <Link href="/shop" className="btn primary">
            Keep shopping
          </Link>
          <Link href="/stall" className="btn">
            See it from the seller&apos;s side
          </Link>
        </div>
      </section>
    </main>
  );
}
