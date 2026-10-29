import type { PrismaClient } from '@prisma/client';
import {
  extractionSchema,
  SPEECH_LOCALES,
  type Extraction,
  type SpeechProviderName,
  type VoiceConfigDto,
  type VoiceParseDto,
  type VoiceParseInput,
} from '@kirana/shared';
import type { Logger } from 'pino';
import type { VoiceExtractor } from './extractor.js';
import { findProducts, toVoiceLine } from './catalog-matcher.js';
import { extractByRules } from './rule-extractor.js';

/**
 * Speech providers and the locales each can recognise. `browser` relies on the device's speech
 * service (Chrome/Android support en-IN, hi-IN, te-IN and ur-IN); the client also checks that the
 * browser actually exposes speech recognition before offering the microphone.
 */
export const SPEECH_SUPPORT: Record<SpeechProviderName, readonly (typeof SPEECH_LOCALES)[number][]> = {
  browser: SPEECH_LOCALES,
  none: [],
};

/**
 * Transcript → cart suggestions. Read-only: nothing is written, nothing is priced. Transcripts are
 * never logged (they may contain customers' words); only the outcome is.
 */
export class VoiceService {
  constructor(
    private readonly db: PrismaClient,
    private readonly extractor: VoiceExtractor,
    private readonly speechProvider: SpeechProviderName,
    private readonly logger: Logger,
  ) {}

  config(): VoiceConfigDto {
    return {
      speech: { provider: this.speechProvider, locales: [...SPEECH_SUPPORT[this.speechProvider]] },
      extractor: { provider: this.extractor.name, model: this.extractor.model },
    };
  }

  async parse(storeId: string, input: VoiceParseInput): Promise<VoiceParseDto> {
    let extraction: Extraction;
    let fellBack = false;
    if (this.extractor.name === 'rules') {
      extraction = extractByRules(input.transcript);
    } else {
      try {
        const raw = await this.extractor.extract(input);
        const parsed = extractionSchema.safeParse(raw);
        if (!parsed.success) throw new Error('extractor output failed validation');
        extraction = parsed.data;
      } catch (e) {
        // Provider down, slow, refusing or returning junk: the counter keeps working.
        this.logger.warn(
          { extractor: this.extractor.name, reason: e instanceof Error ? e.message : 'unknown' },
          'voice extractor failed; using rules parser',
        );
        extraction = extractByRules(input.transcript);
        fellBack = true;
      }
    }

    const lines = [];
    for (const item of extraction.items) {
      lines.push(toVoiceLine(item, await findProducts(this.db, storeId, item.name)));
    }
    return { lines, extractor: fellBack ? 'rules' : this.extractor.name, fellBack };
  }
}
