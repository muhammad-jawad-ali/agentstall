import type { ZodType } from "zod";
import type { Store } from "../store.js";
import type { ChatTurn, Llm, Part, ToolDeclaration } from "./llm.js";

/** Wraps an LLM so every call shows up in the stall's "Behind the scenes" trace. */
export function tracedLlm(llm: Llm, store: Store, label: string): Llm {
  return {
    generateJson<T>(opts: { system: string; parts: Part[]; schema: ZodType<T> }) {
      const prompt = opts.parts.map((p) => ("text" in p ? p.text : `[image ${p.inlineData.mimeType}]`));
      return store.traced("ai", label, { system: opts.system, prompt }, () => llm.generateJson(opts));
    },
    step(opts: { system: string; history: ChatTurn[]; tools: ToolDeclaration[] }) {
      return store.traced("ai", `${label}: decides next step`, { turn: opts.history.length, tools: opts.tools.map((t) => t.name) }, () =>
        llm.step(opts),
      );
    },
  };
}
