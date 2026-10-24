import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

export interface ToolDeclaration {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ChatTurn {
  role: "user" | "model";
  parts: unknown[];
}

/** The small slice of an LLM that AgentStall uses. Gemini in production, a fake in tests. */
export interface Llm {
  generateJson<T>(opts: { system: string; parts: Part[]; schema: ZodType<T> }): Promise<T>;
  /** One step of a tool-using conversation: either tool calls or final text. */
  step(opts: { system: string; history: ChatTurn[]; tools: ToolDeclaration[] }): Promise<{
    text?: string;
    toolCalls: ToolCall[];
    modelTurn: ChatTurn;
  }>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

const API = "https://generativelanguage.googleapis.com/v1beta";

/** Gemini over REST with structured output. Validates every JSON response and retries once with the error. */
export class GeminiLlm implements Llm {
  private readonly models: string[];

  /** `models` is tried in order: if one is overloaded, rate-limited or slow, the next takes over. */
  constructor(
    private readonly apiKey: string,
    models: string | string[] = "gemini-flash-lite-latest",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.models = Array.isArray(models) ? models : [models];
  }

  async generateJson<T>({ system, parts, schema }: { system: string; parts: Part[]; schema: ZodType<T> }): Promise<T> {
    const jsonSchema = toGeminiSchema(schema);
    const contents: ChatTurn[] = [{ role: "user", parts }];
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.call({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: jsonSchema, temperature: 0.2 },
      });
      const text = textOf(res);
      const parsed = safeJson(text);
      const result = schema.safeParse(parsed);
      if (result.success) return result.data;
      // Repair retry: show the model exactly what failed validation.
      contents.push(
        { role: "model", parts: [{ text }] },
        { role: "user", parts: [{ text: `That JSON failed validation: ${result.error.message}. Return corrected JSON only.` }] },
      );
    }
    throw new LlmError("Model output failed schema validation twice");
  }

  async step({ system, history, tools }: { system: string; history: ChatTurn[]; tools: ToolDeclaration[] }) {
    const res = await this.call({
      systemInstruction: { parts: [{ text: system }] },
      contents: history,
      tools: [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parametersJsonSchema: t.parameters,
          })),
        },
      ],
      generationConfig: { temperature: 0.3 },
    });
    const content = res.candidates?.[0]?.content ?? { role: "model", parts: [] };
    const parts = (content.parts ?? []) as { text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }[];
    const toolCalls = parts.filter((p) => p.functionCall).map((p) => ({ name: p.functionCall!.name, args: p.functionCall!.args ?? {} }));
    const text = parts
      .map((p) => p.text)
      .filter(Boolean)
      .join("");
    return { text: text || undefined, toolCalls, modelTurn: { role: "model" as const, parts } };
  }

  private async call(body: unknown): Promise<GeminiResponse> {
    let lastError: LlmError | undefined;
    for (const [i, model] of this.models.entries()) {
      const isLast = i === this.models.length - 1;
      // Free tier: 429 (quota) and 503 (overloaded) are common. Retry briefly, then fall back to the next model.
      for (let attempt = 0; attempt < (isLast ? 3 : 2); attempt++) {
        let res: Response;
        try {
          res = await this.fetchImpl(`${API}/models/${model}:generateContent`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(isLast ? 60_000 : 25_000),
          });
        } catch (err) {
          lastError = new LlmError(`Gemini ${model}: ${(err as Error).message}`);
          break; // timeout: don't wait twice on a slow model
        }
        if (res.ok) return (await res.json()) as GeminiResponse;
        const detail = await res.text();
        lastError = new LlmError(`Gemini ${model} ${res.status}: ${detail.slice(0, 300)}`, res.status);
        if (res.status !== 429 && res.status !== 503) throw lastError;
        const hinted = Number(detail.match(/"retryDelay":\s*"(\d+)s"/)?.[1]);
        await sleep(Math.min(Number.isFinite(hinted) ? hinted * 1000 : 1500 * 2 ** attempt, isLast ? 20_000 : 4_000));
      }
      if (!isLast) console.warn(`Gemini ${model} unavailable, falling back: ${lastError?.message.slice(0, 120)}`);
    }
    throw lastError ?? new LlmError("No Gemini model configured");
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface GeminiResponse {
  candidates?: { content?: { role: string; parts?: unknown[] } }[];
}

function textOf(res: GeminiResponse): string {
  return ((res.candidates?.[0]?.content?.parts ?? []) as { text?: string }[]).map((p) => p.text ?? "").join("");
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function toGeminiSchema(schema: ZodType<unknown>): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = zodToJsonSchema(schema, { $refStrategy: "none" }) as Record<string, unknown>;
  return rest;
}

/** `main` for photo extraction; `fast` for the stall-keeper and buyer agent. Both default to Flash-Lite (~1–3s per call, higher free quota). */
export function llmFromEnv(env: NodeJS.ProcessEnv = process.env): { main: Llm; fast: Llm } | undefined {
  if (!env.GEMINI_API_KEY) return undefined;
  return {
    // Flash-Lite by default: the bigger Flash model is often overloaded on the free tier. Set GEMINI_MODEL to try another model first.
    main: new GeminiLlm(env.GEMINI_API_KEY, [...(env.GEMINI_MODEL ? [env.GEMINI_MODEL] : []), env.GEMINI_FAST_MODEL || "gemini-flash-lite-latest"]),
    fast: new GeminiLlm(env.GEMINI_API_KEY, env.GEMINI_FAST_MODEL || "gemini-flash-lite-latest"),
  };
}
