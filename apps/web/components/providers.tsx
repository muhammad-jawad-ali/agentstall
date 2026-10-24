"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type Mode = "simple" | "behind";

interface AppState {
  mode: Mode;
  setMode: (m: Mode) => void;
  xrayOpen: boolean;
  setXrayOpen: (open: boolean) => void;
  toast: (message: string) => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp outside Providers");
  return ctx;
}

/** View mode (Simple / Behind the scenes, remembered per browser), the X-ray drawer, and toasts. */
export function Providers({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<Mode>("simple");
  const [xrayOpen, setXrayOpen] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);

  useEffect(() => {
    try {
      if (localStorage.getItem("as_mode") === "behind") setModeState("behind");
    } catch {
      // storage can be unavailable (private mode); the default is fine
    }
  }, []);

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    setXrayOpen(m === "behind");
    try {
      localStorage.setItem("as_mode", m);
    } catch {
      // ignore
    }
  }, []);

  const toast = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  const value = useMemo(() => ({ mode, setMode, xrayOpen, setXrayOpen, toast }), [mode, setMode, xrayOpen, toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
