import { MAX_VOICE_ITEMS, type Extraction, type ExtractedItem, type Unit } from '@kirana/shared';
import { dec } from '../../lib/decimal.js';
import type { VoiceExtractor } from './extractor.js';

/**
 * Deterministic extractor for spoken kirana orders in English, Hindi, Telugu and Urdu (native script
 * and common romanised forms): "2 kilo chawal, ek packet doodh aur aadha kilo cheeni".
 * Needs no network and no key. It finds a quantity, a unit and the remaining words as the name;
 * catalog matching, unit conversion and clarification happen afterwards on the server.
 */

/** Spoken numbers. Keys are matched after lower-casing and NFKC. */
// prettier-ignore
const NUMBER_WORDS: Record<string, string> = {
  // English
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  ten: '10', eleven: '11', twelve: '12', half: '0.5', quarter: '0.25', a: '1', an: '1',
  // Hindi / Urdu, romanised
  ek: '1', teen: '3', char: '4', chaar: '4', paanch: '5', panch: '5', chhe: '6', chhah: '6',
  saat: '7', aath: '8', das: '10', aadha: '0.5', adha: '0.5', aadhi: '0.5', dedh: '1.5',
  derh: '1.5', dhai: '2.5', dhaai: '2.5', paav: '0.25', pav: '0.25',
  // Hindi
  एक: '1', तीन: '3', चार: '4', पांच: '5', पाँच: '5', छह: '6', छः: '6', सात: '7',
  आठ: '8', नौ: '9', दस: '10', आधा: '0.5', आधी: '0.5', डेढ़: '1.5', ढाई: '2.5', पाव: '0.25',
  // Telugu
  ఒకటి: '1', ఒక: '1', రెండు: '2', మూడు: '3', నాలుగు: '4', ఐదు: '5', ఆరు: '6', ఏడు: '7',
  ఎనిమిది: '8', తొమ్మిది: '9', పది: '10', అర: '0.5', పావు: '0.25', ఒకటిన్నర: '1.5',
  // Urdu ("two" is handled with its homonym "give", see TWO_OR_GIVE)
  ایک: '1', تین: '3', چار: '4', پانچ: '5', چھ: '6', سات: '7', آٹھ: '8', نو: '9',
  دس: '10', آدھا: '0.5', آدھی: '0.5', ڈیڑھ: '1.5', ڈھائی: '2.5', پاؤ: '0.25',
};

// prettier-ignore
const UNIT_WORDS: Record<string, Unit> = {
  kg: 'KG', kgs: 'KG', kilo: 'KG', kilos: 'KG', kilogram: 'KG', kilograms: 'KG', किलो: 'KG',
  किलोग्राम: 'KG', కిలో: 'KG', కిలోలు: 'KG', కిలోల: 'KG', కేజీ: 'KG', కేజీలు: 'KG', کلو: 'KG',
  کلوگرام: 'KG',
  g: 'G', gm: 'G', gms: 'G', gram: 'G', grams: 'G', ग्राम: 'G', గ్రాము: 'G', గ్రాములు: 'G',
  గ్రాముల: 'G', گرام: 'G',
  l: 'L', ltr: 'L', litre: 'L', liter: 'L', litres: 'L', liters: 'L', लीटर: 'L', लिटर: 'L',
  లీటర్: 'L', లీటరు: 'L', లీటర్లు: 'L', لیٹر: 'L',
  ml: 'ML', मिलीलीटर: 'ML', ملی: 'ML',
  pack: 'PACK', packs: 'PACK', packet: 'PACK', packets: 'PACK', pkt: 'PACK', पैकेट: 'PACK',
  ప్యాకెట్: 'PACK', ప్యాకెట్లు: 'PACK', پیکٹ: 'PACK',
  dozen: 'DOZEN', darjan: 'DOZEN', दर्जन: 'DOZEN', డజను: 'DOZEN', డజన్: 'DOZEN', درجن: 'DOZEN',
  piece: 'PIECE', pieces: 'PIECE', pc: 'PIECE', pcs: 'PIECE', nag: 'PIECE', पीस: 'PIECE',
  नग: 'PIECE', ముక్క: 'PIECE', ముక్కలు: 'PIECE', عدد: 'PIECE', پیس: 'PIECE',
};

/** "10 rupees of chilli": a money amount, not a quantity. Prices never come from speech. */
// prettier-ignore
const MONEY_WORDS = new Set([
  'rs', 'rupee', 'rupees', 'rupay', 'rupaye', 'रुपये', 'रुपए', 'रुपया', 'रूपये', 'రూపాయలు',
  'రూపాయల', 'రూపాయి', 'روپے', 'روپیہ', '₹',
]);

/** Politeness and filler that is never part of a product name. */
// prettier-ignore
const FILLER = new Set([
  'please', 'give', 'me', 'add', 'of', 'the', 'and', 'want', 'need', 'dena', 'dijiye', 'de',
  'chahiye', 'ka', 'ki', 'ke', 'aur', 'देना', 'दीजिए', 'दे', 'चाहिए', 'का', 'की', 'के', 'और',
  'ఇవ్వండి', 'ఇవ్వు', 'కావాలి', 'మరియు', 'دیں', 'دے', 'چاہیے', 'کا', 'کی', 'کے', 'اور',
]);

/**
 * "do"/"दो"/"دو" is both "two" and the verb in "de do" (give). It is the verb after "de/दे/دے" or
 * at the end of a phrase ("chawal de do"); otherwise the number ("do kilo chawal").
 */
const TWO_OR_GIVE = new Set(['do', 'दो', 'دو']);
const GIVE_PREFIX = new Set(['de', 'दे', 'دے']);

/** Item separators: punctuation (incl. Devanagari danda and Arabic comma) and spoken "and". */
const SEPARATOR = /[,;\n|।،]+|\s+(?:and|aur|plus|और|మరియు|اور)\s+/u;

const DIGIT_ZEROS = [0x0966, 0x0c66, 0x0660, 0x06f0]; // Devanagari, Telugu, Arabic-Indic, Persian
const ZERO_WIDTH = new RegExp(
  `[${[0x200b, 0x200c, 0x200d, 0xfeff].map((c) => String.fromCharCode(c)).join('')}]`,
  'g',
);

function toAsciiDigits(s: string): string {
  return s.replace(/\p{Nd}/gu, (d) => {
    const c = d.codePointAt(0)!;
    const zero = DIGIT_ZEROS.find((z) => c >= z && c <= z + 9);
    return zero === undefined ? d : String(c - zero);
  });
}

const QTY_RE = /^\d{1,9}(\.\d{1,3})?$/;

/** "1.50" → "1.5", "1/2" → "0.5"; null when not a usable quantity (too precise, too large, zero). */
function quantityOf(token: string): string | null {
  let d;
  const frac = /^(\d+)\/(\d+)$/.exec(token);
  if (frac) {
    if (frac[2] === '0' || /^0+$/.test(frac[2]!)) return null;
    d = dec(frac[1]!).dividedBy(dec(frac[2]!));
  } else if (/^\d+(\.\d+)?$/.test(token)) {
    d = dec(token);
  } else {
    return null;
  }
  if (d.lte(0) || !d.toDecimalPlaces(3).equals(d)) return null;
  const s = d.toFixed();
  return QTY_RE.test(s) ? s : null;
}

function parseSegment(segment: string): ExtractedItem | null {
  const tokens = segment.match(/\d+(?:[./]\d+)?[a-z]*|[^\s\d]+/gu) ?? [];
  const nameParts: string[] = [];
  const quantities: string[] = [];
  let unit: Unit | null = null;
  let money = false;

  const clean = (t: string | undefined) => (t ?? '').replace(/[\p{P}\p{S}]+/gu, '');
  for (const [i, raw] of tokens.entries()) {
    if (TWO_OR_GIVE.has(clean(raw))) {
      const isVerb = i === tokens.length - 1 || GIVE_PREFIX.has(clean(tokens[i - 1]));
      if (!isVerb) quantities.push('2');
      continue;
    }
    const fused = /^(\d+(?:[./]\d+)?)([a-z]+)$/.exec(raw);
    if (fused && UNIT_WORDS[fused[2]!]) {
      quantities.push(fused[1]!);
      unit ??= UNIT_WORDS[fused[2]!]!;
      continue;
    }
    if (/^\d/.test(raw)) {
      quantities.push(raw);
      continue;
    }
    const word = raw.replace(/[\p{P}\p{S}]+/gu, (m) => (m === '₹' ? m : ''));
    if (!word) continue;
    if (MONEY_WORDS.has(word)) {
      money = true;
    } else if (UNIT_WORDS[word]) {
      unit ??= UNIT_WORDS[word]!;
    } else if (NUMBER_WORDS[word] !== undefined && !(word.length === 1 && nameParts.length > 0)) {
      quantities.push(NUMBER_WORDS[word]!);
    } else if (!FILLER.has(word)) {
      nameParts.push(word);
    }
  }

  const name = nameParts.join(' ').slice(0, 80).trim();
  if (!name) return null;
  // A money amount, or two different numbers, means we cannot tell the quantity: ask.
  const distinct = [...new Set(quantities)];
  let quantity: string | null = null;
  if (!money && distinct.length === 1) quantity = quantityOf(distinct[0]!);
  else if (!money && distinct.length === 0 && unit) quantity = '1';
  return { name, quantity, unit: money ? null : unit };
}

export function extractByRules(transcript: string): Extraction {
  const text = toAsciiDigits(transcript.normalize('NFKC').replace(ZERO_WIDTH, '').toLowerCase());
  const items = text
    .split(SEPARATOR)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseSegment)
    .filter((i): i is ExtractedItem => i !== null)
    .slice(0, MAX_VOICE_ITEMS);
  return { items };
}

export const ruleExtractor: VoiceExtractor = {
  name: 'rules',
  model: null,
  extract: async ({ transcript }) => extractByRules(transcript),
};
