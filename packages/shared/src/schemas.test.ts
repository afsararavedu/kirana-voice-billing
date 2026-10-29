import { describe, expect, it } from 'vitest';
import { textDirection } from './languages.js';
import { createStoreSchema, registerSchema, updateStoreSchema } from './schemas.js';

describe('registerSchema', () => {
  it('normalises email case and whitespace', () => {
    const parsed = registerSchema.parse({
      email: '  Owner@Example.COM ',
      password: 'correct horse battery',
      displayName: 'Ravi',
    });
    expect(parsed.email).toBe('owner@example.com');
    expect(parsed.uiLanguage).toBe('en');
  });

  it('rejects short passwords', () => {
    expect(registerSchema.safeParse({ email: 'a@b.in', password: 'short', displayName: 'x' }).success).toBe(
      false,
    );
  });

  it('rejects unsupported UI languages', () => {
    const r = registerSchema.safeParse({
      email: 'a@b.in',
      password: 'long enough password',
      displayName: 'x',
      uiLanguage: 'fr',
    });
    expect(r.success).toBe(false);
  });
});

describe('store schemas', () => {
  it('ignores unknown fields such as a client-supplied tenant id', () => {
    const parsed = createStoreSchema.parse({ name: 'Lakshmi Kirana', storeId: 'evil', ownerId: 'evil' });
    expect(parsed).toEqual({ name: 'Lakshmi Kirana', receiptLanguage: 'en' });
  });

  it('requires at least one field on update', () => {
    expect(updateStoreSchema.safeParse({}).success).toBe(false);
  });
});

describe('textDirection', () => {
  it('is rtl only for Urdu', () => {
    expect(textDirection('ur')).toBe('rtl');
    expect(textDirection('te')).toBe('ltr');
    expect(textDirection('hi')).toBe('ltr');
    expect(textDirection('en')).toBe('ltr');
  });
});
