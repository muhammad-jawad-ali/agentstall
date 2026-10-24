import { serve } from "@hono/node-server";
import { gatewayFromEnv } from "@agentstall/paypal";
import { llmFromEnv } from "./ai/llm.js";
import { StallKeeper } from "./ai/stallkeeper.js";
import { createApp } from "./app.js";
import { Commerce } from "./commerce.js";
import { seedDemoStore } from "./store.js";

const port = Number(process.env.PORT ?? 8787);
const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${port}`;
const gateway = gatewayFromEnv({ ...process.env, PUBLIC_URL: publicUrl });
const llm = llmFromEnv();
const commerce = new Commerce(seedDemoStore(), gateway, {
  publicUrl,
  answerer: llm ? new StallKeeper(llm.fast) : undefined,
});

if (gateway.mode === "mock") {
  console.warn("PayPal: MOCK mode (no sandbox credentials). Never film or submit in this mode.");
}
if (!llm) console.warn("AI: GEMINI_API_KEY not set; extractor and Buyer Console are disabled, stall-keeper uses keyword matching.");

serve({ fetch: createApp(commerce, { llm: llm?.main, agentLlm: llm?.fast }).fetch, port }, () => {
  console.log(`agentstall-api on ${publicUrl} (paypal: ${gateway.mode}, ai: ${llm ? "gemini" : "off"}); MCP endpoint ${publicUrl}/mcp`);
});
