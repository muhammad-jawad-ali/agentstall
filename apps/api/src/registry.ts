import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PayPalEvent, PayPalGateway } from "@agentstall/paypal";
import { Commerce, type SellerAnswerer } from "./commerce.js";
import { createMcpHandler } from "./mcp.js";
import { Store, seedDemoStore } from "./store.js";

/** The shared showcase stall: what `/mcp` serves and what the video uses. */
export const SHOWCASE_STALL = "maya";

const IDLE_EVICT_MS = 60 * 60 * 1000;
const DEMO_STALL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface Loaded {
  commerce: Commerce;
  mcp: (req: Request) => Promise<Response>;
  lastUsed: number;
}

/**
 * Every visitor gets a private copy of the demo stall, so judges testing at the same time never
 * collide. Stalls live in memory while in use and are saved to SQLite, so nothing is lost on restart.
 */
export class StallRegistry {
  private readonly db: DatabaseSync;
  private readonly loaded = new Map<string, Loaded>();
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    readonly gateway: PayPalGateway,
    private readonly options: { dbPath: string; publicUrl: string; answerer?: SellerAnswerer; seed?: () => Store },
  ) {
    if (options.dbPath !== ":memory:") mkdirSync(dirname(options.dbPath), { recursive: true });
    this.db = new DatabaseSync(options.dbPath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS stalls (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    gateway.onEvent((event) => this.dispatch(event));
    this.timers.push(setInterval(() => this.flush(), 2000).unref());
    this.timers.push(setInterval(() => this.cleanup(), 15 * 60 * 1000).unref());
    this.cleanup();
  }

  private get seed() {
    return this.options.seed ?? seedDemoStore;
  }

  /** Loads a stall from memory or SQLite; undefined if it doesn't exist. */
  get(id: string): Commerce | undefined {
    const hit = this.loaded.get(id);
    if (hit) {
      hit.lastUsed = Date.now();
      return hit.commerce;
    }
    const row = this.db.prepare("SELECT data FROM stalls WHERE id = ?").get(id) as { data: string } | undefined;
    if (!row && id !== SHOWCASE_STALL) return undefined;
    const store = row ? Store.fromJSON(JSON.parse(row.data)) : this.seed();
    return this.load(id, store, !row).commerce;
  }

  create(): { id: string; commerce: Commerce } {
    const id = randomBytes(6).toString("base64url");
    return { id, commerce: this.load(id, this.seed(), true).commerce };
  }

  /** Puts a stall back to the starting demo state (the "Reset my demo" button). */
  reset(id: string): Commerce {
    const commerce = this.get(id) ?? this.load(id, this.seed(), true).commerce;
    commerce.reset(this.seed());
    commerce.store.dirty = true;
    this.flush();
    return commerce;
  }

  mcpHandler(id: string): ((req: Request) => Promise<Response>) | undefined {
    if (!this.get(id)) return undefined;
    return this.loaded.get(id)!.mcp;
  }

  /** Finds the stall an order belongs to (checkout return, mock approval page, webhooks). */
  findByOrder(orderId: string): Commerce | undefined {
    for (const { commerce } of this.loaded.values()) if (commerce.store.orders.has(orderId)) return commerce;
    const row = this.db
      .prepare("SELECT id FROM stalls WHERE data LIKE ? LIMIT 1")
      .get(`%"id":"${orderId.replace(/[^A-Za-z0-9_-]/g, "")}"%`) as { id: string } | undefined;
    return row ? this.get(row.id) : undefined;
  }

  dispatch(event: PayPalEvent) {
    const orderId = (event.resource as { supplementary_data?: { related_ids?: { order_id?: string } } })
      .supplementary_data?.related_ids?.order_id;
    const commerce = orderId ? this.findByOrder(orderId) : undefined;
    commerce?.handlePayPalEvent(event);
  }

  /** Saves every changed stall. Runs every 2 seconds and on shutdown. */
  flush() {
    const upsert = this.db.prepare(
      `INSERT INTO stalls (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    );
    for (const [id, { commerce }] of this.loaded) {
      if (!commerce.store.dirty) continue;
      commerce.store.dirty = false;
      upsert.run(id, JSON.stringify(commerce.store), Date.now(), Date.now());
    }
  }

  /** Drops demo stalls unused for a week and unloads idle ones from memory (they stay in SQLite). */
  cleanup() {
    this.flush();
    this.db.prepare("DELETE FROM stalls WHERE id != ? AND updated_at < ?").run(SHOWCASE_STALL, Date.now() - DEMO_STALL_TTL_MS);
    for (const [id, entry] of this.loaded) {
      if (Date.now() - entry.lastUsed > IDLE_EVICT_MS) this.loaded.delete(id);
    }
  }

  close() {
    this.flush();
    for (const t of this.timers) clearInterval(t);
    this.db.close();
  }

  private load(id: string, store: Store, isNew: boolean): Loaded {
    const commerce = new Commerce(store, this.gateway, {
      publicUrl: this.options.publicUrl,
      answerer: this.options.answerer,
      listen: false,
    });
    const entry = { commerce, mcp: createMcpHandler(commerce), lastUsed: Date.now() };
    this.loaded.set(id, entry);
    if (isNew) {
      store.dirty = true;
      this.flush();
    }
    return entry;
  }
}
