"use client";

import { useEffect, useState } from "react";
import { api, postJson, type ListingDraft, type Product } from "@/lib/api";

interface DemoPhoto {
  file: string;
  caption: string;
  url: string;
}

export default function SellPage() {
  const [photos, setPhotos] = useState<DemoPhoto[]>([]);
  const [selected, setSelected] = useState<DemoPhoto | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<{ product: Product; draft: ListingDraft }[]>([]);

  useEffect(() => {
    api<DemoPhoto[]>("/api/demo/photos").then(setPhotos, () => setPhotos([]));
  }, []);

  const pickDemo = (p: DemoPhoto) => {
    setSelected(p);
    setFile(null);
    setCaption(p.caption);
  };

  const extract = async () => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("caption", caption);
      if (file) form.set("image", file);
      else if (selected) form.set("image", new File([await (await fetch(selected.url)).blob()], selected.file, { type: "image/jpeg" }));
      const result = await api<{ product: Product; draft: ListingDraft }>("/api/listings/extract", { method: "POST", body: form });
      setDrafts((d) => [result, ...d]);
      setSelected(null);
      setFile(null);
      setCaption("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const replace = (product: Product) =>
    setDrafts((d) => d.map((x) => (x.product.id === product.id ? { ...x, product } : x)));

  return (
    <main className="page stack">
      <div>
        <h1>Seller onboarding</h1>
        <p className="lead">
          Paste a post the way you&apos;d write it on Instagram, in any language. The AI drafts a listing, a schema checks every
          field, and nothing goes live until you approve it.
        </p>
      </div>

      <div className="grid-2">
        <section className="card stack">
          <h2>1. Pick a photo</h2>
          {photos.length > 0 && (
            <>
              <p className="small muted">Demo photos from Maya&apos;s feed (openly licensed, see credits in the repo):</p>
              <div className="thumbs">
                {photos.map((p) => (
                  <button key={p.file} type="button" className="thumb" aria-pressed={selected?.file === p.file} onClick={() => pickDemo(p)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={`Demo product ${p.file}`} />
                  </button>
                ))}
              </div>
            </>
          )}
          <label>
            Or upload your own
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setSelected(null);
              }}
            />
          </label>
        </section>

        <section className="card stack">
          <h2>2. Caption</h2>
          <label>
            Post caption
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={5} placeholder="Selendang batik lukis tangan… RM120" />
          </label>
          <div className="row">
            <button type="button" className="btn primary" disabled={busy || (!caption.trim() && !file && !selected)} onClick={extract}>
              {busy ? "Drafting listing…" : "Draft listing with AI"}
            </button>
            {error && <span className="error small">{error}</span>}
          </div>
        </section>
      </div>

      {drafts.length > 0 && (
        <section className="stack">
          <h2>3. Review and publish</h2>
          {drafts.map(({ product, draft }) => (
            <DraftCard key={product.id} product={product} draft={draft} onChange={replace} />
          ))}
        </section>
      )}
    </main>
  );
}

function DraftCard({ product, draft, onChange }: { product: Product; draft: ListingDraft; onChange: (p: Product) => void }) {
  const [title, setTitle] = useState(product.title);
  const [description, setDescription] = useState(product.description);
  const [price, setPrice] = useState(product.price);
  const [stock, setStock] = useState(String(product.stock));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const published = product.status === "published";

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      await postJson<Product>(`/api/products/${product.id}`, { title, description, price, stock: Number(stock) }, "PATCH");
      onChange(await postJson<Product>(`/api/products/${product.id}/publish`, {}));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="card listing">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {product.imageUrl ? <img src={product.imageUrl} alt="" /> : <div />}
      <div className="stack" style={{ gap: ".6rem" }}>
        <div className="row">
          <span className={`badge ${published ? "good" : "warn"}`}>{published ? "Live for agents" : "Draft"}</span>
          <span className="badge indigo">Caption: {draft.caption_language}</span>
          {draft.price_in_caption && <span className="badge">Caption price: {draft.price_in_caption}</span>}
          {product.paypalProductId && <span className="badge good">PayPal product {product.paypalProductId}</span>}
        </div>
        {!published && draft.needs_review.length > 0 && (
          <ul className="small" style={{ margin: 0, color: "var(--warn)" }}>
            {draft.needs_review.map((r) => (
              <li key={r}>Check: {r}</li>
            ))}
          </ul>
        )}
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={published} />
        </label>
        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={published} />
        </label>
        <div className="row" style={{ alignItems: "end" }}>
          <label style={{ width: "8rem" }}>
            Price (USD)
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="28.00" disabled={published} />
          </label>
          <label style={{ width: "6rem" }}>
            Stock
            <input value={stock} onChange={(e) => setStock(e.target.value)} inputMode="numeric" disabled={published} />
          </label>
          {!published && (
            <button type="button" className="btn primary" disabled={busy} onClick={publish}>
              {busy ? "Publishing…" : "Approve & publish to PayPal"}
            </button>
          )}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Tags: {product.tags.join(", ")}
        </p>
        {error && <p className="error small">{error}</p>}
      </div>
    </article>
  );
}
