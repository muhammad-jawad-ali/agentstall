"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/providers";
import { Confetti, Empty, ErrorNote, Json, Spinner } from "@/components/ui";
import { api, postJson, suggestUsd, type InstagramPost, type ListingDraft, type Product, type StallInfo } from "@/lib/api";

type Step = 0 | 1 | 2 | 3;
type Source = "instagram" | "paste" | "upload";

interface DemoPhoto {
  file: string;
  caption: string;
  url: string;
}

/** One post on its way to becoming a listing. */
interface Item {
  key: string;
  label: string;
  thumb?: string;
  status: "waiting" | "reading" | "done" | "error";
  run: () => Promise<{ product: Product; draft: ListingDraft }>;
  product?: Product;
  draft?: ListingDraft;
  error?: unknown;
  ms?: number;
}

const STEPS = ["Bring posts", "AI reads them", "Check", "Go live"];

export default function SellPage() {
  const [step, setStep] = useState<Step>(0);
  const [items, setItems] = useState<Item[]>([]);

  const update = (key: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  // Reads posts one at a time: friendlier to the free AI quota, and the checklist fills in visibly.
  const readAll = async (queue: Item[]) => {
    setItems(queue);
    setStep(1);
    for (const item of queue) {
      update(item.key, { status: "reading" });
      const started = performance.now();
      try {
        const { product, draft } = await item.run();
        update(item.key, { status: "done", product, draft, ms: performance.now() - started });
      } catch (error) {
        update(item.key, { status: "error", error });
      }
    }
  };

  const retry = async (item: Item) => {
    update(item.key, { status: "reading", error: undefined });
    try {
      const { product, draft } = await item.run();
      update(item.key, { status: "done", product, draft });
    } catch (error) {
      update(item.key, { status: "error", error });
    }
  };

  const published = items.filter((i) => i.product?.status === "published").length;

  return (
    <main className="page narrow">
      <div className="page-head">
        <h1>Open your stall</h1>
        <p className="lead">Turn the posts you already make into a shop AI assistants can buy from. About two minutes.</p>
      </div>

      <ol className="stepper" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} data-state={i < step ? "done" : i === step ? "current" : "todo"} aria-current={i === step ? "step" : undefined}>
            <span>
              {i + 1}. {label}
            </span>
          </li>
        ))}
      </ol>

      {step === 0 && <BringPosts onStart={readAll} />}
      {step === 1 && <Reading items={items} onRetry={retry} onNext={() => setStep(2)} onBack={() => setStep(0)} />}
      {step === 2 && (
        <Review
          items={items}
          onChange={(key, product) => update(key, { product })}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
          published={published}
        />
      )}
      {step === 3 && <GoLive count={published} onMore={() => { setItems([]); setStep(0); }} />}
    </main>
  );
}

// ---------------------------------------------------------------- Step 1

function BringPosts({ onStart }: { onStart: (queue: Item[]) => void }) {
  const { toast } = useApp();
  const [source, setSource] = useState<Source>("instagram");

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("instagram");
    if (status === "connected") toast("Instagram connected");
    if (status === "failed") toast("Instagram connection didn't finish. Please try again.");
    if (status) window.history.replaceState(null, "", "/sell");
  }, [toast]);

  return (
    <section className="stack fade-up">
      <div className="source-tabs" role="group" aria-label="Where are your posts?">
        <button type="button" className="source-tab" aria-pressed={source === "instagram"} onClick={() => setSource("instagram")}>
          <b>📷 Instagram</b>
          <span className="muted small">Import your recent posts</span>
        </button>
        <button type="button" className="source-tab" aria-pressed={source === "paste"} onClick={() => setSource("paste")}>
          <b>📝 Paste a post</b>
          <span className="muted small">From WhatsApp, Facebook, anywhere</span>
        </button>
        <button type="button" className="source-tab" aria-pressed={source === "upload"} onClick={() => setSource("upload")}>
          <b>⬆️ Upload photos</b>
          <span className="muted small">Straight from your phone</span>
        </button>
      </div>
      {source === "instagram" && <InstagramSource onStart={onStart} />}
      {source === "paste" && <PasteSource onStart={onStart} />}
      {source === "upload" && <UploadSource onStart={onStart} />}
    </section>
  );
}

function InstagramSource({ onStart }: { onStart: (queue: Item[]) => void }) {
  const [status, setStatus] = useState<{ available: "live" | "demo"; connected: boolean; mode?: string; username?: string } | null>(null);
  const [posts, setPosts] = useState<InstagramPost[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<unknown>(null);

  const load = async () => {
    setError(null);
    try {
      const s = await api<typeof status & object>("/api/instagram/status");
      setStatus(s);
      if (s.connected) {
        const list = await api<InstagramPost[]>("/api/instagram/media");
        setPosts(list);
        setPicked(new Set(list.filter((p) => !p.imported).slice(0, 4).map((p) => p.id)));
      }
    } catch (e) {
      setError(e);
    }
  };
  useEffect(() => {
    load();
  }, []);

  if (error) return <ErrorNote error={error} onRetry={load} />;
  if (!status) return <div className="skeleton" style={{ height: 180 }} />;

  if (!status.connected) {
    return (
      <div className="card stack center fade-up">
        <Empty icon="📷" title="Connect your Instagram">
          <p className="small" style={{ maxWidth: "26rem" }}>
            You&apos;ll log in on Instagram&apos;s own page and allow AgentStall to <b>read</b> your posts. We never post for you.
            Works with free Business or Creator accounts.
          </p>
          <a className="btn primary" href="/api/instagram/connect">
            Connect Instagram
          </a>
          {status.available === "demo" && (
            <span className="badge warn">Demo: connects a sample seller account, not a real one</span>
          )}
        </Empty>
      </div>
    );
  }

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const start = () => {
    const chosen = (posts ?? []).filter((p) => picked.has(p.id));
    onStart(
      chosen.map((p) => ({
        key: p.id,
        label: (p.caption ?? "Post").slice(0, 60),
        thumb: p.media_url,
        status: "waiting",
        run: () => postJson("/api/instagram/import", { mediaId: p.id }),
      })),
    );
  };

  return (
    <div className="card stack fade-up">
      <div className="row between">
        <div className="row">
          <strong>@{status.username}</strong>
          {status.mode === "demo" && <span className="badge warn">Demo account</span>}
        </div>
        <button type="button" className="btn ghost small" onClick={() => setPicked(new Set((posts ?? []).map((p) => p.id)))}>
          Select all
        </button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Tap the posts that are things you sell.</p>
      {posts === null ? (
        <div className="posts">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton" style={{ aspectRatio: 1 }} />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <Empty icon="🖼️" title="No photo posts found">Post a product photo on Instagram, then refresh.</Empty>
      ) : (
        <div className="posts stagger">
          {posts.map((p) => (
            <button key={p.id} type="button" className="post" aria-pressed={picked.has(p.id)} onClick={() => toggle(p.id)} aria-label={`Post: ${p.caption?.slice(0, 80) ?? "photo"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.media_url} alt="" loading="lazy" />
              <span className="tick" aria-hidden="true">✓</span>
              {p.imported && <span className="badge good done-tag">In your stall</span>}
            </button>
          ))}
        </div>
      )}
      <div className="row between">
        <span className="small muted">{picked.size} selected</span>
        <button type="button" className="btn primary" disabled={picked.size === 0} onClick={start}>
          Turn into listings →
        </button>
      </div>
    </div>
  );
}

function PasteSource({ onStart }: { onStart: (queue: Item[]) => void }) {
  const [photos, setPhotos] = useState<DemoPhoto[]>([]);
  const [selected, setSelected] = useState<DemoPhoto | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");

  useEffect(() => {
    api<DemoPhoto[]>("/api/demo/photos").then(setPhotos, () => setPhotos([]));
  }, []);

  const start = () => {
    const cap = caption;
    const demo = selected;
    const upload = file;
    onStart([
      {
        key: `paste-${Date.now()}`,
        label: cap.slice(0, 60) || upload?.name || "Your post",
        thumb: upload ? URL.createObjectURL(upload) : demo?.url,
        status: "waiting",
        run: async () => {
          const form = new FormData();
          form.set("caption", cap);
          if (upload) form.set("image", upload);
          else if (demo) form.set("image", new File([await (await fetch(demo.url)).blob()], demo.file, { type: "image/jpeg" }));
          return api("/api/listings/extract", { method: "POST", body: form });
        },
      },
    ]);
  };

  return (
    <div className="card stack fade-up">
      <label>
        Your post, exactly as you&apos;d write it
        <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} placeholder="Selendang batik lukis tangan, kain kapas 180x50cm. RM120, pos seluruh dunia 🌸" />
      </label>
      <span className="small muted">Any language and any currency. The AI translates and flags anything to check.</span>
      <div className="stack tight">
        <strong className="small">Add a photo (optional)</strong>
        {photos.length > 0 && (
          <div className="posts" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))" }}>
            {photos.map((p) => (
              <button
                key={p.file}
                type="button"
                className="post"
                aria-pressed={selected?.file === p.file}
                aria-label={`Sample photo ${p.file}`}
                onClick={() => {
                  setSelected(selected?.file === p.file ? null : p);
                  setFile(null);
                  if (!caption) setCaption(p.caption);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" loading="lazy" />
                <span className="tick" aria-hidden="true">✓</span>
              </button>
            ))}
          </div>
        )}
        <input type="file" accept="image/*" aria-label="Upload a photo" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setSelected(null); }} />
      </div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn primary" disabled={!caption.trim() && !file && !selected} onClick={start}>
          Turn into a listing →
        </button>
      </div>
    </div>
  );
}

function UploadSource({ onStart }: { onStart: (queue: Item[]) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const tooBig = files.filter((f) => f.size > 5 * 1024 * 1024);

  const start = () =>
    onStart(
      files.map((f, i) => ({
        key: `upload-${i}-${f.name}`,
        label: f.name,
        thumb: URL.createObjectURL(f),
        status: "waiting",
        run: () => {
          const form = new FormData();
          form.set("image", f);
          form.set("caption", "");
          return api("/api/listings/extract", { method: "POST", body: form });
        },
      })),
    );

  return (
    <div className="card stack fade-up">
      <label>
        Choose product photos
        <input type="file" accept="image/*" multiple onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 8))} />
      </label>
      <span className="small muted">Up to 8 photos, 5 MB each. The AI writes the title and description from the photo.</span>
      {tooBig.length > 0 && <span className="field-error">{tooBig.map((f) => f.name).join(", ")} is over 5 MB.</span>}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn primary" disabled={files.length === 0 || tooBig.length > 0} onClick={start}>
          Turn into listings →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Step 2

function Reading({ items, onRetry, onNext, onBack }: { items: Item[]; onRetry: (i: Item) => void; onNext: () => void; onBack: () => void }) {
  const { mode } = useApp();
  const finished = items.every((i) => i.status === "done" || i.status === "error");
  const done = items.filter((i) => i.status === "done").length;

  return (
    <section className="card stack fade-up">
      <div className="row between">
        <h2 style={{ margin: 0 }}>{finished ? "All read" : "Reading your posts…"}</h2>
        <span className="badge plain">
          {done}/{items.length}
        </span>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        The AI looks at each photo and caption, writes an English listing, and a strict checker verifies every field.
      </p>
      <ul className="checklist">
        {items.map((i) => (
          <li key={i.key}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {i.thumb ? <img src={i.thumb} alt="" /> : <span aria-hidden="true">📝</span>}
            <div className="stack tight" style={{ gap: ".1rem", minWidth: 0 }}>
              <strong className="small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {i.product?.title ?? i.label}
              </strong>
              {i.draft && (
                <span className="tiny muted">
                  {i.draft.caption_language}
                  {i.draft.price_in_caption ? ` · ${i.draft.price_in_caption}` : ""}
                  {i.draft.needs_review.length ? ` · ${i.draft.needs_review.length} to check` : " · all clear"}
                </span>
              )}
              {i.status === "error" && <span className="tiny error">{i.error instanceof Error ? i.error.message : "Couldn't read this one."}</span>}
              {mode === "behind" && i.draft && (
                <details className="tiny">
                  <summary>AI output (schema-checked)</summary>
                  <Json value={i.draft} />
                </details>
              )}
            </div>
            <span className="state">
              {i.status === "waiting" && <span className="muted">Waiting</span>}
              {i.status === "reading" && <Spinner label="Reading" />}
              {i.status === "done" && <span style={{ color: "var(--good)" }}>✓ {i.ms ? `${(i.ms / 1000).toFixed(1)}s` : "Done"}</span>}
              {i.status === "error" && (
                <button type="button" className="btn small" onClick={() => onRetry(i)}>
                  Retry
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <div className="row between">
        <button type="button" className="btn ghost" onClick={onBack} disabled={!finished}>
          ← Back
        </button>
        <button type="button" className="btn primary" disabled={!finished || done === 0} onClick={onNext}>
          Check listings →
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Step 3

function Review({
  items,
  onChange,
  onBack,
  onNext,
  published,
}: {
  items: Item[];
  onChange: (key: string, p: Product) => void;
  onBack: () => void;
  onNext: () => void;
  published: number;
}) {
  const ready = items.filter((i) => i.product && i.draft);
  return (
    <section className="stack fade-up">
      <p className="muted" style={{ margin: 0 }}>
        Check each listing. Anything the AI wasn&apos;t sure about is highlighted. Nothing goes live until you approve it.
      </p>
      <div className="stack stagger">
        {ready.map((i) => (
          <ReviewCard key={i.key} product={i.product!} draft={i.draft!} onChange={(p) => onChange(i.key, p)} />
        ))}
      </div>
      <div className="row between">
        <button type="button" className="btn ghost" onClick={onBack}>
          ← Back
        </button>
        <button type="button" className="btn primary" disabled={published === 0} onClick={onNext}>
          {published === 0 ? "Approve at least one" : `Open my stall (${published}) →`}
        </button>
      </div>
    </section>
  );
}

function ReviewCard({ product, draft, onChange }: { product: Product; draft: ListingDraft; onChange: (p: Product) => void }) {
  const { mode, toast } = useApp();
  const [title, setTitle] = useState(product.title);
  const [description, setDescription] = useState(product.description);
  const [price, setPrice] = useState(product.price);
  const [stock, setStock] = useState(String(product.stock || 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const live = product.status === "published";
  const suggestion = !price ? suggestUsd(draft.price_in_caption) : undefined;
  const priceInvalid = price !== "" && !/^\d+(\.\d{1,2})?$/.test(price);
  const otherChecks = draft.needs_review.filter((r) => !/price/i.test(r));

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/products/${product.id}`, { title, description, price, stock: Number(stock) || 1 }, "PATCH");
      const p = await postJson<Product>(`/api/products/${product.id}/publish`, {});
      onChange(p);
      toast(`“${p.title}” is live for AI shoppers`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`card listing ${live ? "approved" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {product.imageUrl ? <img src={product.imageUrl} alt="" /> : <div className="skeleton" style={{ height: 140 }} />}
      <div className="stack tight">
        <div className="row">
          {live ? <span className="badge good pop">✓ Live</span> : <span className="badge warn">Needs your OK</span>}
          <span className="badge plain">From {draft.caption_language}</span>
          {mode === "behind" && product.paypalProductId && <span className="badge indigo">PayPal catalog {product.paypalProductId}</span>}
        </div>
        {!live && otherChecks.length > 0 && (
          <div className="notice warn small">
            <span aria-hidden="true">👀</span>
            <span>{otherChecks.join(" · ")}</span>
          </div>
        )}
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={live} />
        </label>
        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={live} rows={3} />
        </label>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label style={{ width: "8.5rem" }}>
            Price (US$)
            <input value={price} onChange={(e) => setPrice(e.target.value.trim())} inputMode="decimal" placeholder="28.00" disabled={live} aria-invalid={priceInvalid} />
          </label>
          <label style={{ width: "5.5rem" }}>
            In stock
            <input value={stock} onChange={(e) => setStock(e.target.value)} inputMode="numeric" disabled={live} />
          </label>
        </div>
        {priceInvalid && <span className="field-error">Use a number like 28 or 28.50.</span>}
        {suggestion && !live && (
          <div className="notice info small">
            <span aria-hidden="true">💱</span>
            <span style={{ flex: 1 }}>
              Your post says <b>{draft.price_in_caption}</b> ≈ <b>${suggestion}</b>.
            </span>
            <button type="button" className="btn small" onClick={() => setPrice(suggestion)}>
              Use ${suggestion}
            </button>
          </div>
        )}
        {error ? <ErrorNote error={error} onRetry={approve} /> : null}
        {!live && (
          <div>
            <button type="button" className="btn primary" disabled={busy || !price || priceInvalid} onClick={approve}>
              {busy ? <Spinner label="Publishing…" /> : "✓ Looks good, publish"}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------- Step 4

function GoLive({ count, onMore }: { count: number; onMore: () => void }) {
  const { toast } = useApp();
  const [stall, setStall] = useState<StallInfo | null>(null);
  useEffect(() => {
    api<StallInfo>("/api/stall").then(setStall, () => setStall(null));
  }, []);
  const address = stall ? `${window.location.origin}${stall.mcpPath}` : "";

  return (
    <section className="card stack center pop" style={{ position: "relative", overflow: "hidden", padding: "2rem 1.2rem" }}>
      <Confetti />
      <div style={{ fontSize: "3rem" }} aria-hidden="true">🎉</div>
      <h2>Your stall is open to AI shoppers</h2>
      <p className="muted">
        {count} new product{count === 1 ? "" : "s"} live{stall ? `, ${stall.counts.products} in total` : ""}. Each one is also a PayPal catalog product.
      </p>
      {stall && (
        <div className="stack tight" style={{ justifyItems: "center" }}>
          <span className="small muted">Your stall&apos;s address for AI agents</span>
          <div className="row" style={{ justifyContent: "center" }}>
            <code className="code">{address}</code>
            <button
              type="button"
              className="btn small"
              onClick={() => navigator.clipboard.writeText(address).then(() => toast("Address copied"), () => toast("Couldn't copy"))}
            >
              Copy
            </button>
          </div>
        </div>
      )}
      <div className="row" style={{ justifyContent: "center", marginTop: ".5rem" }}>
        <Link href="/shop" className="btn primary">
          🛍️ Try buying as a shopper
        </Link>
        <Link href="/stall" className="btn">
          📊 See My Stall
        </Link>
        <button type="button" className="btn ghost" onClick={onMore}>
          Add more posts
        </button>
      </div>
    </section>
  );
}
