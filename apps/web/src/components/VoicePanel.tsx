import {
  isQuantityValidForUnit,
  MAX_TRANSCRIPT_CHARS,
  quantityString,
  type UiLanguage,
  type Unit,
  type VoiceConfigDto,
  type VoiceLineDto,
  type VoiceParseDto,
  type VoiceProductDto,
} from '@kirana/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { recognitionCtor, transcriptOf, type Recognition } from '../lib/speech';
import { ErrorText } from './ErrorText';

export interface VoicePick {
  product: VoiceProductDto;
  quantity: string;
}

const usableQty = (q: string, unit: Unit) =>
  quantityString.safeParse(q).success && isQuantityValidForUnit(q, unit) && !/^0*(\.0*)?$/.test(q);

interface LineState {
  productId: string | null;
  quantity: string;
  include: boolean;
}

function initialState(l: VoiceLineDto): LineState {
  const only = l.candidates.length === 1 ? l.candidates[0]! : null;
  return {
    productId: only?.product.id ?? null,
    quantity: only?.quantity ?? '',
    include: l.status !== 'NOT_FOUND',
  };
}

/**
 * Speech (or typed text) → reviewed cart lines. The server only suggests products from this store's
 * catalog; the cashier picks between look-alikes, fixes quantities, and the lines join the normal
 * cart — quoted by the server and confirmed by hand like any other bill.
 */
export function VoicePanel({ storeId, onAdd }: { storeId: string; onAdd: (picks: VoicePick[]) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as UiLanguage;
  const { user } = useAuth();
  const locale = user?.speechLocale ?? 'en-IN';

  const [config, setConfig] = useState<VoiceConfigDto | null>(null);
  const [transcript, setTranscript] = useState('');
  const [listening, setListening] = useState(false);
  const [micFailed, setMicFailed] = useState(false);
  const [result, setResult] = useState<VoiceParseDto | null>(null);
  const [state, setState] = useState<LineState[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => {
    let live = true;
    api
      .voiceConfig()
      .then((r) => live && setConfig(r.config))
      .catch(() => live && setConfig(null));
    return () => {
      live = false;
      rec.current?.stop();
    };
  }, []);

  // Compatibility check: the server's speech provider must support the user's speech locale, and
  // this browser must actually offer speech recognition. Otherwise the cashier types.
  const Ctor = recognitionCtor();
  const micAvailable = !!Ctor && !!config?.speech.locales.includes(locale) && !micFailed;

  function listen() {
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = locale;
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => setTranscript(transcriptOf(e).slice(0, MAX_TRANSCRIPT_CHARS));
    r.onerror = () => setMicFailed(true);
    r.onend = () => setListening(false);
    rec.current = r;
    setResult(null);
    setListening(true);
    try {
      r.start();
    } catch {
      setListening(false);
      setMicFailed(true);
    }
  }

  async function understand() {
    const text = transcript.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const { result: r } = await api.parseVoice(storeId, { transcript: text, locale });
      setResult(r);
      setState(r.lines.map(initialState));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const patch = (i: number, p: Partial<LineState>) =>
    setState((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const picks: VoicePick[] = result
    ? result.lines.flatMap((l, i) => {
        const s = state[i];
        const c = l.candidates.find((x) => x.product.id === s?.productId);
        return s?.include && c && usableQty(s.quantity, c.product.unit)
          ? [{ product: c.product, quantity: s.quantity }]
          : [];
      })
    : [];

  const productLabel = (p: VoiceProductDto) => (
    <>
      <bdi>{p.name}</bdi>
      {p.localNames[lang] && p.localNames[lang] !== p.name && (
        <>
          {' '}
          <bdi lang={lang} className="muted">
            {p.localNames[lang]}
          </bdi>
        </>
      )}
    </>
  );

  return (
    <section className="card voice" aria-labelledby="voice-title">
      <h2 id="voice-title">{t('voice.title')}</h2>
      <p className="muted">{t('voice.hint')}</p>
      <div className="voice-input">
        {micAvailable ? (
          <button
            type="button"
            className={listening ? 'btn-ghost' : ''}
            aria-pressed={listening}
            onClick={() => (listening ? rec.current?.stop() : listen())}
          >
            {listening ? t('voice.stop') : t('voice.listen')}
          </button>
        ) : (
          config && <p className="muted">{micFailed ? t('voice.micError') : t('voice.noMic')}</p>
        )}
        <label className="grow">
          {t('voice.transcript')}
          <textarea
            value={transcript}
            dir="auto"
            rows={2}
            maxLength={MAX_TRANSCRIPT_CHARS}
            onChange={(e) => setTranscript(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={busy || listening || !transcript.trim()}
          onClick={() => void understand()}
        >
          {t('voice.understand')}
        </button>
      </div>
      {listening && <p role="status">{t('voice.listening')}</p>}
      <ErrorText error={error} />

      {result && result.lines.length === 0 && <p role="status">{t('voice.nothing')}</p>}
      {result && result.lines.length > 0 && (
        <>
          <ul className="voice-lines">
            {result.lines.map((l, i) => {
              const s = state[i]!;
              const chosen = l.candidates.find((c) => c.product.id === s.productId);
              const unitName = chosen ? t(`units.${chosen.product.unit}`) : '';
              const problem = chosen?.problem;
              return (
                <li key={i} data-testid="voice-line">
                  <div>
                    <span className="muted">{t('voice.heard')}</span> <bdi dir="auto">{l.heard}</bdi>
                  </div>
                  {l.status === 'NOT_FOUND' && <p className="warn-text">{t('voice.notFound')}</p>}
                  {l.candidates.length > 1 && (
                    <fieldset>
                      <legend>{t('voice.whichOne')}</legend>
                      <div className="segmented">
                        {l.candidates.map((c) => (
                          <label key={c.product.id} className={s.productId === c.product.id ? 'on' : ''}>
                            <input
                              type="radio"
                              name={`voice-${i}`}
                              checked={s.productId === c.product.id}
                              onChange={() =>
                                patch(i, { productId: c.product.id, quantity: c.quantity ?? '' })
                              }
                            />
                            {productLabel(c.product)}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  {chosen && (
                    <div className="voice-pick">
                      {l.candidates.length === 1 && <strong>{productLabel(chosen.product)}</strong>}
                      <label>
                        <input
                          className="qty"
                          aria-label={`${t('voice.quantity')} ${l.heard}`}
                          inputMode="decimal"
                          dir="ltr"
                          value={s.quantity}
                          aria-invalid={!usableQty(s.quantity, chosen.product.unit)}
                          onChange={(e) => patch(i, { quantity: e.target.value.trim() })}
                        />{' '}
                        <span className="muted">{unitName}</span>
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={s.include}
                          onChange={(e) => patch(i, { include: e.target.checked })}
                        />
                        {t('voice.include')}
                      </label>
                    </div>
                  )}
                  {problem === 'NEEDS_QUANTITY' && !s.quantity && (
                    <p className="warn-text">{t('voice.needsQuantity')}</p>
                  )}
                  {problem === 'UNIT_MISMATCH' && (
                    <p className="warn-text">{t('voice.unitMismatch', { unit: unitName })}</p>
                  )}
                  {problem === 'INVALID_QUANTITY' && (
                    <p className="warn-text">{t('voice.invalidQuantity', { unit: unitName })}</p>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="actions">
            <button
              type="button"
              disabled={picks.length === 0}
              onClick={() => {
                onAdd(picks);
                setResult(null);
                setTranscript('');
              }}
            >
              {t('voice.addToBill', { n: picks.length })}
            </button>
          </p>
        </>
      )}
    </section>
  );
}
