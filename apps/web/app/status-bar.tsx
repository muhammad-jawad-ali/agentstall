"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type Health } from "@/lib/api";

const LINKS = [
  { href: "/sell", label: "Seller onboarding" },
  { href: "/desk", label: "Agent Desk" },
  { href: "/console", label: "Buyer Agent Console" },
];

export function StatusBar() {
  const pathname = usePathname();
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    api<Health>("/health").then(setHealth, () => setHealth(null));
  }, []);

  return (
    <>
      {health?.paypal === "mock" && (
        <div className="mock-banner" role="status">
          MOCK PAYPAL: no sandbox credentials yet. Payments here are simulated, not PayPal.
        </div>
      )}
      <header className="topbar">
        <Link href="/" className="brand">
          Agent<span>Stall</span>
        </Link>
        <nav className="nav" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={pathname === l.href ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <span className="spacer" />
        {health && (
          <span className="row small">
            <span className={`badge ${health.paypal === "sandbox" ? "good" : "warn"}`}>PayPal {health.paypal}</span>
            <span className={`badge ${health.ai === "gemini" ? "indigo" : "bad"}`}>AI {health.ai}</span>
          </span>
        )}
      </header>
    </>
  );
}
