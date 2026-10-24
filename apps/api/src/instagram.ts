import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Hono, type Context } from "hono";
import type { StallEnv } from "./seller-api.js";
import type { Store } from "./store.js";

/**
 * Instagram import via the official "Instagram API with Instagram Login" (Business/Creator accounts).
 * With INSTAGRAM_APP_ID/SECRET/REDIRECT_URI set, sellers connect their real account through Instagram's
 * OAuth page. Without them, a clearly labelled demo account serves the demo photos through the same
 * code path and the same response shape as Instagram's Graph API.
 */

export const DEMO_PHOTOS_DIR = new URL("../../../demo-photos/", import.meta.url);
const GRAPH = "https://graph.instagram.com";
const DEMO_USERNAME = "mayas.batik.corner";

export interface InstagramMedia {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_url: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string;
}

export interface InstagramConnection {
  mode: "live" | "demo";
  username: string;
  userId?: string;
  /** Long-lived access token (live mode only). Never sent to the browser. */
  accessToken?: string;
  expiresAt?: string;
}

interface InstagramConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

function config(env: NodeJS.ProcessEnv = process.env): InstagramConfig | undefined {
  const { INSTAGRAM_APP_ID: appId, INSTAGRAM_APP_SECRET: appSecret, INSTAGRAM_REDIRECT_URI: redirectUri } = env;
  return appId && appSecret && redirectUri ? { appId, appSecret, redirectUri } : undefined;
}

async function demoMedia(): Promise<InstagramMedia[]> {
  const text = await readFile(new URL("captions.txt", DEMO_PHOTOS_DIR), "utf8").catch(() => "");
  return text
    .split("\n")
    .map((line) => line.split(" | "))
    .filter(([file, caption]) => file && caption)
    .map(([file, caption], i) => ({
      id: `demo_${file.trim().replace(".jpg", "")}`,
      caption: caption.trim(),
      media_type: "IMAGE" as const,
      media_url: `/demo-photos/${file.trim()}`,
      permalink: `https://www.instagram.com/p/demo-${file.trim().replace(".jpg", "")}/`,
      timestamp: new Date(Date.now() - (i + 1) * 36 * 3600 * 1000).toISOString(),
    }));
}

async function graph<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${GRAPH}${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Instagram ${res.status}: ${body.error?.message ?? "request failed"}`);
  return body;
}

/** Lists the seller's recent posts (newest first). */
export async function listMedia(store: Store): Promise<InstagramMedia[]> {
  const ig = store.instagram;
  if (!ig) throw new Error("Instagram is not connected");
  if (ig.mode === "demo") return demoMedia();
  const res = await store.traced("app", "Instagram · GET /me/media", { fields: "caption, media_url, permalink…" }, () =>
    graph<{ data: InstagramMedia[] }>("/me/media", {
      fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp",
      limit: "24",
      access_token: ig.accessToken!,
    }),
  );
  return res.data.filter((m) => m.media_type !== "VIDEO");
}

/** Downloads one post's image and caption. Instagram media URLs expire, so the image is copied, not linked. */
export async function loadMedia(store: Store, mediaId: string): Promise<{ bytes: Buffer; mimeType: string; caption: string; permalink: string }> {
  const media = (await listMedia(store)).find((m) => m.id === mediaId);
  if (!media) throw new Error("No product with that Instagram post");
  if (store.instagram?.mode === "demo") {
    const file = media.media_url.split("/").pop()!;
    return { bytes: await readFile(new URL(file, DEMO_PHOTOS_DIR)), mimeType: "image/jpeg", caption: media.caption ?? "", permalink: media.permalink };
  }
  const res = await fetch(media.media_url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Instagram image download failed (${res.status})`);
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    mimeType: res.headers.get("content-type") ?? "image/jpeg",
    caption: media.caption ?? "",
    permalink: media.permalink,
  };
}

export function instagramRoutes(opts: { limited: (c: Context<StallEnv>) => Response | undefined }): Hono<StallEnv> {
  const ig = new Hono<StallEnv>();
  const store = (c: Context<StallEnv>) => c.get("commerce").store;

  ig.get("/status", (c) => {
    const conn = store(c).instagram;
    return c.json({ available: config() ? "live" : "demo", connected: Boolean(conn), mode: conn?.mode, username: conn?.username });
  });

  // Starts the connection: Instagram's own login page in live mode, the demo account otherwise.
  ig.get("/connect", (c) => {
    const cfg = config();
    const s = store(c);
    if (!cfg) {
      s.instagram = { mode: "demo", username: DEMO_USERNAME };
      s.dirty = true;
      return c.redirect("/sell?instagram=connected");
    }
    const state = randomUUID();
    s.instagramState = state;
    s.dirty = true;
    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.search = new URLSearchParams({
      client_id: cfg.appId,
      redirect_uri: cfg.redirectUri,
      response_type: "code",
      scope: "instagram_business_basic",
      state,
    }).toString();
    return c.redirect(url.toString());
  });

  // Instagram sends the seller back here with a one-time code, exchanged for a long-lived token.
  ig.get("/callback", async (c) => {
    const cfg = config();
    const s = store(c);
    const code = c.req.query("code");
    if (!cfg || !code || c.req.query("state") !== s.instagramState) return c.redirect("/sell?instagram=failed");
    try {
      const form = new URLSearchParams({
        client_id: cfg.appId,
        client_secret: cfg.appSecret,
        grant_type: "authorization_code",
        redirect_uri: cfg.redirectUri,
        code,
      });
      const short = await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body: form });
      if (!short.ok) throw new Error(`token exchange failed (${short.status})`);
      const { access_token, user_id } = (await short.json()) as { access_token: string; user_id: string };
      const long = await graph<{ access_token: string; expires_in: number }>("/access_token", {
        grant_type: "ig_exchange_token",
        client_secret: cfg.appSecret,
        access_token,
      });
      const me = await graph<{ username: string }>("/me", { fields: "username", access_token: long.access_token });
      s.instagram = {
        mode: "live",
        username: me.username,
        userId: String(user_id),
        accessToken: long.access_token,
        expiresAt: new Date(Date.now() + long.expires_in * 1000).toISOString(),
      };
      s.instagramState = undefined;
      s.dirty = true;
      return c.redirect("/sell?instagram=connected");
    } catch (err) {
      console.error(err);
      return c.redirect("/sell?instagram=failed");
    }
  });

  ig.post("/disconnect", (c) => {
    const s = store(c);
    s.instagram = undefined;
    s.dirty = true;
    return c.json({ ok: true });
  });

  ig.get("/media", async (c) => {
    const s = store(c);
    if (!s.instagram) return c.json({ error: "Connect Instagram first." }, 400);
    const blocked = opts.limited(c);
    if (blocked) return blocked;
    const imported = new Set([...s.products.values()].map((p) => p.sourcePermalink).filter(Boolean));
    const media = await listMedia(s);
    return c.json(media.map((m) => ({ ...m, imported: imported.has(m.permalink) })));
  });

  return ig;
}
