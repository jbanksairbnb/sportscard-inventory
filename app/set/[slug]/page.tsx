'use client';

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/client";
import SCLogo from "@/components/SCLogo";
import SetHeaderBanner from "@/components/SetHeaderBanner";
import MarketResearchModal, { CardDescriptor } from "@/components/MarketResearchModal";
import { cardValueKey, trendFromRows, type Trend } from "@/lib/cardValueHistory";
import { generateWantListPdf, downloadPdf } from "@/lib/pdf/wantListPdf";
import { applyOwnedTransition, ensureRowIds } from "@/lib/inventory";
import { thumbUrl } from "@/lib/image-transform";
import { BRANDS as BRAND_NAMES } from "@/lib/brands";
import { RAW_GRADES as SHARED_RAW_GRADES, buildListingTitle } from "@/lib/listingTitle";
import { cropScanPadding } from "@/lib/scanAutoCrop";

/* =====================  Constants  ===================== */
// Notes is a free-form per-row text field shown beneath the player name in
// the frozen left block — captures anything the user wants to remember about
// the card (variation, condition note, provenance, etc.).
// The legacy "Graded" yes/no column was removed; whether a card is graded is
// now derived from whether the Grading Company is filled in.
const EXPECTED_HEADERS = [
  "Card #", "Description", "Notes", "Tag #", "Owned", "Raw Grade",
    "Grading Company", "Grade", "Cost", "Value", "Target Price", "Target Type", "Target Condition - Low", "Target Condition - High", "Target Grading Companies",
  "Sale Price", "Date Purchased", "Purchased From", "Upload Image(s)",
];

const TAG_VISIBLE_KEY = 'sc:set-show-tag';

const YEARS = Array.from({ length: 2025 - 1953 + 1 }, (_, i) => String(1953 + i));
const BRANDS = BRAND_NAMES;
const YES_NO = ["Yes", "No"] as const;
const COMPANIES = ["", "PSA", "SGC", "BGS", "CGC", "TAG"] as const;
const GRADING_COMPANIES_LIST = ["PSA", "SGC", "BGS", "CGC", "TAG"] as const;
const RAW_GRADES = ["", ...SHARED_RAW_GRADES] as const;
const RAW_TARGET_GRADES = SHARED_RAW_GRADES;
const GRADES_NUMERIC = ["", ...Array.from({ length: 19 }, (_, i) => (10 - i * 0.5).toString().replace(/\.0$/, ""))];
const TARGET_GRADES_NUMERIC = Array.from({ length: 19 }, (_, i) => (10 - i * 0.5).toString().replace(/\.0$/, ""));

type SortKey = typeof EXPECTED_HEADERS[number];
type SortDir = 'asc' | 'desc';

const DEFAULT_DIR: Partial<Record<SortKey, SortDir>> = {
  "Grade": "desc", "Cost": "desc", "Value": "desc", "Target Price": "desc",
};
const CURRENCY_FIELDS = ["Cost", "Value", "Target Price", "Sale Price"] as const;

/* =====================  Helpers  ===================== */
const v = (x: any) => (x === undefined || x === null ? "" : String(x));

function stripCurrency(val: string) {
  return String(val ?? "").replace(/[^0-9.-]/g, "");
}
function toCurrency(val: string) {
  const n = Number(stripCurrency(val));
  return Number.isNaN(n)
    ? ""
    : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
}
function isValidMMDDYYYY(s: string) {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(s);
}
function autoSlashDate(raw: string) {
  const d = raw.replace(/[^0-9]/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return d.slice(0, 2) + "/" + d.slice(2);
  return d.slice(0, 2) + "/" + d.slice(2, 4) + "/" + d.slice(4);
}
function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}
function normalizeNumericGrade(input: any) {
  const s = String(input ?? "").trim();
  if (!s) return "";
  const num = Number(s);
  if (!Number.isNaN(num)) {
    const clamped = Math.min(10, Math.max(1, Math.round(num * 2) / 2));
    const asStr = clamped.toFixed(1).replace(/\.0$/, "");
    return GRADES_NUMERIC.includes(asStr) ? asStr : "";
  }
  return GRADES_NUMERIC.includes(s) ? s : "";
}
function computeOwnedStats(rows: any[]) {
  const total = rows?.length || 0;
  const owned = rows?.filter((r) => String(r?.["Owned"] || "") === "Yes").length || 0;
  return { ownedCount: owned, ownedPct: total ? (owned / total) * 100 : 0 };
}
function toNumber(v: unknown): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (typeof v === "string") { const n = Number(v.replace(/[$,]/g, "").trim()); return isFinite(n) ? n : 0; }
  return 0;
}
function computeFinancials(rows: any[]) {
  const totalCost = rows?.reduce((acc: number, r: any) => acc + toNumber(r?.["Cost"]), 0) || 0;
  const totalValue = rows?.reduce((acc: number, r: any) => acc + toNumber(r?.["Value"]), 0) || 0;
  return { totalCost, totalValue, gainLoss: totalValue - totalCost };
}
function migrateRows(rows: Array<Record<string, any>>) {
  return rows.map((r) => {
    let next = r;
    if (next['Target Condition'] !== undefined && next['Target Condition - Low'] === undefined) {
      next = { ...next, 'Target Condition - Low': next['Target Condition'] };
    }
    if (next['Description'] !== undefined && next['Player'] === undefined) {
      next = { ...next, 'Player': next['Description'] };
    }
    return next;
  });
}
function downloadCSV(filename: string, rows: Array<Record<string, any>>) {
  // The "Description" column was renamed to "Player" on the row data side
  // (see migrateRows above). Newly-saved rows store the value under
  // r["Player"], with a one-time backfill from any legacy r["Description"]
  // on read. Reading the CSV value directly from r["Description"] therefore
  // returns empty for every modern row, even though the player name is
  // visible in the UI. We pull from Player first and fall back to
  // Description so both legacy and modern rows export correctly. The CSV
  // header stays "Description" so existing upload templates keep working.
  function valueFor(r: Record<string, any>, header: string): any {
    if (header === 'Description') return r['Player'] ?? r['Description'] ?? '';
    return r[header] ?? '';
  }
  const csv = Papa.unparse({
    fields: EXPECTED_HEADERS,
    data: rows.map(r => EXPECTED_HEADERS.map(h => valueFor(r, h))),
  });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
function asNumberForSort(field: string, row: Record<string, any>): number | null {
  if (field === "Grade") { const n = Number(String(row[field] ?? "").trim()); return Number.isFinite(n) ? n : null; }
  if ((CURRENCY_FIELDS as readonly string[]).includes(field)) { const s = stripCurrency(String(row[field] ?? "")); return s === "" ? null : (Number.isFinite(Number(s)) ? Number(s) : null); }
  if (field === "Card #") { const n = Number(String(row[field] ?? "").trim()); return Number.isFinite(n) ? n : null; }
  return null;
}
function textForSort(raw: any): string { return String(raw ?? "").toLowerCase(); }

/* =====================  Image Modal  ===================== */
type LightboxItem = {
  url: string;
  origIndex: number;   // original row index, so we can wire delete back
  slot: 1 | 2;         // which image field (Image 1 / Image 2)
  cardNum: string;
  player: string;
};

function ImageViewModal({ items, idx, setIdx, onClose, onDelete }: {
  items: LightboxItem[];
  idx: number;
  setIdx: (i: number) => void;
  onClose: () => void;
  onDelete?: (item: LightboxItem) => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') { setIdx(Math.max(0, idx - 1)); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { setIdx(Math.min(items.length - 1, idx + 1)); e.preventDefault(); }
      else if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx, items.length, setIdx, onClose]);

  if (items.length === 0) return null;
  const current = items[idx];
  if (!current) return null;
  const arrowBtn: React.CSSProperties = {
    pointerEvents: 'all', background: 'rgba(42,20,52,0.7)', color: 'var(--cream)',
    border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 24,
    cursor: 'pointer', lineHeight: 1,
  };
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(42, 20, 52, 0.88)',
    }} onClick={onClose}>
      <div style={{ position: 'relative', padding: 16 }} onClick={(e) => e.stopPropagation()}>
        <img loading="lazy" decoding="async" src={current.url} alt="Card"
          style={{ maxWidth: '90vw', maxHeight: '78vh', borderRadius: 12, display: 'block' }} />
        <div style={{
          marginTop: 12, padding: '8px 14px',
          background: 'rgba(248,236,208,0.96)', border: '2px solid var(--plum)',
          borderRadius: 8, color: 'var(--plum)', textAlign: 'center',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
            {current.cardNum ? `#${current.cardNum}` : ''}
          </span>
          <span className="display" style={{ fontSize: 14 }}>{current.player || '—'}</span>
          <span className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)' }}>
            {current.slot === 1 ? 'Front' : 'Back'}
          </span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', marginLeft: 8 }}>
            {idx + 1} / {items.length}
          </span>
        </div>
        {items.length > 1 && (
          <div style={{ position: 'absolute', top: '40%', left: 0, right: 0, transform: 'translateY(-50%)', display: 'flex', justifyContent: 'space-between', pointerEvents: 'none', padding: '0 4px' }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); setIdx(Math.max(0, idx - 1)); }}
              style={{ ...arrowBtn, opacity: idx === 0 ? 0.25 : 1 }} disabled={idx === 0}>‹</button>
            <button type="button" onClick={(e) => { e.stopPropagation(); setIdx(Math.min(items.length - 1, idx + 1)); }}
              style={{ ...arrowBtn, opacity: idx === items.length - 1 ? 0.25 : 1 }} disabled={idx === items.length - 1}>›</button>
          </div>
        )}
        <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 8 }}>
          {onDelete && (
            <button type="button" onClick={() => onDelete(current)} className="btn btn-sm"
              style={{ background: 'var(--rust)', color: 'var(--cream)', borderColor: 'var(--rust)' }}>
              🗑 Delete
            </button>
          )}
          <button type="button" onClick={onClose} className="btn btn-sm">✕ Close</button>
        </div>
      </div>
    </div>
  );
}

/* =====================  Image Cell  ===================== */
function ImageCell({ url, label, onUpload, onView }: {
  url: string; label: string;
  onUpload: (file: File) => Promise<void>;
  // Click-through to the page-level lightbox so prev/next walks every
  // image in the set rather than just the front/back of this card.
  onView: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    await onUpload(file);
    setUploading(false);
    e.target.value = "";
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
      {url ? (
        <img loading="lazy" decoding="async" src={thumbUrl(url, 160)} alt={label} title="Click to view"
          onClick={onView}
          style={{ width: 56, height: 56, borderRadius: 8, border: '2px solid var(--plum)', objectFit: 'cover', cursor: 'pointer' }} />
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          style={{
            width: 56, height: 56, borderRadius: 8,
            border: '2px dashed var(--rule)', background: 'var(--paper)',
            color: 'var(--ink-mute)', fontSize: 10, fontWeight: 700,
            cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.5 : 1,
          }}>
          {uploading ? "…" : `+ ${label}`}
        </button>
      )}
      {uploading && <span style={{ fontSize: 9, color: 'var(--ink-mute)' }}>Uploading…</span>}
    </div>
  );
}

const CELL_INPUT: React.CSSProperties = {
  background: 'var(--cream)', border: '1.5px solid var(--plum)',
  borderRadius: 6, padding: '3px 7px', fontSize: 12,
  fontFamily: 'var(--font-body)', color: 'var(--plum)', width: '100%',
};
const CELL_SELECT: React.CSSProperties = {
  ...CELL_INPUT, cursor: 'pointer',
};

/* =====================  Target Editor  ===================== */
function summarizeTarget(row: Record<string, any>): { text: string; isSet: boolean } {
  const type = String(row['Target Type'] || '').trim();
  const low = String(row['Target Condition - Low'] || '').trim();
  const high = String(row['Target Condition - High'] || '').trim();
  const companies = String(row['Target Grading Companies'] || '').trim();
  if (!type && !low && !high) return { text: '— set target —', isSet: false };
  const range = low && high ? `${low}–${high}` : (low || high || 'any');
  if (type === 'Raw') return { text: `Raw · ${range}`, isSet: true };
  if (type === 'Graded') {
    const companyLabel = companies ? companies.replace(/,/g, ', ') : 'any company';
    return { text: `Graded · ${companyLabel} · ${range}`, isSet: true };
  }
  return { text: `${range}`, isSet: true };
}

function TargetEditorModal({ row, cardLabel, onClose, onSave, isDefault, initialFlags }: {
  row: Record<string, any>;
  cardLabel: string;
  onClose: () => void;
  // Two callback shapes — per-row saves the four core fields, default
  // saves those plus the two set-level matching toggles.
  onSave: (patch: { type: string; low: string; high: string; companies: string; include_equivalent_grades: boolean; include_upgrades: boolean }) => void;
  // True when this modal is editing the set's default target. Drives
  // whether the two matching-toggle checkboxes are shown.
  isDefault?: boolean;
  initialFlags?: { include_equivalent_grades: boolean; include_upgrades: boolean };
}) {
  const initialType = (() => {
    const t = String(row['Target Type'] || '').trim();
    if (t === 'Raw' || t === 'Graded') return t;
    const low = String(row['Target Condition - Low'] || '').trim();
    if ((RAW_TARGET_GRADES as readonly string[]).includes(low)) return 'Raw';
    if (/^\d/.test(low) || low.startsWith('PSA')) return 'Graded';
    return 'Graded';
  })();
  const [type, setType] = useState<'Raw' | 'Graded'>(initialType as 'Raw' | 'Graded');
  const stripCompanyPrefix = (s: string) => s.replace(/^PSA\/SGC\s+/i, '').trim();
  const [low, setLow] = useState(stripCompanyPrefix(String(row['Target Condition - Low'] || '')));
  const [high, setHigh] = useState(stripCompanyPrefix(String(row['Target Condition - High'] || '')));
  const initialCompanies = String(row['Target Grading Companies'] || '').split(',').map(s => s.trim()).filter(Boolean);
  const [companies, setCompanies] = useState<string[]>(initialCompanies);
  const [includeEquivalentGrades, setIncludeEquivalentGrades] = useState(!!initialFlags?.include_equivalent_grades);
  const [includeUpgrades, setIncludeUpgrades] = useState(!!initialFlags?.include_upgrades);

  function toggleCompany(c: string) {
    setCompanies(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);
  }

  function changeType(t: 'Raw' | 'Graded') {
    setType(t);
    setLow('');
    setHigh('');
    if (t === 'Raw') setCompanies([]);
  }

  function handleSave() {
    onSave({
      type,
      low,
      high,
      companies: type === 'Graded' ? companies.join(',') : '',
      include_equivalent_grades: includeEquivalentGrades,
      include_upgrades: includeUpgrades,
    });
  }

  function handleClear() {
    onSave({ type: '', low: '', high: '', companies: '', include_equivalent_grades: false, include_upgrades: false });
  }

  const gradeOptions = type === 'Raw' ? RAW_TARGET_GRADES : TARGET_GRADES_NUMERIC;

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(42,20,52,0.82)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '40px 20px', overflowY: 'auto',
    }}>
      <div onClick={(e) => e.stopPropagation()} className="panel-bordered"
        style={{ width: '100%', maxWidth: 480, padding: 26, background: 'var(--cream)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div className="display" style={{ fontSize: 20, color: 'var(--plum)', flex: 1 }}>Set Target</div>
          <button type="button" onClick={onClose} className="btn btn-outline btn-sm">✕ Close</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 18 }}>{cardLabel}</div>

        <div style={{ marginBottom: 16 }}>
          <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 6 }}>TYPE</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['Raw', 'Graded'] as const).map(t => (
              <button key={t} type="button" onClick={() => changeType(t)}
                className={`btn btn-sm ${type === t ? 'btn-primary' : 'btn-ghost'}`}
                style={{ flex: 1, justifyContent: 'center' }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {type === 'Graded' && (
          <div style={{ marginBottom: 16 }}>
            <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 6 }}>
              ACCEPTABLE GRADING COMPANIES
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {GRADING_COMPANIES_LIST.map(c => {
                const checked = companies.includes(c);
                return (
                  <button key={c} type="button" onClick={() => toggleCompany(c)}
                    style={{
                      fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 100,
                      background: checked ? 'var(--plum)' : 'transparent',
                      color: checked ? 'var(--mustard)' : 'var(--plum)',
                      border: `1.5px solid ${checked ? 'var(--plum)' : 'var(--rule)'}`,
                      cursor: 'pointer',
                    }}>
                    {checked ? '✓ ' : ''}{c}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-mute)', marginTop: 6, fontStyle: 'italic' }}>
              Leave all unselected for "any company"
            </div>
          </div>
        )}

        <div style={{ marginBottom: 18 }}>
          <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 6 }}>
            GRADE RANGE
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: 'var(--ink-mute)', marginBottom: 3 }}>Low</div>
              <select value={low} onChange={(e) => setLow(e.target.value)} style={{ ...CELL_SELECT, padding: '6px 10px', fontSize: 13 }}>
                <option value="">— any —</option>
                {gradeOptions.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: 'var(--ink-mute)', marginBottom: 3 }}>High</div>
              <select value={high} onChange={(e) => setHigh(e.target.value)} style={{ ...CELL_SELECT, padding: '6px 10px', fontSize: 13 }}>
                <option value="">— any —</option>
                {gradeOptions.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--ink-mute)', marginTop: 6, fontStyle: 'italic' }}>
            {type === 'Raw'
              ? 'Low = worst acceptable, High = best acceptable. Leave both blank for "any condition".'
              : 'Low = lowest grade, High = highest grade. Leave both blank for "any grade".'}
          </div>
        </div>

        {isDefault && (
          <div style={{ marginBottom: 18, paddingTop: 14, borderTop: '1px dashed var(--rule)' }}>
            <div className="eyebrow" style={{ fontSize: 10, color: 'var(--orange)', marginBottom: 8 }}>
              MATCHING (eBay & Want-List Hits)
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginBottom: 10 }}>
              <input type="checkbox" checked={includeEquivalentGrades}
                onChange={(e) => setIncludeEquivalentGrades(e.target.checked)}
                style={{ marginTop: 3, cursor: 'pointer' }} />
              <div style={{ fontSize: 12.5, color: 'var(--plum)', lineHeight: 1.4 }}>
                <strong>Include equivalent grades across raw & graded</strong>
                <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
                  Raw EX ≈ PSA 5, NM ≈ PSA 7, etc. With this on, a Raw target also surfaces graded listings in the same grade range (and vice-versa). Company whitelist still applies to graded listings.
                </div>
              </div>
            </label>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={includeUpgrades}
                onChange={(e) => setIncludeUpgrades(e.target.checked)}
                style={{ marginTop: 3, cursor: 'pointer' }} />
              <div style={{ fontSize: 12.5, color: 'var(--plum)', lineHeight: 1.4 }}>
                <strong>Show upgrades for cards I already own at a lower grade</strong>
                <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
                  Owned rows whose grade is below the target still appear as wants; listings must be strictly better than the owned grade.
                </div>
              </div>
            </label>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={handleSave} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
            Save Target
          </button>
          <button type="button" onClick={handleClear} className="btn btn-sm" style={{
            background: 'transparent', color: 'var(--rust)', border: '1.5px solid var(--rust)', padding: '8px 14px',
          }}>
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

function SetInfoModal({ initial, onClose, onSave }: {
  initial: { title: string; year: string; brand: string; description: string; sport: string; purpose: 'personal' | 'inventory' | 'for-sale' };
  onClose: () => void;
  onSave: (patch: { title: string; year: string; brand: string; description: string; sport: string; purpose: 'personal' | 'inventory' | 'for-sale' }) => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [year, setYear] = useState(initial.year);
  const [brand, setBrand] = useState(initial.brand);
  const [description, setDescription] = useState(initial.description);
  const [sport, setSport] = useState(initial.sport || 'baseball');
  const [purpose, setPurpose] = useState<'personal' | 'inventory' | 'for-sale'>(initial.purpose || 'personal');
  const [error, setError] = useState('');

  function handleSave() {
    if (!title.trim()) { setError('Title is required.'); return; }
    onSave({ title: title.trim(), year: year.trim(), brand: brand.trim(), description: description.trim(), sport, purpose });
  }

  const fieldStyle: React.CSSProperties = {
    border: '1.5px solid var(--plum)', borderRadius: 6, padding: '7px 10px',
    fontFamily: 'var(--font-body)', fontSize: 13.5, color: 'var(--plum)',
    background: 'var(--cream)', width: '100%', boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = { fontSize: 9.5, color: 'var(--orange)', marginBottom: 4 };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(42,20,52,0.82)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '40px 20px', overflowY: 'auto',
    }}>
      <div onClick={(e) => e.stopPropagation()} className="panel-bordered"
        style={{ width: '100%', maxWidth: 520, padding: 26, background: 'var(--cream)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div className="display" style={{ fontSize: 22, color: 'var(--plum)', flex: 1 }}>Edit Set Info</div>
          <button type="button" onClick={onClose} className="btn btn-outline btn-sm">✕ Close</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div className="eyebrow" style={labelStyle}>Title *</div>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. 1956 Topps — Base Set" style={fieldStyle} autoFocus />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 130px', gap: 12 }}>
            <div>
              <div className="eyebrow" style={labelStyle}>Year</div>
              <input type="number" value={year} onChange={(e) => setYear(e.target.value)}
                placeholder="1956" style={fieldStyle} />
            </div>
            <div>
              <div className="eyebrow" style={labelStyle}>Brand</div>
              <input value={brand} onChange={(e) => setBrand(e.target.value)}
                placeholder="Topps" style={fieldStyle} />
            </div>
            <div>
              <div className="eyebrow" style={labelStyle}>Sport</div>
              <select value={sport} onChange={(e) => setSport(e.target.value)} style={fieldStyle}>
                <option value="baseball">Baseball</option>
                <option value="football">Football</option>
                <option value="basketball">Basketball</option>
                <option value="hockey">Hockey</option>
              </select>
            </div>
          </div>
          <div>
            <div className="eyebrow" style={labelStyle}>Description</div>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              rows={3} placeholder="Optional notes about the set"
              style={{ ...fieldStyle, resize: 'vertical' }} />
          </div>

          <div>
            <div className="eyebrow" style={labelStyle}>Purpose</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {([
                ['personal', '🧑 Personal Collection'],
                ['inventory', '🏷 Inventory (to sell)'],
                ['for-sale', '🛒 For Sale (active listing)'],
              ] as const).map(([val, label]) => (
                <button key={val} type="button" onClick={() => setPurpose(val)}
                  className={`btn btn-sm ${purpose === val ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ flex: 1, justifyContent: 'center', minWidth: 110 }}>
                  {label}
                </button>
              ))}
            </div>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', fontWeight: 600, marginTop: 6 }}>
              Drives the filter pills on My Shelf. Publishing a complete-set listing flips this to &quot;For Sale&quot; automatically.
            </div>
          </div>

          {error && (
            <div style={{
              background: 'rgba(197,74,44,0.1)', border: '1.5px solid var(--rust)',
              borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--rust)', fontWeight: 600,
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button type="button" onClick={handleSave} className="btn btn-primary"
              style={{ flex: 1, justifyContent: 'center' }}>
              Save Changes
            </button>
            <button type="button" onClick={onClose} className="btn btn-outline">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =====================  Component  ===================== */
export default function SetEditorPage() {
  const router = useRouter();
  const params = useParams();
  const paramSlug = String(params?.slug || "new");

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>('');
  const [canSell, setCanSell] = useState<boolean>(false);
  const [slug, setSlug] = useState<string>(paramSlug);
  const [datasetTitle, setDatasetTitle] = useState<string>("");
  const [year, setYear] = useState<string>("");
  const [brand, setBrand] = useState<string>("");
  const [desc, setDesc] = useState<string>("");
  // 'personal' (default) · 'inventory' (building to sell) · 'for-sale'
  // (currently has an active complete-set marketplace listing). The
  // List-Complete-Set publish flow flips this to 'for-sale' for the
  // seller; manual toggling lives in the Edit Info modal.
  const [purpose, setPurpose] = useState<'personal' | 'inventory' | 'for-sale'>('personal');
  const [sport, setSport] = useState<string>("baseball");
  const [rows, setRows] = useState<Array<Record<string, any>>>([]);
  const [saveStatus, setSaveStatus] = useState<string>("");
  const [showNeededOnly, setShowNeededOnly] = useState<boolean>(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [isShared, setIsShared] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [targetEditIndex, setTargetEditIndex] = useState<number | null>(null);
  // Page-level lightbox state, lifted out of ImageCell so prev/next can
  // walk every image in the visible set (not just the front/back of the
  // card the user clicked).
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [bulkField, setBulkField] = useState<string>('Owned');
  const [bulkValue, setBulkValue] = useState<string>('Yes');
  const [scansPickerOpen, setScansPickerOpen] = useState(false);
  // "List Complete Set" modal: turns the whole set into a single
  // marketplace listing (one price, one transaction). Default count of
  // owned cards is pulled from rows so the seller sees what they're
  // committing to before naming a price.
  const [listSetOpen, setListSetOpen] = useState(false);
  const [existingSetListing, setExistingSetListing] = useState<{ id: string; status: string; asking_price: number | null } | null>(null);
  // Tag # column is opt-in — most users won't use inventory tags so we
  // keep it hidden by default. Pref is per-browser via localStorage.
  const [showTagColumn, setShowTagColumn] = useState<boolean>(false);
  useEffect(() => {
    try { if (typeof window !== 'undefined' && localStorage.getItem(TAG_VISIBLE_KEY) === '1') setShowTagColumn(true); } catch {}
  }, []);
  function toggleTagColumn() {
    setShowTagColumn(v => {
      const next = !v;
      try { localStorage.setItem(TAG_VISIBLE_KEY, next ? '1' : '0'); } catch {}
      return next;
    });
  }
  const [autoNumOpen, setAutoNumOpen] = useState(false);
  const [autoNumPrefix, setAutoNumPrefix] = useState('');
  // Map of source_row_id → { id, status } for any non-removed listings
  // sourced from this set. Powers the per-row "🔗 View listing" link.
  const [listingsByRowId, setListingsByRowId] = useState<Record<string, { id: string; status: string }>>({});
  const [autoNumStart, setAutoNumStart] = useState('001');
  function descriptorForRow(row: Record<string, unknown>): CardDescriptor {
    const grade = String(row['Grade'] || '').trim() || null;
    const gradingCompany = String(row['Grading Company'] || '').trim() || null;
    const rawGrade = String(row['Raw Grade'] || '').trim() || null;
    // A card counts as graded when the Grading Company is filled in — no
    // separate yes/no flag any more.
    const isGraded = !!gradingCompany;
    return {
      year: year ? Number(year) || null : null,
      brand: brand || null,
      card_number: String(row['Card #'] || '').trim() || null,
      player: String(row['Player'] || '').trim() || null,
      grade: isGraded ? grade : null,
      grading_company: isGraded ? gradingCompany : null,
      raw_grade: !isGraded ? rawGrade : null,
      set_slug: slug,
      set_card_number: String(row['Card #'] || '').trim() || null,
    };
  }
  const [researchTarget, setResearchTarget] = useState<{ rowIndex: number; descriptor: CardDescriptor } | null>(null);
  const [valueFocusPrompt, setValueFocusPrompt] = useState<number | null>(null);
  const [researchPromptDismissed, setResearchPromptDismissed] = useState(false);

  // Per-card price trend (up/down vs the prior committed analysis), keyed by the
  // shared card-identity tuple. Drives the ▲/▼ badge next to each Value cell.
  const [valueTrends, setValueTrends] = useState<Record<string, Trend>>({});
  const loadValueTrends = React.useCallback(async () => {
    if (!userId || !slug || slug === 'new') { setValueTrends({}); return; }
    const supabase = createClient();
    const { data } = await supabase.from('card_value_history')
      .select('card_year, card_brand, card_number, card_grade, card_grading_company, card_raw_grade, market_value, created_at')
      .eq('user_id', userId).eq('set_slug', slug);
    const groups: Record<string, { market_value: number; created_at: string }[]> = {};
    for (const r of (data || []) as Array<Record<string, any>>) {
      const key = cardValueKey({
        year: r.card_year, brand: r.card_brand, card_number: r.card_number,
        grade: r.card_grade, grading_company: r.card_grading_company, raw_grade: r.card_raw_grade,
      });
      (groups[key] ||= []).push({ market_value: r.market_value, created_at: r.created_at });
    }
    const trends: Record<string, Trend> = {};
    for (const k of Object.keys(groups)) { const t = trendFromRows(groups[k]); if (t) trends[k] = t; }
    setValueTrends(trends);
  }, [userId, slug]);
  useEffect(() => { loadValueTrends(); }, [loadValueTrends]);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage.getItem('sc-research-prompt-dismissed') === '1') {
        setResearchPromptDismissed(true);
      }
    } catch {}
  }, []);
  // Set-level default target. The two boolean flags below are stored
  // inside the same default_target JSONB column (no schema migration —
  // JSONB extends freely). They drive the cross-type and upgrade
  // logic in /api/feed/ebay-hits — see the wants loop there.
  const [defaultTarget, setDefaultTarget] = useState<{
    type: string; low: string; high: string; companies: string;
    include_equivalent_grades: boolean;
    include_upgrades: boolean;
  }>({ type: '', low: '', high: '', companies: '', include_equivalent_grades: false, include_upgrades: false });
  const [defaultTargetOpen, setDefaultTargetOpen] = useState(false);
  const [infoEditOpen, setInfoEditOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUserId(user.id);
      setUserEmail(user.email || '');
      // Sellers (and admins) see the per-row "$ List" action and the
      // 📷 Add Scans entry. We fall back to the bootstrap admin email so
      // the button shows even if the DB row hasn't been written yet.
      const { data: prof } = await supabase
        .from('user_profiles')
        .select('can_sell, is_admin')
        .eq('user_id', user.id)
        .maybeSingle();
      const adminFlag = !!prof?.is_admin || user.email === 'jbanks@sports-collective.com';
      setCanSell(!!prof?.can_sell || adminFlag);
           if (paramSlug !== "new") {
        const { data, error } = await supabase
          .from("sets")
          .select("*")
          .eq("user_id", user.id)
          .eq("slug", paramSlug)
          .maybeSingle();
        if (error) {
          console.error("[set editor] failed to load set:", error);
        }
        if (data) {
          setSlug(paramSlug);
          setDatasetTitle(data.title || "");
          setYear(data.year ? String(data.year) : "");
          setBrand(data.brand ?? "");
          setDesc(data.description ?? "");
          setSport(data.sport || "baseball");
          setPurpose((data.purpose as 'personal' | 'inventory' | 'for-sale') || 'personal');
          // ensureRowIds backfills a stable _id on every row that's missing
          // one (legacy sets saved before per-row identity existed). The
          // backfilled IDs get persisted on the next autosave.
          setRows(ensureRowIds(migrateRows(data.rows ?? [])));

          // Pull listings sourced from this set so we can render a "🔗 View
          // listing" deep-link on rows that are currently on the marketplace.
          // Indexed by source_row_id (the new linkage). Soft-deleted/removed
          // listings are excluded.
          if (paramSlug) {
            const { data: linkedListings } = await supabase
              .from('listings')
              .select('id, status, source_row_id')
              .eq('user_id', user.id)
              .eq('source_set_slug', paramSlug)
              .neq('status', 'removed');
            const map: Record<string, { id: string; status: string }> = {};
            for (const r of (linkedListings || []) as { id: string; status: string; source_row_id: string | null }[]) {
              if (r.source_row_id) map[r.source_row_id] = { id: r.id, status: r.status };
            }
            setListingsByRowId(map);

            // Existing complete-set listing (if any) so the "List Complete
            // Set" button can switch into edit mode instead of creating a
            // duplicate. We allow only one active set listing per set.
            const { data: setListings } = await supabase
              .from('listings')
              .select('id, status, asking_price')
              .eq('user_id', user.id)
              .eq('listing_type', 'set')
              .eq('set_slug', paramSlug)
              .neq('status', 'removed')
              .order('created_at', { ascending: false })
              .limit(1);
            if (setListings && setListings[0]) setExistingSetListing(setListings[0] as { id: string; status: string; asking_price: number | null });
          }
          setShareToken(data.share_token ?? null);
          setIsShared(!!data.share_token);
          const dt = data.default_target as {
            type?: string; low?: string; high?: string; companies?: string;
            include_equivalent_grades?: boolean;
            include_upgrades?: boolean;
          } | null;
          if (dt) {
            setDefaultTarget({
              type: dt.type || '',
              low: dt.low || '',
              high: dt.high || '',
              companies: dt.companies || '',
              include_equivalent_grades: !!dt.include_equivalent_grades,
              include_upgrades: !!dt.include_upgrades,
            });
          }
        }
      }
    }
    init();
  }, [paramSlug, router]);

  function scheduleAutoSave(nextRows?: any[]) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (!slug || slug === "new" || !datasetTitle || !userId) return;
      const theRows = nextRows ?? rows;
      const { ownedCount, ownedPct } = computeOwnedStats(theRows);
      const { totalCost, totalValue, gainLoss } = computeFinancials(theRows);
      const supabase = createClient();
      await supabase.from("sets").upsert({
        user_id: userId, slug, title: datasetTitle,
        year: Number(year) || null, brand, description: desc,
        owner_email: userEmail,
        purpose,
        rows: theRows, row_count: theRows.length,
        owned_count: ownedCount, owned_pct: ownedPct,
        total_cost: totalCost, total_value: totalValue, gain_loss: gainLoss,
        updated_at: Date.now(),
      }, { onConflict: "user_id,slug" });
      setSaveStatus(`Saved at ${new Date().toLocaleTimeString()}`);
    }, 600);
  }

async function handleImageUpload(origIndex: number, slot: 1 | 2, file: File) {
  if (!userId || !slug || slug === "new") return;
  const supabase = createClient();
  const trimmed = await cropScanPadding(file);
  const ext = trimmed.name.split(".").pop() || "jpg";
  const path = `${userId}/${slug}/${origIndex}/img${slot}.${ext}`;
  const { error } = await supabase.storage.from("card-images").upload(path, trimmed, { upsert: true });
  if (error) { alert("Image upload failed: " + error.message); return; }
  const { data } = supabase.storage.from("card-images").getPublicUrl(path);
  const field = slot === 1 ? "Image 1" : "Image 2";
    const publicUrl = `${data.publicUrl}?t=${Date.now()}`;
  const nextRows = rows.map((r, i) => i === origIndex ? { ...r, [field]: publicUrl } : r);
  setRows(nextRows);
  scheduleAutoSave(nextRows);
}
   async function saveDefaultTarget(patch: {
    type: string; low: string; high: string; companies: string;
    include_equivalent_grades: boolean;
    include_upgrades: boolean;
  }) {
    if (!userId || !slug || slug === 'new') return;
    const supabase = createClient();
    const nextRows = rows.map((r) => {
      if (String(r['Owned'] || '') === 'Yes') return r;
      return {
        ...r,
        'Target Type': patch.type,
        'Target Condition - Low': patch.low,
        'Target Condition - High': patch.high,
        'Target Grading Companies': patch.companies,
      };
    });
    await supabase.from('sets').update({ default_target: patch, rows: nextRows }).eq('user_id', userId).eq('slug', slug);
    setDefaultTarget(patch);
    setRows(nextRows);
  }

  function handleListForSale(row: Record<string, any>) {
    // Immediately mark the row Not Owned in local state — the card is on
    // its way to the marketplace as a draft listing, so the set view
    // should reflect that even before the listing is created. If the
    // seller cancels the listing form they can manually flip Owned back.
    // Image archive behavior matches the existing "owned toggle":
    // photos move to "Image N Archived" so the row renders imageless.
    // Flip the specific row (by _id) — not every row sharing the same
    // Card #. Without this, duplicate cards (two Brosnan #2's etc.) all
    // get marked Not Owned at once.
    const rowId = typeof row['_id'] === 'string' ? row['_id'] : '';
    if (rowId) {
      const { nextRows, touched } = applyOwnedTransition(
        rows, { rowIds: new Set([rowId]) }, false,
      );
      if (touched) {
        setRows(nextRows);
        scheduleAutoSave(nextRows);
      }
    }

    const params = new URLSearchParams({ prefill: '1' });
    if (year) params.set('year', String(year));
    if (brand) params.set('brand', String(brand));
    if (row['Card #']) params.set('card', String(row['Card #']));
    if (row['Player']) params.set('player', String(row['Player']));
    // Thread the source row id through to the listing so we can flip the
    // right specific row on sold/cancel events, not the whole card-number
    // group. setSlug + rowId together uniquely identify the source.
    if (rowId) params.set('source_row_id', rowId);
    if (slug) params.set('source_set_slug', String(slug));
    if (row['Card #']) params.set('source_card_number', String(row['Card #']));
    if (String(row['Grading Company'] || '').trim()) {
      params.set('condition_type', 'graded');
      params.set('grading_company', String(row['Grading Company']));
      if (row['Grade']) params.set('grade', String(row['Grade']));
    } else if (row['Raw Grade']) {
      params.set('condition_type', 'raw');
      params.set('raw_grade', String(row['Raw Grade']));
    }
    const cost = String(row['Cost'] || '').replace(/[^0-9.]/g, '');
    if (cost) params.set('cost', cost);
    const tag = String(row['Tag #'] || '').trim();
    if (tag) params.set('tag', tag);
    const img1 = String(row['Image 1'] || '');
    const img2 = String(row['Image 2'] || '');
    if (img1) params.append('photo', img1);
    if (img2) params.append('photo', img2);
    router.push(`/listings?${params.toString()}`);
  }

  // Bulk version of handleListForSale: build draft listings for every
  // selected row that's owned + not already linked to a listing, insert
  // them in one batch, then flip the source rows to Not Owned. Used from
  // the bulk-edit toolbar when the set's purpose is 'inventory'. No
  // condition validation here — drafts can land incomplete; the seller
  // fills in any missing condition/grade on /listings before activating.
  async function handleBulkSendToMarketplace() {
    if (selectedRows.size === 0 || !userId) return;

    const selectedIndices = Array.from(selectedRows).sort((a, b) => a - b);
    const eligibleRows: { row: Record<string, any>; origIndex: number }[] = [];
    let skippedNotOwned = 0;
    let skippedAlreadyListed = 0;

    for (const idx of selectedIndices) {
      const row = rows[idx];
      if (!row) continue;
      if (String(row['Owned'] || '') !== 'Yes') { skippedNotOwned++; continue; }
      const rowId = typeof row['_id'] === 'string' ? row['_id'] : '';
      // Skip rows that already have an open listing — the per-row Sell button
      // hides itself in that case (see line ~1480) and bulk should mirror.
      // listingsByRowId is keyed by row id; "linked" means the row already
      // has a non-removed listing. Same gate the per-row Sell button uses.
      const linked = rowId ? listingsByRowId[rowId] : null;
      if (linked && linked.status !== 'sold') {
        skippedAlreadyListed++;
        continue;
      }
      eligibleRows.push({ row, origIndex: idx });
    }

    if (eligibleRows.length === 0) {
      alert(`Nothing to send. Selected ${selectedIndices.length} card${selectedIndices.length === 1 ? '' : 's'}: ${skippedNotOwned} not marked Owned, ${skippedAlreadyListed} already listed.`);
      return;
    }

    const summary = [
      `Send ${eligibleRows.length} card${eligibleRows.length === 1 ? '' : 's'} to your marketplace drafts?`,
      skippedNotOwned > 0 ? `${skippedNotOwned} not-owned card${skippedNotOwned === 1 ? '' : 's'} will be skipped.` : '',
      skippedAlreadyListed > 0 ? `${skippedAlreadyListed} already-listed card${skippedAlreadyListed === 1 ? '' : 's'} will be skipped.` : '',
      'Each card will be marked Not Owned and a draft listing will be created. You can edit or activate the drafts from My Listings.',
    ].filter(Boolean).join('\n\n');
    if (!confirm(summary)) return;

    const supabase = createClient();

    // Build the draft-listing payload. Mirrors handleListForSale's per-row
    // mapping plus the buildListingTitle call so titles render correctly.
    const payload = eligibleRows.map(({ row }) => {
      const rowId = typeof row['_id'] === 'string' ? row['_id'] : null;
      const gradingCompany = String(row['Grading Company'] || '').trim();
      const gradeVal = String(row['Grade'] || '').trim();
      const rawGrade = String(row['Raw Grade'] || '').trim();
      const conditionType: 'raw' | 'graded' = gradingCompany ? 'graded' : 'raw';
      const cost = String(row['Cost'] || '').replace(/[^0-9.]/g, '');
      const target = String(row['Target Price'] || '').replace(/[^0-9.]/g, '');
      const photos: string[] = [];
      const img1 = String(row['Image 1'] || '');
      const img2 = String(row['Image 2'] || '');
      if (img1) photos.push(img1);
      if (img2) photos.push(img2);

      const titleFields = {
        year: year ? Number(year) : null,
        brand: brand || null,
        card_number: row['Card #'] ? String(row['Card #']) : null,
        player: row['Player'] ? String(row['Player']) : null,
        condition_type: conditionType,
        raw_grade: conditionType === 'raw' ? (rawGrade || null) : null,
        grading_company: conditionType === 'graded' ? (gradingCompany || null) : null,
        grade: conditionType === 'graded' ? (gradeVal || null) : null,
      };

      return {
        user_id: userId,
        title: buildListingTitle(titleFields),
        year: titleFields.year,
        brand: titleFields.brand,
        card_number: titleFields.card_number,
        player: titleFields.player,
        condition_type: conditionType,
        raw_grade: titleFields.raw_grade,
        grading_company: titleFields.grading_company,
        grade: titleFields.grade,
        asking_price: target ? Number(target) : null,
        cost: cost ? Number(cost) : null,
        tag_number: String(row['Tag #'] || '').trim() || null,
        photos,
        status: 'draft' as const,
        description: null,
        source_set_slug: slug || null,
        source_card_number: row['Card #'] ? String(row['Card #']) : null,
        source_row_id: rowId,
      };
    });

    const { data: created, error } = await supabase.from('listings').insert(payload).select('id');
    if (error) {
      alert(`Failed to create drafts: ${error.message}`);
      return;
    }

    // Flip every successfully-sent row to Not Owned in one pass.
    const sentRowIds = new Set(
      eligibleRows.map(({ row }) => typeof row['_id'] === 'string' ? row['_id'] : '').filter(Boolean)
    );
    if (sentRowIds.size > 0) {
      const { nextRows, touched } = applyOwnedTransition(rows, { rowIds: sentRowIds }, false);
      if (touched) {
        setRows(nextRows);
        scheduleAutoSave(nextRows);
      }
    }
    clearSelection();

    const n = (created || []).length;
    if (confirm(`Created ${n} draft listing${n === 1 ? '' : 's'}. Open My Listings now to review and activate?`)) {
      router.push('/listings');
    }
  }

  function onChangeCell(index: number, field: string, value: any) {
    const copy = [...rows];
    const r = { ...copy[index] };
    if (field === "Purchased From" && value.length > 50) r[field] = value.slice(0, 50);
    else if (CURRENCY_FIELDS.includes(field as any)) r[field] = value;
    else if (field === "Date Purchased") r[field] = autoSlashDate(value);
    else r[field] = value;
    copy[index] = r;
    setRows(copy);
    scheduleAutoSave(copy);
  }

  function toggleRowSelected(origIndex: number) {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(origIndex)) next.delete(origIndex);
      else next.add(origIndex);
      return next;
    });
  }
  function toggleSelectAllVisible() {
    const visibleIndices = displayRows.map(r => r.origIndex);
    const allVisibleSelected = visibleIndices.every(i => selectedRows.has(i));
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIndices.forEach(i => next.delete(i));
      else visibleIndices.forEach(i => next.add(i));
      return next;
    });
  }
  function clearSelection() { setSelectedRows(new Set()); }

  // Stable sort by Card # (numeric-aware so "5" < "11"). Rows with no
  // Card # go to the end in their original relative order. Used after
  // adding or duplicating rows so the new entries land next to their
  // numbered neighbors instead of at the bottom of the table.
  function sortRowsByCardNumber(rs: Array<Record<string, any>>): Array<Record<string, any>> {
    return rs
      .map((r, i) => ({ r, i }))
      .sort((a, b) => {
        const ca = String(a.r['Card #'] ?? '').trim();
        const cb = String(b.r['Card #'] ?? '').trim();
        if (!ca && !cb) return a.i - b.i;
        if (!ca) return 1;
        if (!cb) return -1;
        const cmp = ca.localeCompare(cb, undefined, { numeric: true });
        return cmp !== 0 ? cmp : a.i - b.i;
      })
      .map(({ r }) => r);
  }

  function addRow() {
    const blank: Record<string, any> = {};
    EXPECTED_HEADERS.forEach(h => { blank[h] = ''; });
    // New blank rows have no Card #, so they naturally land at the bottom
    // — which is the right spot to start typing. Sort runs anyway so the
    // ordering is canonical after every mutation.
    const next = sortRowsByCardNumber([...rows, blank]);
    setRows(next);
    scheduleAutoSave(next);
  }
  function deleteSelected() {
    if (selectedRows.size === 0) return;
    if (!confirm(`Delete ${selectedRows.size} row${selectedRows.size === 1 ? '' : 's'}? This cannot be undone.`)) return;
    const next = rows.filter((_, i) => !selectedRows.has(i));
    setRows(next);
    setSelectedRows(new Set());
    scheduleAutoSave(next);
  }
  function duplicateSelected() {
    if (selectedRows.size === 0) return;
    const copies = rows.filter((_, i) => selectedRows.has(i)).map(r => ({ ...r }));
    // Sort puts each duplicate right next to its source row (same Card #)
    // instead of dumping them all at the end of the list.
    const next = sortRowsByCardNumber([...rows, ...copies]);
    setRows(next);
    setSelectedRows(new Set());
    scheduleAutoSave(next);
  }

  function applyBulkEdit() {
    if (selectedRows.size === 0) return;
    let value: any = bulkValue;
    if (bulkField === 'Grade') value = normalizeNumericGrade(bulkValue);
    else if (CURRENCY_FIELDS.includes(bulkField as any)) {
      const s = stripCurrency(String(bulkValue));
      value = s === '' ? '' : toCurrency(s);
    } else if (bulkField === 'Date Purchased') value = autoSlashDate(bulkValue);
    const next = rows.map((r, i) => selectedRows.has(i) ? { ...r, [bulkField]: value } : r);
    setRows(next);
    scheduleAutoSave(next);
  }
  // Auto-number tag # across the selected rows. Width inferred from the
  // start input so the user controls zero-padding (type "001" for 3-wide,
  // "1" for none). Sequence follows the rows' current selection order
  // (smallest origIndex first) so it tracks the table's visual order.
  function applyAutoNumberTags() {
    if (selectedRows.size === 0) return;
    const start = Number(autoNumStart.trim());
    if (!autoNumStart.trim() || Number.isNaN(start) || start < 0) return;
    const width = autoNumStart.trim().length;
    const sortedIdx = Array.from(selectedRows).sort((a, b) => a - b);
    const next = [...rows];
    sortedIdx.forEach((rowIdx, i) => {
      const n = start + i;
      const padded = String(n).padStart(width, '0');
      next[rowIdx] = { ...next[rowIdx], 'Tag #': `${autoNumPrefix}${padded}` };
    });
    setRows(next);
    scheduleAutoSave(next);
    setAutoNumOpen(false);
    if (!showTagColumn) toggleTagColumn();
  }
  function onBlurCurrency(index: number, field: string) {
    const copy = [...rows];
    const r = { ...copy[index] };
    const raw = stripCurrency(String(r[field] ?? ""));
    r[field] = raw ? toCurrency(raw) : "";
    copy[index] = r;
    setRows(copy);
    scheduleAutoSave(copy);
  }
  function onBlurDate(index: number) {
    const copy = [...rows];
    const s = String(copy[index]["Date Purchased"] ?? "");
    if (s && !isValidMMDDYYYY(s)) alert(`Invalid date: ${s}. Use MM/DD/YYYY`);
    scheduleAutoSave(copy);
  }

  async function handleImageDelete(origIndex: number, slot: 1 | 2) {
    if (!userId || !slug || slug === 'new') return;
    const field = slot === 1 ? 'Image 1' : 'Image 2';
    const url = rows[origIndex]?.[field];
    if (url) {
      const supabase = createClient();
      const ext = url.split('.').pop()?.split('?')[0] || 'jpg';
      const path = `${userId}/${slug}/${origIndex}/img${slot}.${ext}`;
      await supabase.storage.from('card-images').remove([path]);
    }
    const nextRows = rows.map((r, i) => i === origIndex ? { ...r, [field]: '' } : r);
    setRows(nextRows);
    scheduleAutoSave(nextRows);
  }

  function handleExport() {
    if (!rows.length) { alert("No data to export."); return; }
    downloadCSV(datasetTitle || "sportscard-export", rows);
  }

  async function handleExportWantListPdf() {
    if (!rows.length) { alert("No data to export."); return; }
    const needed = rows.filter(r => String(r["Owned"] ?? "").toLowerCase() !== "yes");
    if (!needed.length) {
      alert("No needed cards to export — every card in this set is marked Owned.");
      return;
    }

    function rowTarget(r: Record<string, any>): string {
      const lo = String(r["Target Condition - Low"] ?? "").trim();
      const hi = String(r["Target Condition - High"] ?? "").trim();
      const type = String(r["Target Type"] ?? "").trim();
      const range = lo && hi && lo !== hi ? `${lo}–${hi}` : (lo || hi);
      if (!range) return "";
      return type ? `${type} ${range}` : range;
    }

    const dtRange = defaultTarget.low && defaultTarget.high && defaultTarget.low !== defaultTarget.high
      ? `${defaultTarget.low}–${defaultTarget.high}`
      : (defaultTarget.low || defaultTarget.high || "");
    const defaultLine = dtRange
      ? [defaultTarget.type, dtRange, defaultTarget.companies].filter(Boolean).join(" · ")
      : null;

    // Strip the team / suffix off the description so only the player name
    // is printed: most card descriptions follow "Player – Team" with an
    // em-dash, en-dash, or hyphen surrounded by spaces. If no separator is
    // found, keep the full description unchanged.
    function playerOnly(desc: string): string {
      return desc.replace(/\s+[–—-]\s+.*$/, '').trim();
    }

    const yearBrand = [year, brand].filter(Boolean).join(" ");
    const pdfRows = needed.map(r => {
      // The column was renamed "Description" → "Player" some time ago.
      // New rows store under "Player"; legacy rows still carry
      // "Description". Prefer Player and fall back to Description.
      const raw = String(r["Player"] ?? r["Description"] ?? "").trim();
      return {
        cardNumber: String(r["Card #"] ?? "").trim(),
        description: playerOnly(raw),
        targetGrade: rowTarget(r),
      };
    });

    const blob = await generateWantListPdf({
      setTitle: datasetTitle || "Untitled set",
      yearBrand,
      defaultTargetLine: defaultLine,
      rows: pdfRows,
      contactNote: "Bring this sheet to the table — checked rows are picked up.",
    });
    const fname = (datasetTitle || "want-list").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    downloadPdf(`${fname}-want-list.pdf`, blob);
  }

  async function handleToggleShare() {
    if (!datasetTitle || !rows.length || !userId || !slug || slug === 'new') return;
    const supabase = createClient();
    if (isShared) {
      await supabase.from('sets').update({ share_token: null }).eq('user_id', userId).eq('slug', slug);
      setShareToken(null);
      setIsShared(false);
    } else {
      const token = crypto.randomUUID();
      await supabase.from('sets').update({ share_token: token }).eq('user_id', userId).eq('slug', slug);
      setShareToken(token);
      setIsShared(true);
    }
  }

  const displayRows = useMemo(() => {
    let filtered = rows.map((r, idx) => ({ row: r, origIndex: idx }));
    if (showNeededOnly) filtered = filtered.filter(({ row }) => String(row["Owned"] ?? "") !== "Yes");
    if (!sortKey) return filtered;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if ((CURRENCY_FIELDS as readonly string[]).includes(sortKey)) {
        const an = stripCurrency(String(a.row[sortKey] ?? "")) === "" ? null : Number(stripCurrency(String(a.row[sortKey] ?? "")));
        const bn = stripCurrency(String(b.row[sortKey] ?? "")) === "" ? null : Number(stripCurrency(String(b.row[sortKey] ?? "")));
        const aZ = an === null || an === 0, bZ = bn === null || bn === 0;
        if (aZ !== bZ) return aZ ? 1 : -1;
        if (an === null && bn === null) return 0;
        return (an! < bn! ? -1 : an! > bn! ? 1 : 0) * dir;
      }
      // Card # is alphanumeric (e.g. "T1", "234A"). Use localeCompare
      // in numeric mode so "5" < "11" < "234" < "234A" < "T1" < "T15"
      // — the same comparator sortRowsByCardNumber uses for add/dupe
      // ordering. Blanks sink to the bottom in both sort directions.
      if (sortKey === "Card #") {
        const ca = String(a.row["Card #"] ?? "").trim();
        const cb = String(b.row["Card #"] ?? "").trim();
        if (!ca && !cb) return 0;
        if (!ca) return 1;
        if (!cb) return -1;
        return ca.localeCompare(cb, undefined, { numeric: true }) * dir;
      }
      const an = asNumberForSort(sortKey, a.row), bn = asNumberForSort(sortKey, b.row);
      if (an !== null || bn !== null) {
        if (an === null) return 1; if (bn === null) return -1;
        return (an < bn ? -1 : an > bn ? 1 : 0) * dir;
      }
      const at = textForSort(a.row[sortKey]), bt = textForSort(b.row[sortKey]);
      if (at === "" && bt !== "") return 1; if (bt === "" && at !== "") return -1;
      return at.localeCompare(bt) * dir;
    });
  }, [rows, showNeededOnly, sortKey, sortDir]);

  // Flat image list across every visible row, in the table's display order.
  // Used by the page-level lightbox so clicking any thumbnail lets the
  // user scroll through every photo in the set.
  const lightboxItems: LightboxItem[] = useMemo(() => {
    const items: LightboxItem[] = [];
    for (const { row, origIndex } of displayRows) {
      const cardNum = row['Card #'] ? String(row['Card #']) : '';
      const player = String(row['Player'] || row['Description'] || '');
      const img1 = String(row['Image 1'] || '');
      const img2 = String(row['Image 2'] || '');
      if (img1) items.push({ url: img1, origIndex, slot: 1, cardNum, player });
      if (img2) items.push({ url: img2, origIndex, slot: 2, cardNum, player });
    }
    return items;
  }, [displayRows]);

  function openLightboxFor(origIndex: number, slot: 1 | 2) {
    const flat = lightboxItems.findIndex(it => it.origIndex === origIndex && it.slot === slot);
    if (flat < 0) return;
    setLightboxIdx(flat);
  }

  function handleSortClick(key: SortKey) {
    if (sortKey !== key) { setSortKey(key); setSortDir(DEFAULT_DIR[key] ?? 'asc'); }
    else setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
  }

  const TH_STYLE: React.CSSProperties = {
    padding: '10px 12px', textAlign: 'left', whiteSpace: 'nowrap',
    background: 'var(--plum)', color: 'var(--mustard)',
    fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
    letterSpacing: '0.15em', textTransform: 'uppercase',
    position: 'sticky', top: 0, zIndex: 10,
  };

  // Freeze the first three columns (checkbox, Card #, Player+Notes) so they
  // stay visible while scrolling right. The Player column hosts the player
  // input PLUS a small Notes textarea, so it's wider than the other frozen
  // cells. Widths must match the actual cell widths.
  const FROZEN_W = { check: 36, cardNum: 96, player: 288, tag: 112 };
  const FROZEN_LEFT = {
    check: 0,
    cardNum: FROZEN_W.check,
    player: FROZEN_W.check + FROZEN_W.cardNum,
    tag: FROZEN_W.check + FROZEN_W.cardNum + FROZEN_W.player,
  };
  const FROZEN_RIGHT_BORDER: React.CSSProperties = { boxShadow: 'inset -2px 0 0 var(--plum)' };
  // Tag # joins the frozen block when activated, so the right-edge divider
  // moves from Player to Tag #.
  const PLAYER_RIGHT_BORDER: React.CSSProperties = showTagColumn ? {} : FROZEN_RIGHT_BORDER;

  function thFrozen(left: number, width: number, extra: React.CSSProperties = {}): React.CSSProperties {
    return { ...TH_STYLE, position: 'sticky', top: 0, left, width, minWidth: width, zIndex: 30, ...extra };
  }
  function tdFrozen(left: number, width: number, rowBg: string, extra: React.CSSProperties = {}): React.CSSProperties {
    return {
      position: 'sticky', left, width, minWidth: width,
      background: rowBg, zIndex: 5,
      padding: '6px 8px', verticalAlign: 'top', ...extra,
    };
  }

  function SortableHeader({ label, display }: { label: SortKey; display?: string }) {
    const isActive = sortKey === label;
    return (
      <th style={TH_STYLE}>
        <button type="button" onClick={() => handleSortClick(label)}
          style={{ color: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3, fontWeight: isActive ? 900 : 700 }}>
          {display || label} {isActive ? (sortDir === 'asc' ? "↑" : "↓") : ""}
        </button>
      </th>
    );
  }

  /* ------------------- Render ------------------- */
  return (
    <div style={{ minHeight: '100vh' }}>

      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(248, 236, 208, 0.94)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        borderBottom: '3px solid var(--plum)',
      }}>
        <div style={{ maxWidth: 1600, margin: '0 auto', padding: '10px 28px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link href="/home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0 }}>
            <SCLogo size={40} />
            <div style={{ lineHeight: 0.95 }}>
              <div className="wordmark" style={{ fontSize: 20, color: 'var(--orange)' }}>Sports</div>
              <div className="display" style={{ fontSize: 12, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
            </div>
          </Link>

          <Link href="/" className="btn btn-outline btn-sm" style={{ flexShrink: 0 }}>← My Shelf</Link>

          <div className="display" style={{ fontSize: 17, color: 'var(--plum)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {datasetTitle || 'New Set'}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            {saveStatus && (
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', fontWeight: 600 }}>{saveStatus}</span>
            )}
                        <button type="button" onClick={() => setDefaultTargetOpen(true)}
              disabled={!datasetTitle || !rows.length}
              className="btn btn-sm btn-ghost">
              ⚙ Default Target
            </button>
            <button type="button"
              onClick={handleToggleShare}
              disabled={!datasetTitle || !rows.length}
              className={`btn btn-sm ${isShared ? 'btn-outline' : 'btn-primary'}`}>
              {isShared ? 'Unshare' : 'Share'}
            </button>
            <button type="button" onClick={handleExport} disabled={!rows.length}
              className="btn btn-sm btn-outline">
              Export CSV
            </button>
            <button type="button" onClick={handleExportWantListPdf} disabled={!rows.length}
              className="btn btn-sm btn-outline"
              title="PDF want list with checkboxes — bring it to the card show">
              📄 Want List PDF
            </button>
            <button type="button" onClick={() => setListSetOpen(true)} disabled={!datasetTitle || !rows.length}
              className="btn btn-sm" style={{ background: 'var(--teal)', color: 'var(--cream)', border: '1.5px solid var(--teal)' }}
              title="List this set as one marketplace item with a single price">
              📚 List Complete Set
            </button>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1600, margin: '0 auto', padding: '28px 28px 80px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        <SetHeaderBanner year={year} brand={brand} title={datasetTitle} />

        {/* Controls */}
        {datasetTitle && (
          <div className="panel-bordered" style={{ padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
              <div className="display" style={{ fontSize: 16, color: 'var(--plum)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{datasetTitle}</div>
              <button type="button" onClick={() => setInfoEditOpen(true)} className="btn btn-ghost btn-sm" title="Edit set info">
                ✎ Edit info
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', fontWeight: 700 }}>{rows.length} rows</span>
              <button type="button" onClick={() => setShowNeededOnly(s => !s)}
                className={`btn btn-sm ${showNeededOnly ? 'btn-primary' : 'btn-ghost'}`}>
                {showNeededOnly ? 'Showing: Needed' : 'Show Needed Only'}
              </button>
              <button type="button" onClick={toggleTagColumn}
                title="Show or hide the inventory Tag # column"
                className={`btn btn-sm ${showTagColumn ? 'btn-primary' : 'btn-ghost'}`}>
                🏷 {showTagColumn ? 'Tag # column on' : 'Show Tag # column'}
              </button>
              <Link href={`/set/${encodeURIComponent(slug)}/view`} className="btn btn-sm btn-outline">
                View Inventory
              </Link>
              <button type="button" onClick={() => setScansPickerOpen(true)} className="btn btn-sm btn-outline">
                📷 Add Scans
              </button>
            </div>
          </div>
        )}

        {/* Bulk edit toolbar */}
        {selectedRows.size > 0 && (
          <div style={{
            position: 'sticky', top: 64, zIndex: 40,
            background: 'var(--plum)', color: 'var(--mustard)',
            padding: '10px 16px', marginBottom: 14,
            borderRadius: 12, border: '2px solid var(--plum)',
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <span className="eyebrow" style={{ color: 'var(--mustard)', fontSize: 11 }}>
              {selectedRows.size} selected
            </span>
            <span style={{ color: 'var(--mustard)', fontSize: 12, fontWeight: 600 }}>Set</span>
            <select value={bulkField} onChange={e => { setBulkField(e.target.value); setBulkValue(''); }}
              style={{ padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1.5px solid var(--mustard)', background: 'var(--cream)', color: 'var(--plum)', fontWeight: 600 }}>
              <option value="Owned">Owned</option>
              <option value="Raw Grade">Raw Grade</option>
              <option value="Grading Company">Grading Company</option>
              <option value="Grade">Grade</option>
              <option value="Cost">Cost</option>
              <option value="Value">Value</option>
              <option value="Target Price">Target Price</option>
              <option value="Sale Price">Sale Price</option>
              <option value="Date Purchased">Date Purchased</option>
              <option value="Purchased From">Purchased From</option>
            </select>
            <span style={{ color: 'var(--mustard)', fontSize: 12, fontWeight: 600 }}>to</span>
            {bulkField === 'Owned' ? (
              <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
                style={{ padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1.5px solid var(--mustard)', background: 'var(--cream)', color: 'var(--plum)', fontWeight: 600 }}>
                <option value=""></option>
                {YES_NO.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : bulkField === 'Raw Grade' ? (
              <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
                style={{ padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1.5px solid var(--mustard)', background: 'var(--cream)', color: 'var(--plum)', fontWeight: 600 }}>
                {RAW_GRADES.map(g => <option key={g} value={g}>{g || '(blank)'}</option>)}
              </select>
            ) : bulkField === 'Grading Company' ? (
              <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
                style={{ padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1.5px solid var(--mustard)', background: 'var(--cream)', color: 'var(--plum)', fontWeight: 600 }}>
                {COMPANIES.map(c => <option key={c} value={c}>{c || '(blank)'}</option>)}
              </select>
            ) : bulkField === 'Grade' ? (
              <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
                style={{ padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1.5px solid var(--mustard)', background: 'var(--cream)', color: 'var(--plum)', fontWeight: 600 }}>
                {GRADES_NUMERIC.map(g => <option key={g} value={g}>{g || '(blank)'}</option>)}
              </select>
            ) : (
              <input value={bulkValue} onChange={e => setBulkValue(e.target.value)}
                placeholder={CURRENCY_FIELDS.includes(bulkField as any) ? '$0.00' : bulkField === 'Date Purchased' ? 'MM/DD/YYYY' : ''}
                style={{ padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1.5px solid var(--mustard)', background: 'var(--cream)', color: 'var(--plum)', fontWeight: 600, minWidth: 140 }} />
            )}
            <button type="button" onClick={applyBulkEdit}
              className="btn btn-sm" style={{ background: 'var(--teal)', color: 'var(--cream)', border: '1.5px solid var(--teal)' }}>
              Apply to {selectedRows.size}
            </button>
            <button type="button" onClick={() => setAutoNumOpen(true)}
              className="btn btn-sm" style={{ background: 'var(--cream)', color: 'var(--plum)', border: '1.5px solid var(--cream)' }}>
              🏷 Auto-number Tag #
            </button>
            <button type="button" onClick={duplicateSelected}
              className="btn btn-sm" style={{ background: 'var(--mustard)', color: 'var(--plum)', border: '1.5px solid var(--mustard)' }}>
              📋 Duplicate
            </button>
            {canSell && purpose === 'inventory' && (
              <button type="button" onClick={handleBulkSendToMarketplace}
                title="Create draft listings for every selected card and flip the rows to Not Owned"
                className="btn btn-sm" style={{ background: 'var(--orange)', color: 'var(--cream)', border: '1.5px solid var(--orange)' }}>
                $ Send Selected to Marketplace
              </button>
            )}
            <button type="button" onClick={deleteSelected}
              className="btn btn-sm" style={{ background: 'var(--rust)', color: 'var(--cream)', border: '1.5px solid var(--rust)' }}>
              🗑 Delete
            </button>
            <button type="button" onClick={clearSelection}
              className="btn btn-sm" style={{ background: 'transparent', color: 'var(--mustard)', border: '1.5px solid var(--mustard)', marginLeft: 'auto' }}>
              Clear
            </button>
          </div>
        )}

        {/* Table */}
        {rows.length > 0 ? (
          <section className="panel-bordered" style={{ overflow: 'hidden', padding: 0 }}>
            <div style={{ maxHeight: '70vh', overflowY: 'auto', overflowX: 'auto' }}>
              <table style={{ minWidth: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thFrozen(FROZEN_LEFT.check, FROZEN_W.check)}>
                      <input type="checkbox"
                        checked={displayRows.length > 0 && displayRows.every(r => selectedRows.has(r.origIndex))}
                        onChange={toggleSelectAllVisible}
                        title="Select all visible"
                        style={{ cursor: 'pointer', accentColor: 'var(--plum)' }} />
                    </th>
                    <th style={thFrozen(FROZEN_LEFT.cardNum, FROZEN_W.cardNum)}>
                      <button type="button" onClick={() => handleSortClick('Card #')}
                        style={{ color: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3, fontWeight: sortKey === 'Card #' ? 900 : 700 }}>
                        Card # {sortKey === 'Card #' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th style={thFrozen(FROZEN_LEFT.player, FROZEN_W.player, PLAYER_RIGHT_BORDER)}>
                      <button type="button" onClick={() => handleSortClick('Player')}
                        style={{ color: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3, fontWeight: sortKey === 'Player' ? 900 : 700 }}>
                        Player {sortKey === 'Player' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    {showTagColumn && (
                      <th style={thFrozen(FROZEN_LEFT.tag, FROZEN_W.tag, FROZEN_RIGHT_BORDER)}>
                        <button type="button" onClick={() => handleSortClick('Tag #')}
                          style={{ color: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3, fontWeight: sortKey === 'Tag #' ? 900 : 700 }}>
                          Tag # {sortKey === 'Tag #' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                        </button>
                      </th>
                    )}
                    <SortableHeader label="Owned" />
                    <SortableHeader label="Raw Grade" />
                    <SortableHeader label="Grading Company" display="Grading Co." />
                    <SortableHeader label="Grade" />
                    <SortableHeader label="Cost" />
                    <SortableHeader label="Value" />
                    <SortableHeader label="Target Price" />
                    <th style={TH_STYLE}>Target</th>
                    <SortableHeader label="Sale Price" />
                    <SortableHeader label="Date Purchased" />
                    <SortableHeader label="Purchased From" />
                                       <th style={TH_STYLE}>Image 1</th>
                    <th style={TH_STYLE}>Image 2</th>
                    <th style={TH_STYLE}>Sell</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map(({ row, origIndex }, i) => {
                    const rowBg = selectedRows.has(origIndex) ? '#f0d8a3' : (i % 2 === 0 ? 'var(--cream)' : 'var(--paper)');
                    return (
                    <tr key={`${origIndex}-${i}`} style={{
                      borderTop: '1.5px solid var(--cream-warm)',
                      background: rowBg,
                    }}>
                      <td style={tdFrozen(FROZEN_LEFT.check, FROZEN_W.check, rowBg, { verticalAlign: 'middle', textAlign: 'center' })}>
                        <input type="checkbox"
                          checked={selectedRows.has(origIndex)}
                          onChange={() => toggleRowSelected(origIndex)}
                          style={{ cursor: 'pointer', accentColor: 'var(--plum)' }} />
                      </td>
                      <td style={tdFrozen(FROZEN_LEFT.cardNum, FROZEN_W.cardNum, rowBg)}>
                        <input value={v(row["Card #"])}
                          onChange={(e) => onChangeCell(origIndex, "Card #", e.target.value)}
                          style={{ ...CELL_INPUT, width: 72 }} />
                      </td>
                      <td style={tdFrozen(FROZEN_LEFT.player, FROZEN_W.player, rowBg, PLAYER_RIGHT_BORDER)}>
                        <input value={v(row["Player"])}
                          onChange={(e) => onChangeCell(origIndex, "Player", e.target.value)}
                          style={{ ...CELL_INPUT, width: 260 }} />
                        <input value={v(row["Notes"])}
                          onChange={(e) => onChangeCell(origIndex, "Notes", e.target.value)}
                          placeholder="notes"
                          title={v(row["Notes"]) || undefined}
                          style={{
                            ...CELL_INPUT,
                            width: 260, marginTop: 4,
                            fontSize: 11.5, fontStyle: 'italic',
                            color: 'var(--ink-soft)',
                          }} />
                      </td>
                      {showTagColumn && (
                        <td style={tdFrozen(FROZEN_LEFT.tag, FROZEN_W.tag, rowBg, FROZEN_RIGHT_BORDER)}>
                          <input value={v(row["Tag #"])}
                            onChange={(e) => onChangeCell(origIndex, "Tag #", e.target.value)}
                            placeholder="—"
                            style={{ ...CELL_INPUT, width: 96 }} />
                        </td>
                      )}
                      <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                        <select value={v(row["Owned"])} onChange={(e) => onChangeCell(origIndex, "Owned", e.target.value)} style={CELL_SELECT}>
                          {YES_NO.map((o) => <option key={o} value={o}>{o}</option>)}
                          <option value=""></option>
                        </select>
                      </td>
                      <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                        <select value={v(row["Raw Grade"])} onChange={(e) => onChangeCell(origIndex, "Raw Grade", e.target.value)} style={CELL_SELECT}>
                          {RAW_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                        <select value={v(row["Grading Company"])} onChange={(e) => onChangeCell(origIndex, "Grading Company", e.target.value)}
                          style={{ ...CELL_SELECT, width: 78, minWidth: 78 }}>
                          {COMPANIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                        <select value={v(row["Grade"])} onChange={(e) => onChangeCell(origIndex, "Grade", normalizeNumericGrade(e.target.value))} style={CELL_SELECT}>
                          {GRADES_NUMERIC.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                        <input value={v(row["Cost"])} onChange={(e) => onChangeCell(origIndex, "Cost", e.target.value)} onBlur={() => onBlurCurrency(origIndex, "Cost")} placeholder="$0.00" style={{ ...CELL_INPUT, width: 90 }} />
                      </td>
                      <td style={{ padding: '6px 8px', verticalAlign: 'top', position: 'relative' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input value={v(row["Value"])} onChange={(e) => onChangeCell(origIndex, "Value", e.target.value)} onBlur={() => { onBlurCurrency(origIndex, "Value"); setValueFocusPrompt(prev => prev === origIndex ? null : prev); }}
                            onFocus={() => { if (!researchPromptDismissed) setValueFocusPrompt(origIndex); }}
                            placeholder="$0.00" style={{ ...CELL_INPUT, width: 90 }} />
                          <button type="button" title="Research market price" aria-label="Research market price"
                            onMouseDown={(e) => { e.preventDefault(); setResearchTarget({ rowIndex: origIndex, descriptor: descriptorForRow(row) }); setValueFocusPrompt(null); }}
                            style={{ background: 'transparent', border: 0, color: 'var(--teal)', cursor: 'pointer', fontSize: 14, padding: 2 }}>📈</button>
                          {(() => {
                            const t = valueTrends[cardValueKey(descriptorForRow(row))];
                            if (!t) return null;
                            const color = t.direction === 'up' ? 'var(--teal)' : t.direction === 'down' ? 'var(--rust)' : 'var(--ink-mute)';
                            const arrow = t.direction === 'up' ? '▲' : t.direction === 'down' ? '▼' : '→';
                            const label = t.pct !== null ? `${t.pct >= 0 ? '+' : ''}${t.pct.toFixed(0)}%` : '';
                            return (
                              <span title={`Latest $${t.latest.toFixed(2)} vs prior $${t.previous.toFixed(2)}`}
                                style={{ fontSize: 10, fontWeight: 700, color, whiteSpace: 'nowrap' }}>
                                {arrow}{label}
                              </span>
                            );
                          })()}
                        </div>
                        {valueFocusPrompt === origIndex && !researchPromptDismissed && (
                          <div style={{ position: 'absolute', top: '100%', left: 8, marginTop: 4, zIndex: 30, background: 'var(--paper)', border: '1.5px solid var(--plum)', borderRadius: 8, padding: '8px 10px', boxShadow: '0 6px 14px rgba(42,20,52,0.18)', width: 230 }}>
                            <div style={{ fontSize: 12, color: 'var(--plum)', fontWeight: 700, marginBottom: 6 }}>Research market price?</div>
                            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 8 }}>
                              Build a weighted comp from eBay / VCP / etc. — saved for future reference.
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button type="button" onMouseDown={(e) => { e.preventDefault(); setResearchTarget({ rowIndex: origIndex, descriptor: descriptorForRow(row) }); setValueFocusPrompt(null); }}
                                className="btn btn-primary btn-sm" style={{ fontSize: 11 }}>📈 Open</button>
                              <button type="button" onMouseDown={(e) => { e.preventDefault(); setValueFocusPrompt(null); }}
                                className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>Just type</button>
                            </div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11, color: 'var(--ink-mute)', cursor: 'pointer' }}>
                              <input type="checkbox" onChange={(e) => {
                                if (e.target.checked) {
                                  try { window.localStorage.setItem('sc-research-prompt-dismissed', '1'); } catch {}
                                  setResearchPromptDismissed(true);
                                  setValueFocusPrompt(null);
                                }
                              }} />
                              Don&apos;t ask again
                            </label>
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                        <input value={v(row["Target Price"])} onChange={(e) => onChangeCell(origIndex, "Target Price", e.target.value)} onBlur={() => onBlurCurrency(origIndex, "Target Price")} placeholder="$0.00" style={{ ...CELL_INPUT, width: 90 }} />
                      </td>
                      <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                        {String(row["Owned"] || '') === 'Yes' ? (
                          <span style={{ color: 'var(--ink-mute)', fontSize: 11, fontStyle: 'italic' }}>—</span>
                        ) : (() => {
                          const explicit = summarizeTarget(row);
                          const hasDefault = !!(defaultTarget.type || defaultTarget.low || defaultTarget.high);
                          const inherited = !explicit.isSet && hasDefault;
                          let text: string;
                          if (explicit.isSet) text = explicit.text;
                          else if (inherited) {
                            const defSummary = summarizeTarget({
                              'Target Type': defaultTarget.type,
                              'Target Condition - Low': defaultTarget.low,
                              'Target Condition - High': defaultTarget.high,
                              'Target Grading Companies': defaultTarget.companies,
                            });
                            text = `↳ ${defSummary.text}`;
                          } else text = '— set target —';
                          return (
                            <button type="button" onClick={() => setTargetEditIndex(origIndex)}
                              style={{
                                background: explicit.isSet ? 'var(--paper)' : 'transparent',
                                color: inherited ? 'var(--ink-mute)' : (explicit.isSet ? 'var(--plum)' : 'var(--orange)'),
                                border: `1.5px ${explicit.isSet ? 'solid var(--plum)' : 'dashed ' + (inherited ? 'var(--rule)' : 'var(--orange)')}`,
                                borderRadius: 6, padding: '5px 10px', fontSize: 11,
                                fontWeight: inherited ? 500 : 600,
                                fontStyle: inherited ? 'italic' : 'normal',
                                fontFamily: 'var(--font-body)', cursor: 'pointer',
                                width: '100%', textAlign: 'left', whiteSpace: 'nowrap',
                                overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240,
                              }}>
                              {text}
                            </button>
                          );
                        })()}
                      </td>
                      <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                        <input value={v(row["Sale Price"])} onChange={(e) => onChangeCell(origIndex, "Sale Price", e.target.value)} onBlur={() => onBlurCurrency(origIndex, "Sale Price")} placeholder="$0.00" style={{ ...CELL_INPUT, width: 90 }} />
                      </td>
                      <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                        <input value={v(row["Date Purchased"])} onChange={(e) => onChangeCell(origIndex, "Date Purchased", e.target.value)} onBlur={() => onBlurDate(origIndex)} placeholder="MM/DD/YYYY" style={{ ...CELL_INPUT, width: 110 }} />
                      </td>
                      <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                        <input value={v(row["Purchased From"])} onChange={(e) => onChangeCell(origIndex, "Purchased From", e.target.value)} maxLength={50} placeholder="Seller / site" style={{ ...CELL_INPUT, width: 140 }} />
                      </td>
                      <td style={{ padding: '6px 8px', verticalAlign: 'middle' }}>
                        <ImageCell url={v(row["Image 1"])} label="Img 1"
                          onUpload={(file) => handleImageUpload(origIndex, 1, file)}
                          onView={() => openLightboxFor(origIndex, 1)} />
                      </td>
                      <td style={{ padding: '6px 8px', verticalAlign: 'middle' }}>
                        <ImageCell url={v(row["Image 2"])} label="Img 2"
                          onUpload={(file) => handleImageUpload(origIndex, 2, file)}
                          onView={() => openLightboxFor(origIndex, 2)} />
                      </td>
                      <td style={{ padding: '6px 8px', verticalAlign: 'middle', textAlign: 'center' }}>
                        {(() => {
                          const rowId = typeof row['_id'] === 'string' ? row['_id'] : '';
                          const linked = rowId ? listingsByRowId[rowId] : null;
                          if (linked) {
                            return (
                              <Link href={`/listings?focus=${linked.id}`}
                                title={`Linked listing (${linked.status})`}
                                style={{
                                  display: 'inline-block', padding: '4px 8px',
                                  borderRadius: 6, border: '1.5px dashed var(--teal)',
                                  color: 'var(--teal)', fontSize: 11, fontWeight: 700,
                                  textDecoration: 'none', whiteSpace: 'nowrap',
                                }}>
                                🔗 {linked.status === 'sold' ? 'Sold' : 'View listing'}
                              </Link>
                            );
                          }
                          if (canSell && String(row["Owned"] || '') === 'Yes') {
                            return (
                              <button type="button" onClick={() => handleListForSale(row)}
                                className="btn btn-ghost btn-sm" style={{ whiteSpace: 'nowrap' }}>
                                $ List
                              </button>
                            );
                          }
                          return <span style={{ color: 'var(--ink-mute)', fontSize: 11 }}>—</span>;
                        })()}
                      </td>
                    </tr>
                  );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '10px 14px', borderTop: '1.5px solid var(--rule)', display: 'flex', gap: 10, alignItems: 'center' }}>
              <button type="button" onClick={addRow} className="btn btn-ghost btn-sm">
                + Add row
              </button>
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                Appends a blank row to the end of the table — fill in any fields you want.
              </span>
            </div>
          </section>
        ) : (
          <div className="panel-bordered" style={{ padding: '48px 32px', textAlign: 'center', borderStyle: 'dashed' }}>
            <div className="display" style={{ fontSize: 20, color: 'var(--plum)', marginBottom: 8 }}>No data yet</div>
            <p style={{ color: 'var(--ink-soft)', fontSize: 14, margin: 0 }}>
              No cards loaded yet. Upload a CSV from My Shelf to populate this set.
            </p>
          </div>
        )}
      </div>

      {targetEditIndex !== null && rows[targetEditIndex] && (
        <TargetEditorModal
          row={rows[targetEditIndex]}
          cardLabel={`${year ? year + ' ' : ''}${brand ? brand + ' ' : ''}#${rows[targetEditIndex]['Card #'] || ''} ${rows[targetEditIndex]['Player'] || rows[targetEditIndex]['Description'] || ''}`.trim()}
          onClose={() => setTargetEditIndex(null)}
          onSave={(patch) => {
            const idx = targetEditIndex;
            if (idx === null) return;
            const copy = [...rows];
            copy[idx] = {
              ...copy[idx],
              'Target Type': patch.type,
              'Target Condition - Low': patch.low,
              'Target Condition - High': patch.high,
              'Target Grading Companies': patch.companies,
            };
            // Per-row save discards the matching-toggle fields — those
            // are set-level only, edited via the Default Target modal.
            setRows(copy);
            scheduleAutoSave(copy);
            setTargetEditIndex(null);
          }}
        />
      )}

      {defaultTargetOpen && (
        <TargetEditorModal
          isDefault
          initialFlags={{
            include_equivalent_grades: defaultTarget.include_equivalent_grades,
            include_upgrades: defaultTarget.include_upgrades,
          }}
          row={{
            'Target Type': defaultTarget.type,
            'Target Condition - Low': defaultTarget.low,
            'Target Condition - High': defaultTarget.high,
            'Target Grading Companies': defaultTarget.companies,
          }}
          cardLabel={`Default for ${datasetTitle || 'this set'}`}
          onClose={() => setDefaultTargetOpen(false)}
          onSave={(patch) => {
            saveDefaultTarget(patch);
            setDefaultTargetOpen(false);
             }}
        />
      )}

      {infoEditOpen && (
        <SetInfoModal
          initial={{ title: datasetTitle, year, brand, description: desc, sport, purpose }}
          onClose={() => setInfoEditOpen(false)}
          onSave={async (patch) => {
            setDatasetTitle(patch.title);
            setYear(patch.year);
            setBrand(patch.brand);
            setDesc(patch.description);
            setSport(patch.sport);
            setPurpose(patch.purpose);
            setInfoEditOpen(false);
            if (userId && slug && slug !== 'new') {
              const supabase = createClient();
              const { ownedCount, ownedPct } = computeOwnedStats(rows);
              const { totalCost, totalValue, gainLoss } = computeFinancials(rows);
              await supabase.from('sets').upsert({
                user_id: userId, slug,
                title: patch.title,
                year: Number(patch.year) || null,
                brand: patch.brand,
                description: patch.description,
                sport: patch.sport,
                purpose: patch.purpose,
                owner_email: userEmail,
                rows, row_count: rows.length,
                owned_count: ownedCount, owned_pct: ownedPct,
                total_cost: totalCost, total_value: totalValue, gain_loss: gainLoss,
                updated_at: Date.now(),
              }, { onConflict: 'user_id,slug' });
              setSaveStatus(`Saved at ${new Date().toLocaleTimeString()}`);
            }
          }}
        />
      )}

      {/* Footer */}
      <footer style={{
        borderTop: '3px solid var(--plum)', padding: '24px 28px',
        maxWidth: 1600, margin: '0 auto',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        color: 'var(--plum)', fontSize: 11.5, letterSpacing: '0.12em',
        textTransform: 'uppercase', fontWeight: 700,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SCLogo size={32} />
          <div style={{ lineHeight: 0.9 }}>
            <div className="wordmark" style={{ fontSize: 16, color: 'var(--orange)' }}>Sports</div>
            <div className="display" style={{ fontSize: 10, color: 'var(--plum)', letterSpacing: '0.04em' }}>COLLECTIVE</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          <span>Est. 2023</span>
          <span>Keep on collectin&apos;</span>
        </div>
      </footer>
      <MarketResearchModal
        open={!!researchTarget}
        onClose={() => { setResearchTarget(null); loadValueTrends(); }}
        card={researchTarget?.descriptor || { year: null, brand: null, card_number: null, player: null, grade: null, grading_company: null, raw_grade: null }}
        onApply={(value) => {
          if (!researchTarget) return;
          const idx = researchTarget.rowIndex;
          // Write the formatted currency string in a single state update so we
          // don't lose the change to a stale-rows blur formatter on the next tick.
          onChangeCell(idx, 'Value', toCurrency(value.toFixed(2)));
          // A commit may have just added a history point — refresh trend badges.
          loadValueTrends();
        }}
      />
      {autoNumOpen && (() => {
        const start = Number(autoNumStart.trim());
        const valid = autoNumStart.trim() && !Number.isNaN(start) && start >= 0;
        const width = autoNumStart.trim().length || 1;
        const count = selectedRows.size;
        const first = valid ? `${autoNumPrefix}${String(start).padStart(width, '0')}` : '';
        const last = valid && count > 0 ? `${autoNumPrefix}${String(start + count - 1).padStart(width, '0')}` : '';
        return (
          <div onClick={() => setAutoNumOpen(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(42,20,52,0.55)',
              display: 'grid', placeItems: 'center', padding: 20,
            }}>
            <div onClick={e => e.stopPropagation()} className="panel-bordered"
              style={{ width: '100%', maxWidth: 460, background: 'var(--cream)', padding: '20px 24px' }}>
              <div className="display" style={{ fontSize: 20, color: 'var(--plum)' }}>🏷 Auto-number Tag #</div>
              <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 4, marginBottom: 14 }}>
                Assigns sequential tag numbers to <strong>{count}</strong> selected row{count === 1 ? '' : 's'}, in table order.
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <label className="input-label">Prefix</label>
                  <input type="text" value={autoNumPrefix} onChange={e => setAutoNumPrefix(e.target.value)}
                    placeholder="A-" maxLength={20} className="input-sc" style={{ width: 110 }} />
                </div>
                <div>
                  <label className="input-label">Starting #</label>
                  <input type="text" value={autoNumStart}
                    onChange={e => setAutoNumStart(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="001" maxLength={8} className="input-sc" style={{ width: 110 }} />
                </div>
              </div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 10 }}>
                {valid
                  ? (count === 1 ? `Preview: ${first}` : `Preview: ${first} → ${last} (${count} tags). Type "001" for 3-digit padding, "1" for none.`)
                  : 'Enter a starting number above.'}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setAutoNumOpen(false)} className="btn btn-ghost btn-sm">Cancel</button>
                <button type="button" onClick={applyAutoNumberTags} disabled={!valid} className="btn btn-primary btn-sm">
                  ✓ Assign tags
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {listSetOpen && (
        <ListCompleteSetModal
          setSlug={slug}
          setTitle={datasetTitle}
          rows={rows}
          existing={existingSetListing}
          userId={userId}
          onCancel={() => setListSetOpen(false)}
          onSaved={(listing) => {
            setExistingSetListing({ id: listing.id, status: listing.status, asking_price: listing.asking_price });
            setListSetOpen(false);
          }}
        />
      )}

      {scansPickerOpen && (
        <div onClick={() => setScansPickerOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(42,20,52,0.82)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '60px 20px', overflowY: 'auto',
          }}>
          <div onClick={(e) => e.stopPropagation()} className="panel-bordered"
            style={{ width: '100%', maxWidth: 540, padding: 28, background: 'var(--cream)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              <div className="display" style={{ fontSize: 22, color: 'var(--plum)', flex: 1 }}>Add Scans</div>
              <button type="button" onClick={() => setScansPickerOpen(false)} className="btn btn-outline btn-sm">✕ Close</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 20 }}>Pick where you want to attach card scans.</p>
            <div style={{ display: 'grid', gap: 12 }}>
              {[
                // 'sellerOnly' options match scans to listings — only useful for
                // members with selling privileges. The other two write photos
                // to set rows directly and are open to every approved member.
                { icon: '📷', label: 'Add Scans to Single Cards', hint: 'Match scans to individual listings — front and back per card.', href: '/listings/scan-inbox', sellerOnly: true },
                { icon: '📚', label: 'Add Scans to Set Inventory', hint: 'Bulk attach scans to rows in one of your sets.', href: '/listings/scan-from-set', sellerOnly: false },
                { icon: '🪟', label: 'Multi-Card Scan (2×3 grid)', hint: 'Upload one image of 6 fronts + one of 6 backs. Splits losslessly into 6 cards and assigns each to a row.', href: '/listings/scan-multi-card', sellerOnly: false },
              ].filter(c => canSell || !c.sellerOnly).map(c => (
                <button key={c.label} type="button"
                  onClick={() => { setScansPickerOpen(false); router.push(c.href); }}
                  className="panel-bordered"
                  style={{
                    padding: '18px 20px', textAlign: 'left', background: 'var(--paper)',
                    cursor: 'pointer', border: '1.5px solid var(--rule)', borderRadius: 12,
                  }}>
                  <div className="display" style={{ fontSize: 16, color: 'var(--plum)', marginBottom: 4 }}>
                    {c.icon} {c.label}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{c.hint}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {lightboxIdx != null && lightboxItems.length > 0 && (
        <ImageViewModal
          items={lightboxItems}
          idx={Math.min(lightboxIdx, lightboxItems.length - 1)}
          setIdx={setLightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onDelete={(item) => {
            handleImageDelete(item.origIndex, item.slot);
            setLightboxIdx(null);
          }}
        />
      )}
    </div>
  );
}

// Marketplace listing for the whole set as a single SKU. One price, one
// transaction. Saves into the same `listings` table with listing_type='set'
// + set_slug pointer back to the seller's source set on their shelf.
function ListCompleteSetModal({
  setSlug, setTitle, rows, existing, userId, onCancel, onSaved,
}: {
  setSlug: string;
  setTitle: string;
  rows: Array<Record<string, any>>;
  existing: { id: string; status: string; asking_price: number | null } | null;
  userId: string;
  onCancel: () => void;
  onSaved: (l: { id: string; status: string; asking_price: number | null }) => void;
}) {
  const ownedCount = rows.filter(r => String(r['Owned'] || '') === 'Yes').length;
  const totalRows = rows.length;
  const [title, setTitle2] = useState(existing ? '' : `${setTitle} — Complete Set`);
  const [askingPrice, setAskingPrice] = useState<string>(existing?.asking_price != null ? String(existing.asking_price) : '');
  const [description, setDescription] = useState('');
  const [heroPhoto, setHeroPhoto] = useState<string>('');
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [shipLabel, setShipLabel] = useState('Bubble Mailer with Tracking');
  const [shipCost, setShipCost] = useState('10');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Pull the user's default shipping + an existing listing's fields if
  // we're editing rather than creating fresh.
  useEffect(() => {
    if (!existing) return;
    const supabase = createClient();
    (async () => {
      const { data } = await supabase.from('listings')
        .select('title, description, shipping_options, photos')
        .eq('id', existing.id).maybeSingle();
      if (!data) return;
      setTitle2(data.title || '');
      setDescription(data.description || '');
      const ship = (data.shipping_options as { label: string; cost: number }[] | null) || [];
      if (ship[0]) { setShipLabel(ship[0].label); setShipCost(String(ship[0].cost)); }
      const photos = (data.photos as string[] | null) || [];
      if (photos[0]) setHeroPhoto(photos[0]);
    })();
  }, [existing]);

  async function handlePhotoUpload(file: File) {
    setPhotoError('');
    if (!userId) { setPhotoError('Not signed in.'); return; }
    if (file.size > 8 * 1024 * 1024) { setPhotoError('Image must be under 8 MB.'); return; }
    setPhotoUploading(true);
    const supabase = createClient();
    const trimmed = await cropScanPadding(file);
    const ext = (trimmed.name.split('.').pop() || 'jpg').toLowerCase();
    // Store under the user's namespace; one folder per set-listing slug.
    // We overwrite on subsequent uploads so we don't accumulate orphans.
    const path = `${userId}/set-listings/${setSlug}/hero-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('card-images').upload(path, trimmed);
    if (upErr) { setPhotoUploading(false); setPhotoError(upErr.message); return; }
    const { data } = supabase.storage.from('card-images').getPublicUrl(path);
    setHeroPhoto(data.publicUrl);
    setPhotoUploading(false);
  }

  async function handleSave() {
    setError('');
    const price = Number(askingPrice);
    if (!title.trim()) { setError('Title is required.'); return; }
    if (!askingPrice.trim() || Number.isNaN(price) || price <= 0) { setError('Asking price must be a positive number.'); return; }
    setSaving(true);
    const supabase = createClient();
    const payload = {
      user_id: userId,
      listing_type: 'set',
      set_slug: setSlug,
      title: title.trim(),
      description: description.trim() || null,
      asking_price: price,
      photos: heroPhoto.trim() ? [heroPhoto.trim()] : [],
      shipping_options: [{ label: shipLabel.trim() || 'Shipping', cost: Number(shipCost) || 0 }],
      status: 'active',
      condition_type: 'raw',
      raw_grade: null,
      grading_company: null,
      grade: null,
      card_number: null,
      player: null,
      year: null,
      brand: null,
    };
    if (existing) {
      const { data, error } = await supabase.from('listings').update(payload).eq('id', existing.id).select('id, status, asking_price').single();
      setSaving(false);
      if (error) { setError(error.message); return; }
      onSaved(data as { id: string; status: string; asking_price: number | null });
    } else {
      const { data, error } = await supabase.from('listings').insert(payload).select('id, status, asking_price').single();
      setSaving(false);
      if (error) { setError(error.message); return; }
      onSaved(data as { id: string; status: string; asking_price: number | null });
    }
  }

  const fieldStyle: React.CSSProperties = {
    border: '1.5px solid var(--plum)', borderRadius: 8, padding: '8px 12px',
    fontFamily: 'var(--font-body)', fontSize: 13.5, color: 'var(--plum)',
    background: 'var(--cream)', width: '100%', boxSizing: 'border-box',
  };

  return (
    <div onClick={onCancel}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(42,20,52,0.55)', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} className="panel-bordered"
        style={{ width: '100%', maxWidth: 620, maxHeight: '92vh', overflowY: 'auto', background: 'var(--cream)', padding: '22px 26px' }}>
        <div className="display" style={{ fontSize: 22, color: 'var(--plum)' }}>
          📚 {existing ? 'Edit Complete-Set Listing' : 'List Complete Set'}
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 4, marginBottom: 18 }}>
          One marketplace listing for the entire set. <strong>{ownedCount} of {totalRows}</strong> cards owned right now.
          Buyers will see your full set contents (player, condition, images) before purchase.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="input-label">Title *</label>
            <input value={title} onChange={e => setTitle2(e.target.value)}
              placeholder={`${setTitle} — Complete Set`} style={fieldStyle} maxLength={120} />
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="input-label">Asking Price ($) *</label>
              <input type="number" min="0" step="0.01" value={askingPrice} onChange={e => setAskingPrice(e.target.value)}
                placeholder="0.00" style={fieldStyle} />
            </div>
            <div style={{ flex: 2 }}>
              <label className="input-label">Hero photo <span style={{ color: 'var(--ink-mute)', fontWeight: 600 }}>(shows in marketplace · optional)</span></label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {heroPhoto && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img loading="lazy" decoding="async" src={heroPhoto} alt="Hero preview"
                    style={{ width: 56, height: 78, objectFit: 'cover', border: '1.5px solid var(--plum)', borderRadius: 6, flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button type="button" onClick={() => photoInputRef.current?.click()}
                    disabled={photoUploading} className="btn btn-outline btn-sm"
                    style={{ justifyContent: 'center' }}>
                    {photoUploading ? 'Uploading…' : heroPhoto ? '📷 Replace photo' : '📷 Upload photo'}
                  </button>
                  {heroPhoto && (
                    <button type="button" onClick={() => setHeroPhoto('')} disabled={photoUploading}
                      style={{ background: 'transparent', border: 0, color: 'var(--rust)', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                      Remove
                    </button>
                  )}
                </div>
                <input ref={photoInputRef} type="file" accept="image/*"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f); e.target.value = ''; }}
                  style={{ display: 'none' }} />
              </div>
              {photoError && (
                <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--rust)', fontWeight: 600 }}>{photoError}</div>
              )}
            </div>
          </div>

          <div>
            <label className="input-label">Description <span style={{ color: 'var(--ink-mute)', fontWeight: 600 }}>(call out completeness, condition, missing cards)</span></label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4}
              placeholder={`e.g. ${totalRows === ownedCount ? 'Complete — all ' + totalRows + ' cards present.' : `Partial — ${ownedCount} of ${totalRows} cards. Missing #...`}`}
              style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.5 }} />
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 2 }}>
              <label className="input-label">Shipping label</label>
              <input value={shipLabel} onChange={e => setShipLabel(e.target.value)}
                placeholder="Bubble Mailer with Tracking" style={fieldStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="input-label">Shipping $</label>
              <input type="number" min="0" step="0.01" value={shipCost} onChange={e => setShipCost(e.target.value)}
                style={fieldStyle} />
            </div>
          </div>

          {error && (
            <div style={{
              background: 'rgba(197,74,44,0.1)', border: '1.5px solid var(--rust)',
              borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--rust)', fontWeight: 600,
            }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm">Cancel</button>
            <button type="button" onClick={handleSave} disabled={saving} className="btn btn-primary btn-sm">
              {saving ? 'Saving…' : (existing ? '✓ Save changes' : '✓ Publish set listing')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
