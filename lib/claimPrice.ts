// A claim-sale item's `price` is what it was listed at; `sold_price` is what the
// buyer actually paid when that differs (negotiated). Null sold_price = listed
// price. Totals, invoices, revenue, and the listing sync all use this.
export function claimPrice(i: { price: number | null; sold_price?: number | null }): number | null {
  const sp = i.sold_price;
  return sp !== null && sp !== undefined ? sp : i.price;
}

// Parse the sold-price input: blank → null (revert to listed price), else a
// non-negative dollar amount. Returns undefined for unparseable text.
export function parseSoldPriceInput(raw: string): number | null | undefined {
  const s = raw.replace(/[$,\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}
