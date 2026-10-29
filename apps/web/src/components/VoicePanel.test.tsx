import type { VoiceParseDto } from '@kirana/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n, { setUiLanguage } from '../i18n';
import { VoicePanel } from './VoicePanel';

const voiceConfig = vi.fn();
const parseVoice = vi.fn();
vi.mock('../api/client', () => ({
  api: { voiceConfig: () => voiceConfig(), parseVoice: (...a: unknown[]) => parseVoice(...a) },
}));
vi.mock('../auth/AuthContext', () => ({
  // UI in English, speech in Telugu: the two settings are independent.
  useAuth: () => ({ user: { speechLocale: 'te-IN', uiLanguage: 'en' } }),
}));

const rice = { id: 'p-rice', name: 'Rice', localNames: { te: 'బియ్యం' }, unit: 'KG' as const };
const lux = { id: 'p-lux', name: 'Lux Soap', localNames: {}, unit: 'PIECE' as const };
const dettol = { id: 'p-dettol', name: 'Dettol Soap', localNames: {}, unit: 'PIECE' as const };

const result: VoiceParseDto = {
  extractor: 'rules',
  fellBack: false,
  lines: [
    {
      heard: 'బియ్యం',
      quantity: '2',
      unit: 'KG',
      status: 'MATCHED',
      candidates: [{ product: rice, quantity: '2', problem: null }],
    },
    {
      heard: 'సబ్బు',
      quantity: null,
      unit: null,
      status: 'AMBIGUOUS',
      candidates: [
        { product: dettol, quantity: null, problem: 'NEEDS_QUANTITY' },
        { product: lux, quantity: null, problem: 'NEEDS_QUANTITY' },
      ],
    },
    { heard: 'కుంకుమపువ్వు', quantity: '1', unit: 'G', status: 'NOT_FOUND', candidates: [] },
  ],
};

/** Stand-in for Chrome's SpeechRecognition: "hears" a fixed Telugu phrase. */
class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = '';
  interimResults = false;
  continuous = true;
  maxAlternatives = 0;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    queueMicrotask(() => {
      this.onresult?.({
        results: [Object.assign([{ transcript: 'రెండు కిలోల బియ్యం, సబ్బు' }], { isFinal: true })],
      });
      this.onend?.();
    });
  }
  stop() {}
}

const renderPanel = (onAdd = vi.fn()) => {
  render(
    <I18nextProvider i18n={i18n}>
      <VoicePanel storeId="s1" onAdd={onAdd} />
    </I18nextProvider>,
  );
  return onAdd;
};

describe('VoicePanel', () => {
  beforeEach(async () => {
    await setUiLanguage('en');
    voiceConfig.mockResolvedValue({
      config: {
        speech: { provider: 'browser', locales: ['en-IN', 'hi-IN', 'te-IN', 'ur-IN'] },
        extractor: { provider: 'rules', model: null },
      },
    });
    parseVoice.mockResolvedValue({ result });
  });
  afterEach(() => {
    delete (window as { SpeechRecognition?: unknown }).SpeechRecognition;
    vi.clearAllMocks();
  });

  it('listens in the speech language, then lets the cashier resolve and add lines', async () => {
    (window as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition;
    const onAdd = renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Speak' }));
    expect(FakeRecognition.last?.lang).toBe('te-IN');
    expect(await screen.findByLabelText('What the customer said')).toHaveValue('రెండు కిలోల బియ్యం, సబ్బు');

    await userEvent.click(screen.getByRole('button', { name: 'Find items' }));
    expect(parseVoice).toHaveBeenCalledWith('s1', {
      transcript: 'రెండు కిలోల బియ్యం, సబ్బు',
      locale: 'te-IN',
    });

    expect(await screen.findByText('Not in your products. Search for it above.')).toBeInTheDocument();
    // Only the unambiguous line is ready until the cashier picks a soap and a quantity.
    expect(screen.getByRole('button', { name: 'Add 1 to bill' })).toBeEnabled();
    await userEvent.click(screen.getByRole('radio', { name: 'Lux Soap' }));
    expect(screen.getByText('How much?')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Quantity సబ్బు'), '1.5'); // soap is whole pieces
    expect(screen.getByRole('button', { name: 'Add 1 to bill' })).toBeEnabled();
    await userEvent.clear(screen.getByLabelText('Quantity సబ్బు'));
    await userEvent.type(screen.getByLabelText('Quantity సబ్బు'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Add 2 to bill' }));

    expect(onAdd).toHaveBeenCalledWith([
      { product: rice, quantity: '2' },
      { product: lux, quantity: '3' },
    ]);
    expect(screen.getByLabelText('What the customer said')).toHaveValue('');
  });

  it('falls back to typing when the browser has no speech recognition', async () => {
    renderPanel();
    expect(await screen.findByText(/Voice input isn’t available in this browser/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Speak' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('What the customer said'), '2 kg rice');
    await userEvent.click(screen.getByRole('button', { name: 'Find items' }));
    await waitFor(() =>
      expect(parseVoice).toHaveBeenCalledWith('s1', { transcript: '2 kg rice', locale: 'te-IN' }),
    );
  });

  it('hides the microphone when the server’s speech provider does not support the locale', async () => {
    (window as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition;
    voiceConfig.mockResolvedValue({
      config: { speech: { provider: 'none', locales: [] }, extractor: { provider: 'rules', model: null } },
    });
    renderPanel();
    expect(await screen.findByText(/Voice input isn’t available/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Speak' })).not.toBeInTheDocument();
  });
});
