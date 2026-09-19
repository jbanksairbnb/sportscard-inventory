'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { applyListingSale } from '@/lib/listingStatusSync';
import {
  DEFAULT_INVOICE_MESSAGE,
  INVOICE_MESSAGE_VARIABLES,
  SAMPLE_INVOICE_INPUT,
  invoiceMessageVars,
  renderInvoiceMessage,
  type InvoiceMessageInput,
} from '@/lib/invoiceMessage';
import SCLogo from '@/components/SCLogo';

// ---------------------------------------------------------------------------
// Invoices tab
//
// A person-first roll-up over every ended auction + claim sale: instead of
// opening each bidder one at a time, this lists ONE combined invoice per buyer
// covering all of their unpaid wins across every sale. Marking an invoice paid
// flips the underlying lots/claim items to paid AND syncs the listings to Sold,
// so the ended-auction totals and the My Listings buckets update in lock step.
//
// Open invoices are computed live from the lots/claim items (the source of
// truth for "paid"), so there is nothing separate to keep in sync and no drift.
// ---------------------------------------------------------------------------

type Bidder = {
  id: string;
  name: string;
  fb_handle: string | null;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
};

type ListingRef = {
  id: string;
  title: string | null;
  year: number | null;
  brand: string | null;
  card_number: string | null;
  player: string | null;
  tag_number: string | null;
  photos: string[] | null;
};

type LotRow = {
  id: string;
  auction_id: string;
  lot_number: number | null;
  current_bid: number | null;
  bidder_name: string | null;
  bidder_fb_handle: string | null;
  bidder_id: string | null;
  listing_id: string | null;
  status: 'open' | 'sold' | 'no_sale' | 'paid';
};

type ClaimItemRow = {
  id: string;
  lot_id: string;
  listing_id: string | null;
  price: number | null;
  claim_buyer_id: string | null;
  claim_buyer_name: string | null;
  claim_status: 'open' | 'claimed' | 'sold' | 'paid';
};

type ClaimLotRow = { id: string; sale_id: string; lot_number: number | null };
type SourceRef = { id: string; title: string | null; post_url: string | null; ends_at: string | null; created_at: string | null };

// A single billable card on an invoice.
type InvoiceLine = {
  key: string; // auction lot id OR claim item id — used for the paid fan-out
  kind: 'auction' | 'claim';
  sourceId: string;
  sourceTitle: string;
  sourceUrl: string | null; // the sale's Facebook post URL, if saved
  sourceDate: string | null; // when the sale happened (ended, else created)
  label: string; // composed card description
  tag: string | null; // seller's inventory tag
  amount: number;
  listing: ListingRef | null; // for the photo lightbox
};

// One buyer's combined invoice across every sale.
type Invoice = {
  bidderKey: string;
  bidder: Bidder | null;
  bidderId: string | null;
  name: string;
  fbHandle: string | null;
  lines: InvoiceLine[];
  subtotal: number;
  paid: boolean;
  // Span of the sales this invoice covers, in epoch ms — drives the date
  // sorts. Null when none of the buyer's sales carry a usable date.
  firstSaleAt: number | null;
  lastSaleAt: number | null;
};

// How the invoice list is ordered. `amount` is the long-standing default.
const SORTS = ['amount', 'newest', 'oldest', 'name'] as const;
type Sort = typeof SORTS[number];
const SORT_LABELS: Record<Sort, string> = {
  amount: 'Amount (high → low)',
  newest: 'Sale date (newest first)',
  oldest: 'Sale date (oldest first)',
  name: 'Customer (A → Z)',
};

const PAYMENT_STORAGE_KEY = 'sc_invoice_payment_default';
const DEFAULT_PAYMENT = 'PayPal G&S to: your-paypal@email.com\nVenmo: @your-venmo';
// The seller's own wording for the buyer message, remembered like the payment
// instructions above.
const MESSAGE_STORAGE_KEY = 'sc_invoice_message_template';

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

// A sale's date: when it ended, falling back to when it was created for the
// sales that were never given an end time.
function saleDateOf(s: SourceRef | null | undefined): string | null {
  return s?.ends_at || s?.created_at || null;
}

function saleTime(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function fmtDate(when: string | number | null): string {
  const t = typeof when === 'number' ? when : saleTime(when);
  if (t === null) return '';
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Order the rendered list. Date sorts use the buyer's newest sale (newest
// first) or oldest sale (oldest first); invoices with no usable date sort last
// either way, and amount is the tie-breaker everywhere.
function compareInvoices(a: Invoice, b: Invoice, sort: Sort): number {
  if (sort === 'name') {
    const n = a.name.localeCompare(b.name);
    if (n !== 0) return n;
  } else if (sort === 'newest' || sort === 'oldest') {
    const ta = sort === 'newest' ? a.lastSaleAt : a.firstSaleAt;
    const tb = sort === 'newest' ? b.lastSaleAt : b.firstSaleAt;
    if (ta === null || tb === null) {
      if (ta !== tb) return ta === null ? 1 : -1;
    } else if (ta !== tb) {
      return sort === 'newest' ? tb - ta : ta - tb;
    }
  }
  return b.subtotal - a.subtotal;
}

// Record the span of sale dates an invoice covers, so the date sorts don't
// have to re-walk every line.
function stampSaleDates(inv: Invoice): void {
  let first: number | null = null;
  let last: number | null = null;
  for (const l of inv.lines) {
    const t = saleTime(l.sourceDate);
    if (t === null) continue;
    if (first === null || t < first) first = t;
    if (last === null || t > last) last = t;
  }
  inv.firstSaleAt = first;
  inv.lastSaleAt = last;
}

function cardSummary(r: ListingRef | null): string {
  if (!r) return '(card details missing)';
  const parts = [
    r.year ? String(r.year) : '',
    r.brand || '',
    r.card_number ? `#${r.card_number}` : '',
    r.player || '',
  ].filter(Boolean);
  return parts.join(' ').trim() || r.title || '(card details missing)';
}

// Numeric value of a card number for ordinal sorting: pull the first run of
// digits so "23" < "150" and prefixed numbers like "BDC-100" still order by
// their number. Missing/non-numeric card numbers sort last.
function cardNumberOrdinal(cardNumber: string | null | undefined): number {
  if (!cardNumber) return Number.POSITIVE_INFINITY;
  const m = cardNumber.match(/\d+/);
  return m ? Number.parseInt(m[0], 10) : Number.POSITIVE_INFINITY;
}

// Default line order within an invoice: Auction/source (alphabetical, matching
// the group headers), then Year (ascending), then Card # as an ordinal number,
// with the raw card number and card label as stable tie-breakers. Sorting the
// lines once here keeps the on-screen list and the copied invoice text in sync.
function compareInvoiceLines(a: InvoiceLine, b: InvoiceLine): number {
  const src = a.sourceTitle.localeCompare(b.sourceTitle);
  if (src !== 0) return src;
  const ya = a.listing?.year ?? Number.POSITIVE_INFINITY;
  const yb = b.listing?.year ?? Number.POSITIVE_INFINITY;
  if (ya !== yb) return ya - yb;
  const ca = cardNumberOrdinal(a.listing?.card_number);
  const cb = cardNumberOrdinal(b.listing?.card_number);
  if (ca !== cb) return ca - cb;
  const rawa = a.listing?.card_number || '';
  const rawb = b.listing?.card_number || '';
  if (rawa !== rawb) return rawa.localeCompare(rawb);
  return a.label.localeCompare(b.label);
}

// Stable identity for a buyer: prefer the linked profile id, fall back to a
// normalized name so unlinked wins from the same person still group together.
function bidderKeyOf(id: string | null | undefined, name: string | null | undefined): string | null {
  if (id) return `id:${id}`;
  const n = (name || '').trim().toLowerCase();
  return n ? `name:${n}` : null;
}

// One-line date summary for a buyer's card: a single date, or the span when
// their wins came from sales on different days.
function saleDateSummary(inv: Invoice): string {
  const first = fmtDate(inv.firstSaleAt);
  const last = fmtDate(inv.lastSaleAt);
  if (!first && !last) return '';
  if (!first || !last || first === last) return first || last;
  return `${first} – ${last}`;
}

function fullAddress(b: Bidder | null): string {
  if (!b) return '';
  const parts = [
    b.address_line1,
    b.address_line2,
    [b.city, b.state, b.postal_code].filter(Boolean).join(', '),
    b.country,
  ].filter(Boolean) as string[];
  return parts.join('\n');
}

export default function InvoicesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState('');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [tab, setTab] = useState<'open' | 'paid'>('open');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('amount');

  // Per-invoice combined shipping, keyed by bidderKey (local to this session —
  // set when you generate the invoice to send, then mark it paid).
  const [shipping, setShipping] = useState<Record<string, string>>({});
  // Payment instructions default is shared across invoices and remembered.
  const [payment, setPayment] = useState<string>(DEFAULT_PAYMENT);
  // The message template every invoice is rendered from — shared across
  // invoices and remembered, same as the payment block.
  const [template, setTemplate] = useState<string>(DEFAULT_INVOICE_MESSAGE);
  const [editingTemplate, setEditingTemplate] = useState(false);
  // One-off edits to a single buyer's message, keyed by bidderKey. These are
  // local to the session: the template is what persists. `base` is the text the
  // edit started from, so a later shipping change can be spotted and the buyer
  // never gets a hand-edited message carrying a stale total.
  const [drafts, setDrafts] = useState<Record<string, { text: string; base: string }>>({});
  const [editingDraft, setEditingDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [marking, setMarking] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<InvoiceLine | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(PAYMENT_STORAGE_KEY);
      if (saved) setPayment(saved);
      const savedMsg = localStorage.getItem(MESSAGE_STORAGE_KEY);
      if (savedMsg) setTemplate(savedMsg);
    } catch {}
  }, []);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setUserId(user.id);

      // Pull every committed lot + claim item for this seller. 'sold'/'claimed'
      // = won-but-unpaid (open invoice); 'paid' = settled (paid tab).
      const [lotRes, claimRes, bidderRes] = await Promise.all([
        supabase
          .from('fb_auction_lots')
          .select('id, auction_id, lot_number, current_bid, bidder_name, bidder_fb_handle, bidder_id, listing_id, status')
          .eq('user_id', user.id)
          .in('status', ['sold', 'paid']),
        supabase
          .from('fb_claim_sale_items')
          .select('id, lot_id, listing_id, price, claim_buyer_id, claim_buyer_name, claim_status')
          .eq('user_id', user.id)
          .in('claim_status', ['claimed', 'sold', 'paid']),
        supabase
          .from('fb_bidders')
          .select('id, name, fb_handle, email, phone, address_line1, address_line2, city, state, postal_code, country')
          .eq('user_id', user.id),
      ]);

      const lots = (lotRes.data || []) as LotRow[];
      const claims = (claimRes.data || []) as ClaimItemRow[];
      const bidders = (bidderRes.data || []) as Bidder[];
      const bidderById = new Map(bidders.map(b => [b.id, b]));

      // Resolve source titles + listing details (incl. photos) in bulk.
      const auctionIds = Array.from(new Set(lots.map(l => l.auction_id).filter(Boolean)));
      const claimLotIds = Array.from(new Set(claims.map(c => c.lot_id).filter(Boolean)));
      const listingIds = Array.from(new Set([
        ...lots.map(l => l.listing_id),
        ...claims.map(c => c.listing_id),
      ].filter((v): v is string => !!v)));

      // Sale rows carry the date shown on each invoice. `ends_at` is a newer
      // column, so fall back to created_at alone rather than losing the sale
      // titles and post links entirely if the select can't resolve it.
      async function fetchSources(table: 'fb_auctions' | 'fb_claim_sales', ids: string[]): Promise<SourceRef[]> {
        if (!ids.length) return [];
        const res = await supabase.from(table).select('id, title, post_url, ends_at, created_at').in('id', ids);
        if (!res.error) return (res.data || []) as SourceRef[];
        const fallback = await supabase.from(table).select('id, title, post_url, created_at').in('id', ids);
        return ((fallback.data || []) as Omit<SourceRef, 'ends_at'>[]).map(r => ({ ...r, ends_at: null }));
      }

      const [auctionSources, claimLotRes, listingRes] = await Promise.all([
        fetchSources('fb_auctions', auctionIds),
        claimLotIds.length
          ? supabase.from('fb_claim_sale_lots').select('id, sale_id, lot_number').in('id', claimLotIds)
          : Promise.resolve({ data: [] as ClaimLotRow[] }),
        listingIds.length
          ? supabase.from('listings').select('id, title, year, brand, card_number, player, tag_number, photos').in('id', listingIds)
          : Promise.resolve({ data: [] as ListingRef[] }),
      ]);

      const auctionsById = new Map(auctionSources.map(a => [a.id, a]));
      const claimLotsById = new Map(((claimLotRes.data || []) as ClaimLotRow[]).map(l => [l.id, l]));
      const listingsById = new Map(((listingRes.data || []) as ListingRef[]).map(l => [l.id, l]));

      // Resolve claim-sale titles from the lots' sale_ids.
      const saleIds = Array.from(new Set(((claimLotRes.data || []) as ClaimLotRow[]).map(l => l.sale_id)));
      const saleRows = await fetchSources('fb_claim_sales', saleIds);
      const salesById = new Map(saleRows.map(s => [s.id, s]));

      // Build invoices keyed by buyer, split into paid vs unpaid buckets.
      const byKey = new Map<string, { paid: Invoice; open: Invoice }>();
      function bucket(key: string, id: string | null, name: string, handle: string | null) {
        if (!byKey.has(key)) {
          const bidder = id ? bidderById.get(id) || null : null;
          const mk = (paid: boolean): Invoice => ({
            bidderKey: `${key}:${paid ? 'paid' : 'open'}`,
            bidder, bidderId: id, name, fbHandle: handle, lines: [], subtotal: 0, paid,
            firstSaleAt: null, lastSaleAt: null,
          });
          byKey.set(key, { paid: mk(true), open: mk(false) });
        }
        return byKey.get(key)!;
      }

      for (const l of lots) {
        const key = bidderKeyOf(l.bidder_id, l.bidder_name);
        if (!key) continue;
        const b = l.bidder_id ? bidderById.get(l.bidder_id) : null;
        const name = b?.name || l.bidder_name || 'Unknown buyer';
        const target = bucket(key, l.bidder_id, name, b?.fb_handle || l.bidder_fb_handle || null);
        const listing = l.listing_id ? listingsById.get(l.listing_id) || null : null;
        const line: InvoiceLine = {
          key: l.id,
          kind: 'auction',
          sourceId: l.auction_id,
          sourceTitle: auctionsById.get(l.auction_id)?.title || 'Auction',
          sourceUrl: auctionsById.get(l.auction_id)?.post_url || null,
          sourceDate: saleDateOf(auctionsById.get(l.auction_id)),
          label: cardSummary(listing),
          tag: listing?.tag_number || null,
          amount: l.current_bid || 0,
          listing,
        };
        const inv = l.status === 'paid' ? target.paid : target.open;
        inv.lines.push(line);
        inv.subtotal += line.amount;
      }

      for (const c of claims) {
        const key = bidderKeyOf(c.claim_buyer_id, c.claim_buyer_name);
        if (!key) continue;
        const b = c.claim_buyer_id ? bidderById.get(c.claim_buyer_id) : null;
        const name = b?.name || c.claim_buyer_name || 'Unknown buyer';
        const target = bucket(key, c.claim_buyer_id, name, b?.fb_handle || null);
        const lot = claimLotsById.get(c.lot_id);
        const sale = lot ? salesById.get(lot.sale_id) : undefined;
        const listing = c.listing_id ? listingsById.get(c.listing_id) || null : null;
        const line: InvoiceLine = {
          key: c.id,
          kind: 'claim',
          sourceId: lot?.sale_id || '',
          sourceTitle: sale?.title || 'Claim Sale',
          sourceUrl: sale?.post_url || null,
          sourceDate: saleDateOf(sale),
          label: cardSummary(listing),
          tag: listing?.tag_number || null,
          amount: c.price || 0,
          listing,
        };
        const inv = c.claim_status === 'paid' ? target.paid : target.open;
        inv.lines.push(line);
        inv.subtotal += line.amount;
      }

      const all: Invoice[] = [];
      for (const { paid, open } of byKey.values()) {
        // Default line order: Auction -> Year -> Card # (ordinal). Applied once
        // so the rendered list and the copied invoice text stay consistent.
        open.lines.sort(compareInvoiceLines);
        paid.lines.sort(compareInvoiceLines);
        stampSaleDates(open);
        stampSaleDates(paid);
        if (open.lines.length) all.push(open);
        if (paid.lines.length) all.push(paid);
      }
      setInvoices(all);
      setLoading(false);
    }
    load();
  }, [router]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices
      .filter(inv =>
        inv.paid === (tab === 'paid') &&
        (!q || inv.name.toLowerCase().includes(q) || (inv.fbHandle || '').toLowerCase().includes(q))
      )
      .sort((a, b) => compareInvoices(a, b, sort));
  }, [invoices, tab, search, sort]);

  const openInvoices = useMemo(() => invoices.filter(i => !i.paid), [invoices]);
  const summary = useMemo(() => {
    let outstanding = 0;
    for (const i of openInvoices) outstanding += i.subtotal;
    return { count: openInvoices.length, outstanding };
  }, [openInvoices]);

  // Live preview for the template editor: the first open invoice if there is
  // one (so the seller sees their real wording on real cards), otherwise a
  // stand-in buyer.
  const previewSubject = openInvoices[0]?.name || SAMPLE_INVOICE_INPUT.name;
  const previewText = useMemo(() => {
    const input = openInvoices[0]
      ? messageInput(openInvoices[0])
      : { ...SAMPLE_INVOICE_INPUT, payment };
    return renderInvoiceMessage(template, invoiceMessageVars(input));
    // messageInput reads the live shipping/payment state, so those belong in
    // the dependency list even though the function identity isn't stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, openInvoices, payment, shipping]);

  function shipValue(inv: Invoice): number {
    const raw = shipping[inv.bidderKey];
    const n = raw === undefined ? 0 : Number.parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
  }

  // Everything the message template can draw on for one buyer, already
  // formatted. The lines are pre-sorted, so the text matches the card above it.
  function messageInput(inv: Invoice): InvoiceMessageInput {
    const ship = shipValue(inv);
    // One entry per source, keyed like the on-screen grouping — two sales that
    // happen to share a title still count as two.
    const seen = new Set<string>();
    const saleTitles: string[] = [];
    for (const l of inv.lines) {
      const k = `${l.kind}:${l.sourceId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      saleTitles.push(l.sourceTitle);
    }
    return {
      name: inv.name,
      fbHandle: inv.fbHandle,
      itemLines: inv.lines.map(l => `\u00b7 ${l.label} \u2014 ${fmtMoney(l.amount)}`),
      saleTitles,
      itemCount: inv.lines.length,
      subtotal: fmtMoney(inv.subtotal),
      shipping: fmtMoney(ship),
      total: fmtMoney(inv.subtotal + ship),
      payment,
      address: fullAddress(inv.bidder),
      saleDates: saleDateSummary(inv),
    };
  }

  // The message as the template renders it, before any per-buyer hand-edit.
  function renderedText(inv: Invoice): string {
    return renderInvoiceMessage(template, invoiceMessageVars(messageInput(inv)));
  }

  // What actually gets copied: a hand-edited draft for this buyer if there is
  // one, otherwise the template's output.
  function invoiceText(inv: Invoice): string {
    return drafts[inv.bidderKey]?.text ?? renderedText(inv);
  }

  // True once the numbers behind a hand-edited message have moved on — the
  // seller changed shipping, or the template, after editing.
  function draftIsStale(inv: Invoice): boolean {
    const draft = drafts[inv.bidderKey];
    return draft !== undefined && draft.base !== renderedText(inv);
  }

  async function copyInvoice(inv: Invoice) {
    try {
      await navigator.clipboard.writeText(invoiceText(inv));
      setCopied(inv.bidderKey);
      setTimeout(() => setCopied(c => (c === inv.bidderKey ? null : c)), 1800);
    } catch {}
  }

  async function copyAddress(inv: Invoice) {
    const text = fullAddress(inv.bidder);
    if (!text) return;
    try { await navigator.clipboard.writeText(text); } catch {}
  }

  function savePayment(v: string) {
    setPayment(v);
    try { localStorage.setItem(PAYMENT_STORAGE_KEY, v); } catch {}
  }

  function saveTemplate(v: string) {
    setTemplate(v);
    try { localStorage.setItem(MESSAGE_STORAGE_KEY, v); } catch {}
  }

  function resetTemplate() {
    if (!confirm('Restore the default invoice message? Your wording will be replaced.')) return;
    saveTemplate(DEFAULT_INVOICE_MESSAGE);
  }

  // Show/hide one buyer's message box. No draft is recorded until something is
  // actually typed, so just looking doesn't mark the invoice as edited.
  function toggleMessage(inv: Invoice) {
    setEditingDraft(k => (k === inv.bidderKey ? null : inv.bidderKey));
  }

  // Throw the hand-edits away and re-seed from the template — how you pick up
  // a shipping change after editing.
  function refreshDraft(inv: Invoice) {
    const rendered = renderedText(inv);
    setDrafts(d => ({ ...d, [inv.bidderKey]: { text: rendered, base: rendered } }));
  }

  // Drop a buyer's hand-edits so their message follows the template again.
  function clearDraft(inv: Invoice) {
    setDrafts(d => {
      const next = { ...d };
      delete next[inv.bidderKey];
      return next;
    });
  }

  // Mark a whole invoice paid: flip the underlying lots + claim items, then
  // sync each listing to Sold so the ended-auction area and My Listings buckets
  // update in step. Source of truth stays on the lot — no drift.
  async function markPaid(inv: Invoice) {
    if (marking) return;
    const n = inv.lines.length;
    if (!confirm(`Mark ${n} item${n === 1 ? '' : 's'} for ${inv.name} as PAID?\n\nThis settles every unpaid win shown and moves the cards to Sold in My Listings.`)) return;
    setMarking(inv.bidderKey);
    const supabase = createClient();

    const auctionLots = inv.lines.filter(l => l.kind === 'auction');
    const claimItems = inv.lines.filter(l => l.kind === 'claim');

    try {
      if (auctionLots.length) {
        await supabase.from('fb_auction_lots').update({ status: 'paid' }).in('id', auctionLots.map(l => l.key));
      }
      if (claimItems.length) {
        await supabase.from('fb_claim_sale_items').update({ claim_status: 'paid' }).in('id', claimItems.map(l => l.key));
      }
      // Move each card Claimed -> Sold at its selling price.
      for (const l of inv.lines) {
        if (l.listing?.id) {
          await applyListingSale(supabase, userId, [l.listing.id], l.kind === 'auction' ? 'auction' : 'claim', 'sold', l.amount);
        }
      }
      // Move the invoice from Open to Paid locally without a full reload. Keep
      // the bidderKey stable (it's the React key + shipping map key); the `paid`
      // flag alone drives which tab it lands in, so there's no key collision
      // with a buyer's pre-existing paid invoice.
      setInvoices(prev => prev.map(i => i.bidderKey === inv.bidderKey ? { ...i, paid: true } : i));
    } catch (e) {
      alert(`Could not mark paid: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setMarking(null);
    }
  }

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><SCLogo size={80} /></div>;
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(248,236,208,0.96)', backdropFilter: 'blur(8px)',
        borderBottom: '3px solid var(--plum)',
      }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link href="/home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>
          <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)' }}>★ Invoices ★</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/fb-auctions" className="btn btn-ghost btn-sm">🔨 Auctions</Link>
            <Link href="/fb-claim-sales" className="btn btn-ghost btn-sm">🏷 Claim Sales</Link>
            <Link href="/fb-auctions/bidders" className="btn btn-ghost btn-sm">Bidders</Link>
            <Link href="/listings" className="btn btn-ghost btn-sm">My Listings</Link>
            <Link href="/home" className="btn btn-outline btn-sm">← Home</Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
        <section style={{ padding: '18px 22px', background: 'var(--paper)', border: '1.5px solid var(--rule)', borderRadius: 10, marginBottom: 24 }}>
          <div className="eyebrow" style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 700, marginBottom: 8 }}>★ Combined invoices ★</div>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: 'var(--ink-soft)' }}>
            One invoice per buyer, combining every unpaid win across all of your ended auctions and claim sales. Add combined
            shipping, copy the Messenger-ready text, then <strong>Mark paid</strong> — the cards move to Sold in My Listings and
            drop off the ended-auction outstanding totals automatically. Click any card description to check its photos.
            The wording is yours: <strong>Edit invoice message</strong> below changes it for every invoice, and{' '}
            <strong>Edit message</strong> on a buyer&rsquo;s card tweaks just theirs.
          </p>
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 18 }}>
          <MetricCard label="Buyers owing" value={String(summary.count)} accent />
          <MetricCard label="Outstanding $" value={fmtMoney(summary.outstanding)} accent />
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => setTab('open')} className={`btn btn-sm ${tab === 'open' ? 'btn-primary' : 'btn-ghost'}`}>
            Open <span style={{ marginLeft: 6, opacity: 0.8 }}>{invoices.filter(i => !i.paid).length}</span>
          </button>
          <button onClick={() => setTab('paid')} className={`btn btn-sm ${tab === 'paid' ? 'btn-primary' : 'btn-ghost'}`}>
            Paid <span style={{ marginLeft: 6, opacity: 0.8 }}>{invoices.filter(i => i.paid).length}</span>
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="eyebrow" htmlFor="invoice-sort" style={{ fontSize: 11, color: 'var(--orange)', fontWeight: 700 }}>Sort</label>
            <select
              id="invoice-sort"
              value={sort}
              onChange={e => setSort(e.target.value as Sort)}
              style={{ padding: '4px 10px', fontSize: 12, fontWeight: 700, border: '1.5px solid var(--plum)', borderRadius: 100, background: 'var(--cream)', color: 'var(--plum)', fontFamily: 'var(--font-body)', cursor: 'pointer' }}
            >
              {SORTS.map(o => <option key={o} value={o}>{SORT_LABELS[o]}</option>)}
            </select>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search buyer…"
              className="input-sc"
              style={{ minWidth: 200 }}
            />
          </div>
        </div>

        {tab === 'open' && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ flex: '1 1 380px', maxWidth: 520 }}>
                <label className="input-label">Payment instructions (shared across invoices)</label>
                <textarea
                  value={payment}
                  onChange={e => savePayment(e.target.value)}
                  rows={2}
                  style={{ width: '100%', boxSizing: 'border-box', border: '1.5px solid var(--plum)', borderRadius: 6, padding: '8px 10px', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--plum)', background: 'var(--paper)', resize: 'vertical' }}
                />
              </div>
              <button
                onClick={() => setEditingTemplate(v => !v)}
                className={`btn btn-sm ${editingTemplate ? 'btn-primary' : 'btn-outline'}`}
              >
                ✏️ {editingTemplate ? 'Done editing message' : 'Edit invoice message'}
              </button>
            </div>

            {editingTemplate && (
              <MessageTemplateEditor
                template={template}
                onChange={saveTemplate}
                onReset={resetTemplate}
                preview={previewText}
                isDefault={template === DEFAULT_INVOICE_MESSAGE}
                previewSubject={previewSubject}
              />
            )}
          </div>
        )}

        {shown.length === 0 ? (
          <div className="panel-bordered" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 14 }}>
            {tab === 'open'
              ? 'No open invoices. When a bidder wins a lot (marked ENDED) or claims a card, their combined invoice shows up here.'
              : 'No paid invoices yet.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {shown.map(inv => (
              <InvoiceCard
                key={inv.bidderKey}
                inv={inv}
                shipping={shipping[inv.bidderKey] ?? '0'}
                onShipping={v => setShipping(s => ({ ...s, [inv.bidderKey]: v }))}
                total={inv.subtotal + shipValue(inv)}
                onCopy={() => copyInvoice(inv)}
                copied={copied === inv.bidderKey}
                message={invoiceText(inv)}
                editingMessage={editingDraft === inv.bidderKey}
                edited={inv.bidderKey in drafts}
                onEditMessage={() => toggleMessage(inv)}
                onMessageChange={v => setDrafts(d => ({
                  ...d,
                  // The box was pre-filled from the template, so on the first
                  // keystroke today's rendering is what the edit started from.
                  [inv.bidderKey]: { text: v, base: d[inv.bidderKey]?.base ?? renderedText(inv) },
                }))}
                onResetMessage={() => clearDraft(inv)}
                stale={draftIsStale(inv)}
                onRefreshMessage={() => refreshDraft(inv)}
                onCopyAddress={() => copyAddress(inv)}
                onMarkPaid={() => markPaid(inv)}
                marking={marking === inv.bidderKey}
                onOpenPhotos={setLightbox}
              />
            ))}
          </div>
        )}
      </div>

      {lightbox && <PhotoLightbox line={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

// Editor for the shared invoice message. The template is plain text plus
// {placeholders}; the preview below it re-renders on every keystroke so the
// seller can see exactly what a buyer would receive.
function MessageTemplateEditor({
  template, onChange, onReset, preview, isDefault, previewSubject,
}: {
  template: string;
  onChange: (v: string) => void;
  onReset: () => void;
  preview: string;
  isDefault: boolean;
  previewSubject: string;
}) {
  const boxRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Drop a placeholder in at the cursor, so the seller doesn't have to type
  // the braces or remember the exact spelling.
  function insert(token: string) {
    const el = boxRef.current;
    if (!el) { onChange(`${template}${token}`); return; }
    const start = el.selectionStart ?? template.length;
    const end = el.selectionEnd ?? start;
    onChange(template.slice(0, start) + token + template.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const at = start + token.length;
      el.setSelectionRange(at, at);
    });
  }

  return (
    <div className="panel-bordered" style={{ padding: 16, marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div className="eyebrow" style={{ fontSize: 11, color: 'var(--orange)', fontWeight: 700 }}>Invoice message</div>
        <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
          Saved on this device and used for every invoice you copy.
        </span>
        <button
          onClick={onReset}
          disabled={isDefault}
          className="btn btn-ghost btn-sm"
          style={{ marginLeft: 'auto', fontSize: 11 }}
        >
          ↺ Reset to default
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <div>
          <label className="input-label" htmlFor="invoice-template">Template</label>
          <textarea
            id="invoice-template"
            ref={boxRef}
            value={template}
            onChange={e => onChange(e.target.value)}
            rows={14}
            spellCheck={false}
            style={{ width: '100%', boxSizing: 'border-box', border: '1.5px solid var(--plum)', borderRadius: 6, padding: '10px 12px', fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 12.5, lineHeight: 1.6, color: 'var(--plum)', background: 'var(--paper)', resize: 'vertical' }}
          />
          <div style={{ marginTop: 10 }}>
            <div className="eyebrow" style={{ fontSize: 10.5, color: 'var(--orange)', fontWeight: 700, marginBottom: 6 }}>
              Click to insert
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {INVOICE_MESSAGE_VARIABLES.map(v => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => insert(v.key)}
                  title={v.desc}
                  className="mono"
                  style={{ fontSize: 11, padding: '3px 8px', borderRadius: 100, border: '1.5px solid var(--rule)', background: 'var(--cream)', color: 'var(--plum)', cursor: 'pointer', fontWeight: 700 }}
                >
                  {v.key}
                </button>
              ))}
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--ink-mute)', lineHeight: 1.6 }}>
              Hover a placeholder to see what it fills in. Anything else you type is sent as-is. A line
              holding only placeholders that come back empty — like {'{payment}'} with no instructions saved — is
              dropped rather than left blank.
            </p>
          </div>
        </div>

        <div>
          <label className="input-label">Preview — {previewSubject}</label>
          <pre style={{ margin: 0, minHeight: 200, whiteSpace: 'pre-wrap', wordBreak: 'break-word', border: '1.5px solid var(--rule)', borderRadius: 6, padding: '10px 12px', fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.6, color: 'var(--plum)', background: 'var(--cream)' }}>
            {preview}
          </pre>
        </div>
      </div>
    </div>
  );
}

function InvoiceCard({
  inv, shipping, onShipping, total, onCopy, copied, onCopyAddress, onMarkPaid, marking, onOpenPhotos,
  message, editingMessage, edited, onEditMessage, onMessageChange, onResetMessage, stale, onRefreshMessage,
}: {
  inv: Invoice;
  shipping: string;
  onShipping: (v: string) => void;
  total: number;
  onCopy: () => void;
  copied: boolean;
  message: string;
  editingMessage: boolean;
  edited: boolean;
  onEditMessage: () => void;
  onMessageChange: (v: string) => void;
  onResetMessage: () => void;
  stale: boolean;
  onRefreshMessage: () => void;
  onCopyAddress: () => void;
  onMarkPaid: () => void;
  marking: boolean;
  onOpenPhotos: (line: InvoiceLine) => void;
}) {
  // Group the buyer's lines by the sale they came from.
  const groups = useMemo(() => {
    const m = new Map<string, { title: string; kind: 'auction' | 'claim'; sourceId: string; sourceUrl: string | null; date: string | null; lines: InvoiceLine[] }>();
    for (const l of inv.lines) {
      const k = `${l.kind}:${l.sourceId}`;
      if (!m.has(k)) m.set(k, { title: l.sourceTitle, kind: l.kind, sourceId: l.sourceId, sourceUrl: l.sourceUrl, date: l.sourceDate, lines: [] });
      m.get(k)!.lines.push(l);
    }
    return Array.from(m.values()).sort((a, b) => a.title.localeCompare(b.title));
  }, [inv.lines]);

  const addr = fullAddress(inv.bidder);
  const dateSummary = saleDateSummary(inv);

  return (
    <section className="panel-bordered" style={{ padding: '18px 22px', borderColor: inv.paid ? 'var(--rule)' : 'var(--orange)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          {inv.bidderId ? (
            <Link href={`/fb-auctions/bidders/${inv.bidderId}`} className="display" style={{ fontSize: 18, color: 'var(--plum)', textDecoration: 'none' }}>
              {inv.name}
            </Link>
          ) : (
            <span className="display" style={{ fontSize: 18, color: 'var(--plum)' }}>{inv.name}</span>
          )}
          {inv.fbHandle && <span className="mono" style={{ fontSize: 12, color: 'var(--teal)', fontWeight: 600 }}>@{inv.fbHandle}</span>}
          {inv.paid && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 100, background: 'var(--plum)', color: 'var(--cream)', textTransform: 'uppercase' }}>Paid</span>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="mono" style={{ fontSize: 14, color: 'var(--orange)', fontWeight: 700 }}>
            {inv.lines.length} item{inv.lines.length === 1 ? '' : 's'} · {fmtMoney(inv.subtotal)}
          </div>
          {dateSummary && (
            <div className="mono" title="Sale date" style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
              📅 {dateSummary}
            </div>
          )}
        </div>
      </div>

      {(inv.bidder?.email || inv.bidder?.phone || addr) && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12, fontSize: 12, color: 'var(--ink-soft)' }}>
          {inv.bidder?.email && <span>✉ <a href={`mailto:${inv.bidder.email}`} style={{ color: 'var(--teal)', fontWeight: 600 }}>{inv.bidder.email}</a></span>}
          {inv.bidder?.phone && <span>☎ {inv.bidder.phone}</span>}
          {addr && <button onClick={onCopyAddress} className="btn btn-ghost btn-sm" style={{ fontSize: 10, padding: '2px 8px' }}>📋 Copy mailing address</button>}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {groups.map(g => {
          const saleDate = fmtDate(g.date);
          return (
          <div key={`${g.kind}:${g.sourceId}`} style={{ background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6, padding: '8px 10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
              {g.sourceUrl ? (
                // Link straight to the Facebook post — it's the fastest way to pull
                // the buyer's details off the thread while building the invoice.
                <a
                  href={g.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--teal)', textDecoration: 'underline', fontSize: 12.5, fontWeight: 600 }}
                >
                  {g.kind === 'auction' ? '🔨' : '🎯'} {g.title} ↗
                </a>
              ) : g.sourceId ? (
                <Link
                  href={g.kind === 'auction' ? `/fb-auctions/${g.sourceId}` : `/fb-claim-sales/${g.sourceId}`}
                  style={{ color: 'var(--teal)', textDecoration: 'underline', fontSize: 12.5, fontWeight: 600 }}
                >
                  {g.kind === 'auction' ? '🔨' : '🎯'} {g.title}
                </Link>
              ) : (
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--plum)' }}>{g.kind === 'auction' ? '🔨' : '🎯'} {g.title}</span>
              )}
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', whiteSpace: 'nowrap' }}>
                {saleDate && <span title="Sale date">{saleDate} · </span>}
                {g.lines.length} item{g.lines.length === 1 ? '' : 's'}
              </span>
            </div>
            {g.lines.map(l => {
              const hasPhotos = !!(l.listing?.photos && l.listing.photos.length);
              return (
                <div key={l.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, color: 'var(--plum)', alignItems: 'center' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    ·{' '}
                    {hasPhotos ? (
                      <button
                        type="button"
                        onClick={() => onOpenPhotos(l)}
                        title="View photos to validate the card"
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--teal)', textDecoration: 'underline', fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 600 }}
                      >
                        🖼 {l.label}
                      </button>
                    ) : (
                      <span>{l.label}</span>
                    )}
                    {l.tag && (
                      <span className="mono" title="Inventory tag"
                        style={{ marginLeft: 8, fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--cream)', border: '1px solid var(--plum)', fontWeight: 700 }}>
                        🏷 {l.tag}
                      </span>
                    )}
                  </span>
                  <span className="mono" style={{ color: 'var(--orange)', fontWeight: 700 }}>{fmtMoney(l.amount)}</span>
                </div>
              );
            })}
          </div>
          );
        })}
      </div>

      {!inv.paid && (
        <>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ width: 120 }}>
              <label className="input-label">Shipping</label>
              <input
                type="number" min="0" step="0.01"
                value={shipping}
                onChange={e => onShipping(e.target.value)}
                className="input-sc" style={{ width: '100%' }}
              />
            </div>
            <div className="mono" style={{ fontSize: 14, color: 'var(--plum)', fontWeight: 700, paddingBottom: 8 }}>
              Total: <span style={{ color: 'var(--orange)' }}>{fmtMoney(total)}</span>
            </div>
          </div>

          {editingMessage && (
            <div style={{ marginBottom: 12 }}>
              <label className="input-label" htmlFor={`msg-${inv.bidderKey}`}>
                Message to {inv.name} {edited && <span style={{ color: 'var(--orange)', fontWeight: 700 }}>· edited</span>}
              </label>
              <textarea
                id={`msg-${inv.bidderKey}`}
                value={message}
                onChange={e => onMessageChange(e.target.value)}
                rows={12}
                style={{ width: '100%', boxSizing: 'border-box', border: '1.5px solid var(--plum)', borderRadius: 6, padding: '10px 12px', fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.6, color: 'var(--plum)', background: 'var(--paper)', resize: 'vertical' }}
              />
              {stale && (
                <div style={{ marginTop: 8, padding: '8px 10px', border: '1.5px solid var(--orange)', borderRadius: 6, background: 'var(--cream)', fontSize: 12, color: 'var(--plum)', lineHeight: 1.6 }}>
                  ⚠️ Shipping or the message template changed after you edited this. The text above still shows the
                  old figures.{' '}
                  <button
                    onClick={onRefreshMessage}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--teal)', textDecoration: 'underline', fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 700 }}
                  >
                    Rebuild from the template
                  </button>{' '}
                  (your edits here are discarded).
                </div>
              )}
              <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--ink-mute)', lineHeight: 1.6 }}>
                Edits here apply to this buyer only and last until you reload. To change the wording for
                every invoice, use <strong>Edit invoice message</strong> at the top.
              </p>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={onCopy} className="btn btn-primary btn-sm">
              {copied ? '✓ Copied!' : '📋 Copy invoice'}
            </button>
            <button onClick={onEditMessage} className={`btn btn-sm ${editingMessage ? 'btn-outline' : 'btn-ghost'}`}>
              {editingMessage
                ? '▲ Hide message'
                : edited
                  ? `✏️ Edit message · edited${stale ? ' ⚠️' : ''}`
                  : '✏️ Edit message'}
            </button>
            {edited && (
              <button onClick={onResetMessage} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>
                ↺ Undo edits
              </button>
            )}
            <button onClick={onMarkPaid} disabled={marking} className="btn btn-ghost btn-sm">
              {marking ? 'Saving…' : `✓ Mark ${inv.lines.length} item${inv.lines.length === 1 ? '' : 's'} paid`}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function PhotoLightbox({ line, onClose }: { line: InvoiceLine; onClose: () => void }) {
  const photos = (line.listing?.photos || []).filter(Boolean);
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(42,20,52,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto' }}
    >
      <div onClick={e => e.stopPropagation()} className="panel-bordered" style={{ width: '100%', maxWidth: 760, padding: 24, background: 'var(--cream)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div className="display" style={{ fontSize: 17, color: 'var(--plum)', flex: 1 }}>{line.label}</div>
          {line.tag && (
            <span className="mono" style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--paper)', border: '1px solid var(--plum)', fontWeight: 700 }}>🏷 {line.tag}</span>
          )}
          <button type="button" onClick={onClose} className="btn btn-outline btn-sm">✕ Close</button>
        </div>
        {photos.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>No photos on this listing.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: photos.length > 1 ? '1fr 1fr' : '1fr', gap: 14 }}>
            {photos.slice(0, 2).map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt={`${line.label} ${i === 0 ? 'front' : 'back'}`}
                style={{ width: '100%', borderRadius: 8, border: '1px solid var(--rule)', background: 'var(--paper)' }} />
            ))}
          </div>
        )}
        {line.sourceId && (
          <div style={{ marginTop: 16, textAlign: 'right' }}>
            <Link
              href={line.kind === 'auction' ? `/fb-auctions/${line.sourceId}` : `/fb-claim-sales/${line.sourceId}`}
              className="btn btn-ghost btn-sm"
            >
              Open {line.kind === 'auction' ? 'auction' : 'claim sale'} →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="panel-bordered" style={{ padding: '14px 16px', textAlign: 'center' }}>
      <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 4 }}>{label}</div>
      <div className="display" style={{ fontSize: 22, color: accent ? 'var(--orange)' : 'var(--plum)', fontWeight: 700 }}>{value}</div>
    </div>
  );
}
