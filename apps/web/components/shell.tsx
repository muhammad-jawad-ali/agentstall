"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type Health } from "@/lib/api";
import { useApp } from "./providers";
import { XRay } from "./xray";

const LINKS = [
  { href: "/", label: "Home", ico: "🏠" },
  { href: "/sell", label: "Sell", ico: "🧺" },
  { href: "/shop", label: "Shop", ico: "🛍️" },
  { href: "/stall", label: "My Stall", ico: "📊" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { mode, setMode, xrayOpen, setXrayOpen } = useApp();
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let stop = false;
    const check = () =>
      api<Health>("/health").then(
        (h) => !stop && (setHealth(h), setOffline(false)),
        () => !stop && setOffline(true),
      );
    check();
    const timer = setInterval(check, 15000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  const current = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <>
      {offline && (
        <div className="banner bad" role="alert">
          Can&apos;t reach the AgentStall server. Retrying automatically…
        </div>
      )}
      {health?.paypal === "mock" && (
        <div className="banner warn">Demo mode: payments use a mock PayPal page, no real money moves.</div>
      )}
      <header className="topbar">
        <Link href="/" className="brand" aria-label="AgentStall home">
          🧺 Agent<span>Stall</span>
        </Link>
        <nav className="nav" aria-label="Main">
          {LINKS.slice(1).map((l) => (
            <Link key={l.href} href={l.href} aria-current={current(l.href) ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <span className="spacer" />
        <div className="mode-toggle" role="group" aria-label="View">
          <button type="button" aria-pressed={mode === "simple"} onClick={() => setMode("simple")}>
            Simple
          </button>
          <button type="button" aria-pressed={mode === "behind"} onClick={() => setMode("behind")}>
            ⚙ <span className="hide-sm">Behind the scenes</span>
            <span className="sr-only"> (shows every step the AI, MCP and PayPal take)</span>
          </button>
        </div>
      </header>

      {children}

      {mode === "behind" && !xrayOpen && (
        <button type="button" className="btn primary xray-fab" onClick={() => setXrayOpen(true)}>
          ⚙ Show steps
        </button>
      )}
      <XRay />

      <nav className="bottom-nav" aria-label="Main">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={current(l.href) ? "page" : undefined}>
            <span className="ico" aria-hidden="true">
              {l.ico}
            </span>
            {l.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
