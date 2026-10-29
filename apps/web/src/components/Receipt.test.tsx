import { UI_LANGUAGES, type ReceiptDto, type UiLanguage } from '@kirana/shared';
import { render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it } from 'vitest';
import i18n, { setUiLanguage } from '../i18n';
import { Receipt } from './Receipt';

/** Names as the server resolves them for each receipt language (local name, else catalog name). */
const NAMES: Record<UiLanguage, string> = {
  en: 'Toor Dal',
  hi: 'अरहर दाल',
  te: 'కంది పప్పు',
  ur: 'ارہر دال',
};

function fixture(language: UiLanguage): ReceiptDto {
  return {
    language,
    kind: 'TAX_INVOICE',
    seller: {
      name: 'Lakshmi Kirana',
      address: 'Main Road, Warangal',
      phone: '+91 98480 22338',
      gstin: '36AABCU9603R1ZO',
      footer: null,
    },
    invoiceNumber: 'LK/26-27/42',
    number: 42,
    // 09:15 UTC = 14:45 IST: receipts must show IST whatever the device's time zone.
    createdAt: '2026-10-29T09:15:00.000Z',
    cashier: 'Ravi',
    status: 'PARTIALLY_RETURNED',
    lines: [
      {
        lineNo: 1,
        name: NAMES[language],
        unit: 'KG',
        quantity: '2.000',
        unitPrice: '52.50',
        taxRate: '5.00',
        discountAmount: '0.00',
        lineTotal: '105.00',
      },
      {
        lineNo: 2,
        name: 'Soap',
        unit: 'PIECE',
        quantity: '2.000',
        unitPrice: '25.42',
        taxRate: '18.00',
        discountAmount: '1.00',
        lineTotal: '58.81',
      },
    ],
    taxSummary: [
      { rate: '5.00', taxableValue: '100.00', cgst: '2.50', sgst: '2.50', tax: '5.00' },
      { rate: '18.00', taxableValue: '49.84', cgst: '4.49', sgst: '4.48', tax: '8.97' },
    ],
    totals: { taxableTotal: '149.84', taxTotal: '13.97', discountTotal: '1.00', grandTotal: '163.81' },
    payments: [{ method: 'CASH', amount: '163.81', tendered: '200.00', change: '36.19' }],
    refundedTotal: '29.41',
    netTotal: '134.40',
  };
}

const renderReceipt = (r: ReceiptDto) =>
  render(
    <I18nextProvider i18n={i18n}>
      <Receipt receipt={r} />
    </I18nextProvider>,
  );

describe('Receipt', () => {
  beforeEach(() => setUiLanguage('en'));

  it.each(UI_LANGUAGES)('%s receipt matches its snapshot', (lang) => {
    const { container } = renderReceipt(fixture(lang));
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('prints in the receipt language, not the UI language, with Urdu right-to-left', async () => {
    await setUiLanguage('hi'); // the cashier uses the app in Hindi
    renderReceipt(fixture('ur'));
    const receipt = screen.getByTestId('receipt');
    expect(receipt).toHaveAttribute('lang', 'ur');
    expect(receipt).toHaveAttribute('dir', 'rtl');
    expect(within(receipt).getByText('ٹیکس انوائس')).toBeInTheDocument();
    expect(within(receipt).getByText('ارہر دال')).toBeInTheDocument();
    expect(within(receipt).queryByText('टैक्स इनवॉइस')).not.toBeInTheDocument();
    // Figures stay left-to-right inside the RTL receipt.
    const total = within(receipt).getByTestId('receipt-total');
    expect(total.querySelector('bdi')).toHaveAttribute('dir', 'ltr');
    expect(total).toHaveTextContent('₹163.81');
    expect(within(receipt).getByTestId('receipt-invoice')).toHaveTextContent('LK/26-27/42');
    expect(within(receipt).getByTestId('receipt-net')).toHaveTextContent('₹134.40');
  });

  it.each([
    ['en', 'Tax Invoice', 'Thank you! Please visit again.'],
    ['hi', 'टैक्स इनवॉइस', 'धन्यवाद! फिर पधारें।'],
    ['te', 'ట్యాక్స్ ఇన్వాయిస్', 'ధన్యవాదాలు! మళ్లీ రండి.'],
  ] as const)('%s receipt is left-to-right with translated labels', (lang, title, thanks) => {
    renderReceipt(fixture(lang));
    const receipt = screen.getByTestId('receipt');
    expect(receipt).toHaveAttribute('dir', 'ltr');
    expect(within(receipt).getByText(title)).toBeInTheDocument();
    expect(within(receipt).getByText(thanks)).toBeInTheDocument();
  });

  it('shows the store footer, a plain bill without GSTIN, and IST time', () => {
    const r = fixture('en');
    renderReceipt({
      ...r,
      kind: 'BILL',
      seller: { ...r.seller, gstin: null, footer: 'No exchange after 7 days' },
    });
    const receipt = screen.getByTestId('receipt');
    expect(within(receipt).getByText('Bill')).toBeInTheDocument();
    expect(within(receipt).queryByText(/GSTIN/)).not.toBeInTheDocument();
    expect(within(receipt).getByText('No exchange after 7 days')).toBeInTheDocument();
    expect(receipt).toHaveTextContent(/2:45\s?pm/i);
  });
});
