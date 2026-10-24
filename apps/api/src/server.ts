import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { gatewayFromEnv } from "@agentstall/paypal";
import { llmFromEnv } from "./ai/llm.js";
import { StallKeeper } from "./ai/stallkeeper.js";
import { createApp } from "./app.js";
import { StallRegistry } from "./registry.js";

const port = Number(process.env.PORT ?? 8787);
// The public web origin. The web app proxies /checkout, /mock-paypal and /s/*/mcp to this API, so buyers stay on one site.
const publicUrl = process.env.PUBLIC_URL ?? "http://localhost:3000";
const gateway = gatewayFromEnv({ ...process.env, PUBLIC_URL: publicUrl });
const llm = llmFromEnv();
const dbPath = process.env.DATA_DIR
  ? `${process.env.DATA_DIR}/agentstall.db`
  : fileURLToPath(new URL("../../../data/agentstall.db", import.meta.url));

const registry = new StallRegistry(gateway, {
  dbPath,
  publicUrl,
  answerer: llm ? new StallKeeper(llm.fast) : undefined,
});

if (gateway.mode === "mock") {
  console.warn("PayPal: MOCK mode (no sandbox credentials). Never film or submit in this mode.");
}
if (!llm) console.warn("AI: GEMINI_API_KEY not set; extractor and shopping assistant are disabled, stall-keeper uses keyword matching.");

const server = serve({ fetch: createApp(registry, { llm: llm?.main, agentLlm: llm?.fast }).fetch, port }, () => {
  console.log(`agentstall-api on ${publicUrl} (paypal: ${gateway.mode}, ai: ${llm ? "gemini" : "off"}, data: ${dbPath})`);
});

// Save every stall before exiting so nothing is lost on restart or redeploy.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    registry.close();
    server.close(() => process.exit(0));
  });
}
