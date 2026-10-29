import { z } from 'zod';
import { gstinSchema, invoicePrefixSchema } from './invoice.js';
import { SPEECH_LOCALES, UI_LANGUAGES } from './languages.js';

export const STORE_ROLES = ['OWNER', 'MANAGER', 'CASHIER'] as const;
export type StoreRole = (typeof STORE_ROLES)[number];

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

// 12+ chars; length beats composition rules (NIST SP 800-63B). Upper bound guards the KDF.
const password = z.string().min(12).max(128);

export const registerSchema = z.object({
  email,
  password,
  displayName: z.string().trim().min(1).max(80),
  uiLanguage: z.enum(UI_LANGUAGES).default('en'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const updatePreferencesSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    uiLanguage: z.enum(UI_LANGUAGES),
    speechLocale: z.enum(SPEECH_LOCALES),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

export const createStoreSchema = z.object({
  name: z.string().trim().min(1).max(120),
  receiptLanguage: z.enum(UI_LANGUAGES).default('en'),
});
export type CreateStoreInput = z.infer<typeof createStoreSchema>;

/** Optional profile text: blank clears it (stored as null). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null)
    .nullable();
/** Blank or null clears the field; anything else must pass `schema`. */
const clearable = <T extends z.ZodType<string, string>>(schema: T) =>
  z.union([z.literal('').transform(() => null), z.null(), schema]);

export const updateStoreSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    receiptLanguage: z.enum(UI_LANGUAGES),
    /** Seller details printed on receipts (required on a GST tax invoice). */
    address: optionalText(300),
    phone: clearable(
      z
        .string()
        .trim()
        .regex(/^\+?[0-9][0-9 -]{5,18}$/, 'Expected a phone number'),
    ),
    gstin: clearable(gstinSchema),
    /** Start of every invoice number, e.g. "LK" → LK/26-27/1. Locked once this year has a bill. */
    invoicePrefix: clearable(invoicePrefixSchema),
    receiptFooter: optionalText(200),
  })
  .strict()
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;
export type UpdateStoreRequest = z.input<typeof updateStoreSchema>;

export const uuidParam = z.uuid();

/** Response DTOs — what the API promises to return. */
export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  uiLanguage: (typeof UI_LANGUAGES)[number];
  speechLocale: (typeof SPEECH_LOCALES)[number];
}

export interface StoreDto {
  id: string;
  name: string;
  currency: string;
  receiptLanguage: (typeof UI_LANGUAGES)[number];
  address: string | null;
  phone: string | null;
  gstin: string | null;
  invoicePrefix: string | null;
  receiptFooter: string | null;
  role: StoreRole;
  createdAt: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}
