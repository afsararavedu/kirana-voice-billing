/**
 * The browser's speech recognition (`SPEECH_PROVIDER=browser`). Chrome sends the audio to its own
 * speech service; the app never receives or stores audio, only the text the cashier then reviews.
 * Typed in minimally because the Web Speech API is not in TypeScript's DOM library.
 */
export interface SpeechResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

export interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

export type RecognitionCtor = new () => Recognition;

export function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** All results so far, best alternative of each, joined. */
export function transcriptOf(e: SpeechResultEvent): string {
  return Array.from(e.results, (r) => r[0]?.transcript ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
