import { z } from 'zod';
import { quantityString, UNITS, type LocalNames, type Unit } from './catalog.js';
import { SPEECH_LOCALES, type SpeechLocale } from './languages.js';

/**
 * Voice billing turns speech into cart suggestions, never into a sale: the cashier reviews them,
 * they go through the normal server quote, and the bill is confirmed by hand (Phase 3 flow).
 */

/** `browser`: the device's own speech recognition; `none`: typed transcripts only. */
export const SPEECH_PROVIDERS = ['browser', 'none'] as const;
export type SpeechProviderName = (typeof SPEECH_PROVIDERS)[number];

/** `rules`: deterministic on-server parser; `anthropic`: Claude with structured output. */
export const VOICE_EXTRACTORS = ['rules', 'anthropic'] as const;
export type VoiceExtractorName = (typeof VOICE_EXTRACTORS)[number];

export const MAX_TRANSCRIPT_CHARS = 500;
export const MAX_VOICE_ITEMS = 30;

export const voiceParseSchema = z
  .object({
    transcript: z.string().trim().min(1).max(MAX_TRANSCRIPT_CHARS),
    locale: z.enum(SPEECH_LOCALES),
  })
  .strict();
export type VoiceParseInput = z.infer<typeof voiceParseSchema>;

/**
 * What an extractor (rules or LLM) may return: the spoken name, quantity and unit — never a
 * price, product id or total. Anything else fails validation and the output is discarded.
 */
export const extractedItemSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    quantity: quantityString.nullable(),
    unit: z.enum(UNITS).nullable(),
  })
  .strict();
export const extractionSchema = z
  .object({ items: z.array(extractedItemSchema).max(MAX_VOICE_ITEMS) })
  .strict();
export type Extraction = z.infer<typeof extractionSchema>;
export type ExtractedItem = z.infer<typeof extractedItemSchema>;

export interface VoiceProductDto {
  id: string;
  name: string;
  localNames: LocalNames;
  unit: Unit;
}

/** Why a candidate cannot go into the cart as heard; the cashier fixes the quantity. */
export const VOICE_PROBLEMS = ['NEEDS_QUANTITY', 'UNIT_MISMATCH', 'INVALID_QUANTITY'] as const;
export type VoiceProblem = (typeof VOICE_PROBLEMS)[number];

export interface VoiceCandidateDto {
  product: VoiceProductDto;
  /** Quantity in the product's own unit (e.g. 500 g of a KG product → "0.5"), when usable. */
  quantity: string | null;
  problem: VoiceProblem | null;
}

export const VOICE_LINE_STATUSES = ['MATCHED', 'AMBIGUOUS', 'NOT_FOUND', ...VOICE_PROBLEMS] as const;
export type VoiceLineStatus = (typeof VOICE_LINE_STATUSES)[number];

export interface VoiceLineDto {
  /** The name as heard (untrusted text; display only). */
  heard: string;
  quantity: string | null;
  unit: Unit | null;
  /** MATCHED / a problem: one candidate. AMBIGUOUS: several — ask which. NOT_FOUND: none. */
  status: VoiceLineStatus;
  candidates: VoiceCandidateDto[];
}

export interface VoiceParseDto {
  lines: VoiceLineDto[];
  extractor: VoiceExtractorName;
  /** The configured extractor failed or returned invalid output; the rules parser was used. */
  fellBack: boolean;
}

export interface VoiceConfigDto {
  speech: { provider: SpeechProviderName; locales: SpeechLocale[] };
  extractor: { provider: VoiceExtractorName; model: string | null };
}
