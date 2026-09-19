// ---------------------------------------------------------------------------
// Invoice message template
//
// The buyer-facing text produced on the Invoices tab. The seller owns the
// wording: the message is a template of literal text plus {placeholders} that
// get filled in per buyer, so greetings, wording and the order of the blocks
// can be changed without touching code.
//
// Placeholders follow the same {token} convention as the auction post
// templates in lib/fbAuctionText.ts.
// ---------------------------------------------------------------------------

// The stock wording — also what "Reset to default" restores. This reproduces
// the message the tab produced before the template was editable.
export const DEFAULT_INVOICE_MESSAGE = `Hi {name}!

{intro}

{items}

Subtotal: {subtotal}
Shipping: {shipping}
Total:    {total}

{payment}

Thanks!`;

// Everything a message can be built from. Values are pre-formatted strings
// (money already rendered as currency, lists already joined) so the template
// layer stays free of formatting decisions.
export type InvoiceMessageInput = {
  name: string;
  fbHandle: string | null;
  itemLines: string[];      // one per card, already labelled + priced
  saleTitles: string[];     // the distinct sales this invoice covers
  itemCount: number;
  subtotal: string;
  shipping: string;
  total: string;
  payment: string;          // the seller's payment instructions block
  address: string;          // buyer's mailing address, blank if unknown
  saleDates: string;        // single date, or the span the wins came from
};

// The opening sentence: one sale reads naturally with its title, several read
// better as a count. Exposed as its own {intro} token so a seller who wants
// their own wording can drop it and use {sale}/{sale_count} directly.
function introLine(input: InvoiceMessageInput): string {
  if (input.saleTitles.length === 1) {
    return `Combined invoice for your wins on "${input.saleTitles[0]}":`;
  }
  if (input.saleTitles.length === 0) return 'Here is your combined invoice:';
  return `Here's your combined invoice across ${input.saleTitles.length} sales:`;
}

export function invoiceMessageVars(input: InvoiceMessageInput): Record<string, string> {
  return {
    name: input.name,
    handle: input.fbHandle || '',
    intro: introLine(input),
    items: input.itemLines.join('\n'),
    item_count: String(input.itemCount),
    sale: input.saleTitles[0] || '',
    sale_list: input.saleTitles.map(t => `· ${t}`).join('\n'),
    sale_count: String(input.saleTitles.length),
    sale_dates: input.saleDates,
    subtotal: input.subtotal,
    shipping: input.shipping,
    total: input.total,
    payment: input.payment.trim(),
    address: input.address,
  };
}

// What the editor lists next to the template box. Kept beside the vars above so
// the two can't drift apart.
export const INVOICE_MESSAGE_VARIABLES: { key: string; desc: string }[] = [
  { key: '{name}', desc: 'Buyer name' },
  { key: '{handle}', desc: 'Buyer Facebook handle' },
  { key: '{intro}', desc: 'Auto-worded opening line (names the sale, or counts them)' },
  { key: '{items}', desc: 'The cards, one per line, with prices' },
  { key: '{item_count}', desc: 'How many cards are on the invoice' },
  { key: '{sale}', desc: 'Title of the sale (the first one, if several)' },
  { key: '{sale_list}', desc: 'Every sale the wins came from, one per line' },
  { key: '{sale_count}', desc: 'How many sales the invoice covers' },
  { key: '{sale_dates}', desc: 'Date of the sale, or the span they cover' },
  { key: '{subtotal}', desc: 'Sum of the winning bids / claim prices' },
  { key: '{shipping}', desc: 'Combined shipping you entered for this buyer' },
  { key: '{total}', desc: 'Subtotal + shipping' },
  { key: '{payment}', desc: 'Your payment instructions' },
  { key: '{address}', desc: "Buyer's mailing address, if you have it" },
];

const TOKEN = /\{(\w+)\}/g;

// Fill a template. Unknown placeholders are left visible ({foo} stays {foo}) so
// a typo shows up in the preview instead of silently eating text — the same
// behaviour as the auction post templates.
//
// A line whose only content is placeholders that all came back empty is
// dropped: with no payment instructions saved, `{payment}` shouldn't leave a
// stray blank line in the middle of the message. Runs of blank lines left
// behind are collapsed to one.
export function renderInvoiceMessage(template: string, vars: Record<string, string>): string {
  const kept: string[] = [];
  for (const line of template.split('\n')) {
    let sawKnownToken = false;
    let sawValue = false;
    const filled = line.replace(TOKEN, (raw, key: string) => {
      if (!(key in vars)) return raw;
      sawKnownToken = true;
      const v = vars[key] ?? '';
      if (v.trim()) sawValue = true;
      return v;
    });
    const literal = line.replace(TOKEN, (raw, key: string) => (key in vars ? '' : raw));
    if (sawKnownToken && !sawValue && !literal.trim()) continue;
    kept.push(filled.replace(/[ \t]+$/, ''));
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// A stand-in buyer for the template editor's preview, so the seller can see
// their wording rendered before any real invoice exists.
export const SAMPLE_INVOICE_INPUT: InvoiceMessageInput = {
  name: 'Sample Buyer',
  fbHandle: 'sample.buyer',
  itemLines: [
    '· 2023 Topps Chrome #150 Julio Rodriguez — $24.00',
    '· 2021 Bowman #BDC-100 Gunnar Henderson — $18.00',
  ],
  saleTitles: ['Sunday Night Auction'],
  itemCount: 2,
  subtotal: '$42.00',
  shipping: '$5.00',
  total: '$47.00',
  payment: 'PayPal G&S to: your-paypal@email.com',
  address: '123 Main St\nAnytown, WA, 98101',
  saleDates: 'Sep 14, 2026',
};
