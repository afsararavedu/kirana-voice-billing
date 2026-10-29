import type { SpeechLocale, VoiceExtractorName } from '@kirana/shared';

/**
 * Turns a transcript into spoken items (name, quantity, unit). Implementations are chosen by
 * `VOICE_EXTRACTOR`. The return value is untrusted: the voice service validates it against
 * `extractionSchema` and discards anything else — including any price an implementation returns.
 */
export interface VoiceExtractor {
  readonly name: VoiceExtractorName;
  readonly model: string | null;
  extract(input: { transcript: string; locale: SpeechLocale }): Promise<unknown>;
}

/** The extractor could not produce usable output (refusal, empty or unparsable response). */
export class ExtractionFailed extends Error {
  constructor(readonly reason: string) {
    super(`Extraction failed: ${reason}`);
  }
}
