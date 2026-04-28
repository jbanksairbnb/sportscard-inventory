'use client';

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/client";
import SCLogo from "@/components/SCLogo";

/* =====================  Constants  ===================== */
const EXPECTED_HEADERS = [
  "Card #", "Description", "Owned", "Raw Grade", "Graded",
    "Grading Company", "Grade", "Cost", "Value", "Target Price", "Target Type", "Target Condition - Low", "Target Condition - High", "Target Grading Companies",
  "Sale Price", "Date Purchased", "Purchased From", "Upload Image(s)",
];

const YEARS = Array.from({ length: 2025 - 1953 + 1 }, (_, i) => String(1953 + i));
const BRANDS = ["Topps", "Bowman", "Play Ball"];
const YES_NO = ["Yes", "No"] as const;
const COMPANIES = ["", "PSA", "SGC", "BGS", "CGC", "TAG"] as const;
const GRADING_COMPANIES_LIST = ["PSA", "SGC", "BGS", "CGC", "TAG"] as const;
const RAW_GRADES = ["", "Gem Mint", "Mint", "NM-MT", "NM", "EXMT", "EX", "VG-EX", "VG", "G", "P"] as const;
const RAW_TARGET_GRADES = ["Gem Mint", "Mint", "NM-MT", "NM", "EXMT", "EX", "VG-EX", "VG", "G", "P"] as const;
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
  const csv = Papa.unparse({ fields: EXPECTED_HEADERS, data: rows.map(r => EXPECTED_HEADERS.map(h => r[h] ?? "")) });
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
function ImageViewModal({ urls, onClose, onDelete }: { urls: string[]; onClose: () => void; onDelete?: () => void }) {
  const [idx, setIdx] = useState(0);
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
        <img src={urls[idx]} alt="Card" style={{ maxWidth: '90vw', maxHeight: '80vh', borderRadius: 12, display: 'block' }} />
        {urls.length > 1 && (
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, transform: 'translateY(-50%)', display: 'flex', justifyContent: 'space-between', pointerEvents: 'none', padding: '0 4px' }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); setIdx(i => Math.max(0, i - 1)); }}
              style={{ ...arrowBtn, opacity: idx === 0 ? 0.25 : 1 }} disabled={idx === 0}>‹</button>
            <button type="button" onClick={(e) => { e.stopPropagation(); setIdx(i => Math.min(urls.length - 1, i + 1)); }}
              style={{ ...arrowBtn, opacity: idx === urls.length - 1 ? 0.25 : 1 }} disabled={idx === urls.length - 1}>›</button>
          </div>
        )}
        <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 8 }}>
          {onDelete && idx === 0 && (
            <button type="button" onClick={onDelete} className="btn btn-sm"
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
function ImageCell({ url, label, otherUrl, onUpload, onDelete }: {
  url: string; label: string; otherUrl?: string;
  onUpload: (file: File) => Promise<void>;
  onDelete: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [showModal, setShowModal] = useState(false);

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
        <>
          <img src={url} alt={label} title="Click to view"
            onClick={() => setShowModal(true)}
            style={{ width: 56, height: 56, borderRadius: 8, border: '2px solid var(--plum)', objectFit: 'cover', cursor: 'pointer' }} />
          {showModal && (
            <ImageViewModal urls={[url, ...(otherUrl ? [otherUrl] : [])]} onClose={() => setShowModal(false)}
              onDelete={() => { onDelete(); setShowModal(false); }} />
          )}
        </>
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

function TargetEditorModal({ row, cardLabel, onClose, onSave }: {
  row: Record<string, any>;
  cardLabel: string;
  onClose: () => void;
  onSave: (patch: { type: string; low: string; high: string; companies: string }) => void;
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
    });
  }

  function handleClear() {
    onSave({ type: '', low: '', high: '', companies: '' });
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
  initial: { title: string; year: string; brand: string; description: string };
  onClose: () => void;
  onSave: (patch: { title: string; year: string; brand: string; description: string }) => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [year, setYear] = useState(initial.year);
  const [brand, setBrand] = useState(initial.brand);
  const [description, setDescription] = useState(initial.description);
  const [error, setError] = useState('');

  function handleSave() {
    if (!title.trim()) { setError('Title is required.'); return; }
    onSave({ title: title.trim(), year: year.trim(), brand: brand.trim(), description: description.trim() });
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
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
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
          </div>
          <div>
            <div className="eyebrow" style={labelStyle}>Description</div>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              rows={3} placeholder="Optional notes about the set"
              style={{ ...fieldStyle, resize: 'vertical' }} />
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
  const [slug, setSlug] = useState<string>(paramSlug);
  const [datasetTitle, setDatasetTitle] = useState<string>("");
  const [year, setYear] = useState<string>("");
  const [brand, setBrand] = useState<string>("");
  const [desc, setDesc] = useState<string>("");
  const [rows, setRows] = useState<Array<Record<string, any>>>([]);
  const [saveStatus, setSaveStatus] = useState<string>("");
  const [showNeededOnly, setShowNeededOnly] = useState<boolean>(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [isShared, setIsShared] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [targetEditIndex, setTargetEditIndex] = useState<number | null>(null);
  const [defaultTarget, setDefaultTarget] = useState<{ type: string; low: string; high: string; companies: string }>({ type: '', low: '', high: '', companies: '' });
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
           if (paramSlug !== "new") {
        const { data } = await supabase.from("sets").select("*").eq("slug", paramSlug).single();
        if (data) {
          setSlug(paramSlug);
          setDatasetTitle(data.title || "");
          setYear(data.year ? String(data.year) : "");
          setBrand(data.brand ?? "");
          setDesc(data.description ?? "");
          setRows(migrateRows(data.rows ?? []));
          setShareToken(data.share_token ?? null);
          setIsShared(!!data.share_token);
          const dt = data.default_target as { type?: string; low?: string; high?: string; companies?: string } | null;
          if (dt) {
            setDefaultTarget({
              type: dt.type || '',
              low: dt.low || '',
              high: dt.high || '',
              companies: dt.companies || '',
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
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${userId}/${slug}/${origIndex}/img${slot}.${ext}`;
  const { error } = await supabase.storage.from("card-images").upload(path, file, { upsert: true });
  if (error) { alert("Image upload failed: " + error.message); return; }
  const { data } = supabase.storage.from("card-images").getPublicUrl(path);
  const field = slot === 1 ? "Image 1" : "Image 2";
    const publicUrl = `${data.publicUrl}?t=${Date.now()}`;
  const nextRows = rows.map((r, i) => i === origIndex ? { ...r, [field]: publicUrl } : r);
  setRows(nextRows);
  scheduleAutoSave(nextRows);
}
   async function saveDefaultTarget(patch: { type: string; low: string; high: string; companies: string }) {
    if (!userId || !slug || slug === 'new') return;
    const supabase = createClient();
    await supabase.from('sets').update({ default_target: patch }).eq('user_id', userId).eq('slug', slug);
    setDefaultTarget(patch);
  }

  function handleListForSale(row: Record<string, any>) {
    const params = new URLSearchParams({ prefill: '1' });
    if (year) params.set('year', String(year));
    if (brand) params.set('brand', String(brand));
    if (row['Card #']) params.set('card', String(row['Card #']));
    if (row['Player']) params.set('player', String(row['Player']));
    if (String(row['Graded'] || '') === 'Yes') {
      params.set('condition_type', 'graded');
      if (row['Grading Company']) params.set('grading_company', String(row['Grading Company']));
      if (row['Grade']) params.set('grade', String(row['Grade']));
    } else if (row['Raw Grade']) {
      params.set('condition_type', 'raw');
      params.set('raw_grade', String(row['Raw Grade']));
    }
    const cost = String(row['Cost'] || '').replace(/[^0-9.]/g, '');
    if (cost) params.set('cost', cost);
    const img1 = String(row['Image 1'] || '');
    const img2 = String(row['Image 2'] || '');
    if (img1) params.append('photo', img1);
    if (img2) params.append('photo', img2);
    router.push(`/listings?${params.toString()}`);
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

  function SortableHeader({ label }: { label: SortKey }) {
    const isActive = sortKey === label;
    return (
      <th style={TH_STYLE}>
        <button type="button" onClick={() => handleSortClick(label)}
          style={{ color: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3, fontWeight: isActive ? 900 : 700 }}>
          {label} {isActive ? (sortDir === 'asc' ? "↑" : "↓") : ""}
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
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0 }}>
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
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1600, margin: '0 auto', padding: '28px 28px 80px', display: 'flex', flexDirection: 'column', gap: 20 }}>

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
              <Link href={`/set/${encodeURIComponent(slug)}/view`} className="btn btn-sm btn-outline">
                View Inventory
              </Link>
            </div>
          </div>
        )}

        {/* Table */}
        {rows.length > 0 ? (
          <section className="panel-bordered" style={{ overflow: 'hidden', padding: 0 }}>
            <div style={{ maxHeight: '70vh', overflowY: 'auto', overflowX: 'auto' }}>
              <table style={{ minWidth: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <SortableHeader label="Card #" />
                    <SortableHeader label="Player" />
                    <SortableHeader label="Owned" />
                    <SortableHeader label="Raw Grade" />
                    <SortableHeader label="Graded" />
                    <SortableHeader label="Grading Company" />
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
                  {displayRows.map(({ row, origIndex }, i) => (
                    <tr key={`${origIndex}-${i}`} style={{
                      borderTop: '1.5px solid var(--cream-warm)',
                      background: i % 2 === 0 ? 'var(--cream)' : 'var(--paper)',
                    }}>
                      <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                        <input value={v(row["Card #"])} readOnly style={{ ...CELL_INPUT, width: 72, background: 'var(--paper)', cursor: 'not-allowed', opacity: 0.7 }} />
                      </td>
                      <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
<input value={v(row["Player"])} readOnly style={{ ...CELL_INPUT, width: 220, background: 'var(--paper)', cursor: 'not-allowed', opacity: 0.7 }} />
                      </td>
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
                        <select value={v(row["Graded"])} onChange={(e) => onChangeCell(origIndex, "Graded", e.target.value)} style={CELL_SELECT}>
                          {YES_NO.map((o) => <option key={o} value={o}>{o}</option>)}
                          <option value=""></option>
                        </select>
                      </td>
                      <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                        <select value={v(row["Grading Company"])} onChange={(e) => onChangeCell(origIndex, "Grading Company", e.target.value)} style={CELL_SELECT}>
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
                      <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                        <input value={v(row["Value"])} onChange={(e) => onChangeCell(origIndex, "Value", e.target.value)} onBlur={() => onBlurCurrency(origIndex, "Value")} placeholder="$0.00" style={{ ...CELL_INPUT, width: 90 }} />
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
                          otherUrl={v(row["Image 2"]) || undefined}
                          onUpload={(file) => handleImageUpload(origIndex, 1, file)}
                          onDelete={() => handleImageDelete(origIndex, 1)} />
                      </td>
                                            <td style={{ padding: '6px 8px', verticalAlign: 'middle' }}>
                        <ImageCell url={v(row["Image 2"])} label="Img 2"
                          otherUrl={v(row["Image 1"]) || undefined}
                          onUpload={(file) => handleImageUpload(origIndex, 2, file)}
                          onDelete={() => handleImageDelete(origIndex, 2)} />
                      </td>
                      <td style={{ padding: '6px 8px', verticalAlign: 'middle', textAlign: 'center' }}>
                        {String(row["Owned"] || '') === 'Yes' ? (
                          <button type="button" onClick={() => handleListForSale(row)}
                            className="btn btn-ghost btn-sm" style={{ whiteSpace: 'nowrap' }}>
                            $ List
                          </button>
                        ) : (
                          <span style={{ color: 'var(--ink-mute)', fontSize: 11 }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
            setRows(copy);
            scheduleAutoSave(copy);
            setTargetEditIndex(null);
          }}
        />
      )}

      {defaultTargetOpen && (
        <TargetEditorModal
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
          initial={{ title: datasetTitle, year, brand, description: desc }}
          onClose={() => setInfoEditOpen(false)}
          onSave={async (patch) => {
            setDatasetTitle(patch.title);
            setYear(patch.year);
            setBrand(patch.brand);
            setDesc(patch.description);
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
    </div>
  );
}
