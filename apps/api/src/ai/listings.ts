import { z } from "zod";
import type { Llm, Part } from "./llm.js";

/** What the vision model must return for each product. Validated before the seller ever sees it. */
export const ListingDraftSchema = z.object({
  title: z.string().min(3).max(80),
  description: z.string().min(10).max(400),
  price_usd: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .nullable()
    .describe("Price in USD only if the caption states a USD price; otherwise null"),
  price_in_caption: z.string().nullable().describe("The price exactly as written in the caption, any currency, or null"),
  materials: z.array(z.string()).max(6),
  colors: z.array(z.string()).max(6),
  dimensions: z.string().nullable(),
  tags: z.array(z.string().min(2).max(24)).min(1).max(10),
  caption_language: z.string().describe("Language of the caption, e.g. 'Malay', 'English'"),
  needs_review: z.array(z.string()).describe("Fields the seller should double-check, with a short reason"),
});

export type ListingDraft = z.infer<typeof ListingDraftSchema>;

const SYSTEM = `You turn a small seller's product photo and social-media caption into a structured shop listing.
Rules:
- Write the title and description in clear English, whatever language the caption is in.
- Describe only what is visible in the photo or stated in the caption. Never invent materials, sizes, origin or prices.
- price_usd: fill only if the caption gives a USD price. If the price is in another currency, put it in price_in_caption, set price_usd to null, and add "price" to needs_review.
- Tags: short lowercase words a shopper might search for.
- Put anything uncertain in needs_review.`;

export async function extractListing(
  llm: Llm,
  input: { image?: { mimeType: string; base64: string }; caption: string },
): Promise<ListingDraft> {
  const parts: Part[] = [];
  if (input.image) parts.push({ inlineData: { mimeType: input.image.mimeType, data: input.image.base64 } });
  parts.push({ text: `Caption:\n"""\n${input.caption.slice(0, 2000)}\n"""` });
  const draft = await llm.generateJson({ system: SYSTEM, parts, schema: ListingDraftSchema });
  return { ...draft, tags: [...new Set(draft.tags.map((t) => t.toLowerCase()))] };
}
