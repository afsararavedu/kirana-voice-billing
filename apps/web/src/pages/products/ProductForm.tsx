import {
  FRACTIONAL_UNITS,
  GST_SLABS,
  LANGUAGE_NATIVE_NAMES,
  UNITS,
  type CreateProductRequest,
  type ProductDto,
  type Unit,
  type UpdateProductInput,
} from '@kirana/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorText } from '../../components/ErrorText';

const LOCAL_LANGS = ['hi', 'te', 'ur'] as const;

/** "5.00" → "5", "12.50" → "12.5" — string-only, so it matches the GST slab option values. */
const trimDecimal = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

const splitAliases = (s: string) =>
  s
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);

interface Props {
  /** Present when editing; unit and opening stock are then not editable. */
  product?: ProductDto;
  onSubmit: (body: CreateProductRequest | UpdateProductInput) => Promise<void>;
  submitLabel: string;
}

/**
 * Collects values as strings and sends them as strings: the server parses decimals exactly.
 * `inputMode="decimal"` gives a numeric keypad on phones without converting to a JS number.
 */
export function ProductForm({ product, onSubmit, submitLabel }: Props) {
  const { t } = useTranslation();
  const [unit, setUnit] = useState<Unit>(product?.unit ?? 'KG');
  const [taxRate, setTaxRate] = useState(product ? trimDecimal(product.taxRate) : '0');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const qtyPattern = FRACTIONAL_UNITS.has(unit) ? '\\d{1,9}(\\.\\d{1,3})?' : '\\d{1,9}';
  const slabs: string[] = [...GST_SLABS];
  if (!slabs.includes(taxRate)) slabs.push(taxRate);

  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const str = (k: string) => String(f.get(k) ?? '').trim();
    const localNames = Object.fromEntries(
      LOCAL_LANGS.flatMap((l) => (str(`name_${l}`) ? [[l, str(`name_${l}`)]] : [])),
    );
    const common = {
      name: str('name'),
      localNames,
      aliases: splitAliases(str('aliases')),
      sku: str('sku') || null,
      sellingPrice: str('sellingPrice'),
      taxRate,
      priceIncludesTax: f.get('priceIncludesTax') === 'on',
      lowStockThreshold: str('lowStockThreshold') || null,
    };
    const body = product
      ? { ...common, isActive: f.get('isActive') === 'on' }
      : { ...common, unit, openingStock: str('openingStock') || '0' };
    setBusy(true);
    setError(null);
    try {
      await onSubmit(body);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={handle}>
      <label>
        {t('product.name')}
        <input name="name" defaultValue={product?.name} dir="auto" maxLength={120} required />
      </label>
      <fieldset className="grid-3">
        {LOCAL_LANGS.map((l) => (
          <label key={l}>
            {t('product.localName', { lang: LANGUAGE_NATIVE_NAMES[l] })}
            <input
              name={`name_${l}`}
              lang={l}
              dir="auto"
              maxLength={120}
              defaultValue={product?.localNames[l]}
            />
          </label>
        ))}
      </fieldset>
      <label>
        {t('product.aliases')}
        <input
          name="aliases"
          dir="auto"
          defaultValue={product?.aliases.join(', ')}
          aria-describedby="alias-hint"
        />
        <small id="alias-hint">{t('product.aliasesHint')}</small>
      </label>

      <div className="grid-3">
        <label>
          {t('product.unit')}
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as Unit)}
            disabled={!!product}
            aria-describedby={product ? 'unit-locked' : undefined}
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {t(`units.${u}`)}
              </option>
            ))}
          </select>
          {product && <small id="unit-locked">{t('product.unitLocked')}</small>}
        </label>
        <label>
          {t('product.sellingPrice')}
          <input
            name="sellingPrice"
            inputMode="decimal"
            pattern="\d{1,10}(\.\d{1,2})?"
            dir="ltr"
            required
            defaultValue={product?.sellingPrice}
          />
        </label>
        <label>
          {t('product.taxRate')}
          <select value={taxRate} onChange={(e) => setTaxRate(e.target.value)}>
            {slabs.map((s) => (
              <option key={s} value={s}>
                {s}%
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="check">
        <input type="checkbox" name="priceIncludesTax" defaultChecked={product?.priceIncludesTax ?? true} />
        {t('product.priceIncludesTax')}
      </label>

      <div className="grid-3">
        <label>
          {t('product.sku')}
          <input name="sku" dir="ltr" maxLength={64} defaultValue={product?.sku ?? ''} />
        </label>
        {!product && (
          <label>
            {t('product.openingStock')}
            <input name="openingStock" inputMode="decimal" pattern={qtyPattern} dir="ltr" defaultValue="0" />
          </label>
        )}
        <label>
          {t('product.lowStockThreshold')}
          <input
            name="lowStockThreshold"
            inputMode="decimal"
            pattern={qtyPattern}
            dir="ltr"
            defaultValue={product?.lowStockThreshold ?? ''}
          />
        </label>
      </div>
      {product && (
        <label className="check">
          <input type="checkbox" name="isActive" defaultChecked={product.isActive} />
          {t('product.active')}
        </label>
      )}

      <ErrorText error={error} />
      <button type="submit" disabled={busy}>
        {submitLabel}
      </button>
    </form>
  );
}
