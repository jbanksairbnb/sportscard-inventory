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
  "Grading Company", "Grade", "Cost", "Value", "Target Price",
  "Sale Price", "Date Purchased", "Purchased From", "Upload Image(s)",
];

const YEARS = Array.from({ length: 2025 - 1953 + 1 }, (_, i) => String(1953 + i));
const BRANDS = ["Topps", "Bowman", "Play Ball"];
const YES_NO = ["Yes", "No"] as const;
const COMPANIES = ["", "PSA", "SGC"] as const;
const RAW_GRADES = ["", "Gem Mint", "Mint", "NM-MT", "NM", "EXMT", "EX", "VG-EX", "VG", "G", "P"] as const;
const GRADES_NUMERIC = ["", ...Array.from({ length: 19 }, (_, i) => (10 - i * 0.5).toString().replace(/\.0$/, ""))];

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

/* =====================  Component  ===================== */
export default function SetEditorPage() {
  const router = useRouter();
  const params = useParams();
  const paramSlug = String(params?.slug || "new");

  const [userId, setUserId] = useState<string | null>(null);
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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUserId(user.id);
      if (paramSlug !== "new") {
        const { data } = await supabase.from("sets").select("*").eq("slug", paramSlug).single();
        if (data) {
          setSlug(paramSlug);
          setDatasetTitle(data.title || "");
          setYear(data.year ? String(data.year) : "");
          setBrand(data.brand ?? "");
          setDesc(data.description ?? "");
          setRows(data.rows ?? []);
          setShareToken(data.share_token ?? null);
          setIsShared(!!data.share_token);
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
    const nextRows = rows.map((r, i) => i === origIndex ? { ...r, [field]: data.publicUrl } : r);
    setRows(nextRows);
    scheduleAutoSave(nextRows);
  }

  function onChangeCell(index: number, field: string, value: any) {
    setRows((prev) => {
      const copy = [...prev]; const r = { ...copy[index] };
      if (field === "Purchased From" && value.length > 50) r[field] = value.slice(0, 50);
      else if (CURRENCY_FIELDS.includes(field as any)) r[field] = value;
      else if (field === "Date Purchased") r[field] = autoSlashDate(value);
      else r[field] = value;
      copy[index] = r; return copy;
    });
    scheduleAutoSave();
  }
  function onBlurCurrency(index: number, field: string) {
    setRows((prev) => {
      const copy = [...prev]; const r = { ...copy[index] };
      const raw = stripCurrency(String(r[field] ?? ""));
      r[field] = raw ? toCurrency(raw) : ""; copy[index] = r; return copy;
    });
    scheduleAutoSave();
  }
  function onBlurDate(index: number) {
    setRows((prev) => {
      const copy = [...prev];
      const s = String(copy[index]["Date Purchased"] ?? "");
      if (s && !isValidMMDDYYYY(s)) alert(`Invalid date: ${s}. Use MM/DD/YYYY`);
      return copy;
    });
    scheduleAutoSave();
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
            <div className="display" style={{ fontSize: 16, color: 'var(--plum)' }}>{datasetTitle}</div>
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
                    <SortableHeader label="Description" />
                    <SortableHeader label="Owned" />
                    <SortableHeader label="Raw Grade" />
                    <SortableHeader label="Graded" />
                    <SortableHeader label="Grading Company" />
                    <SortableHeader label="Grade" />
                    <SortableHeader label="Cost" />
                    <SortableHeader label="Value" />
                    <SortableHeader label="Target Price" />
                    <SortableHeader label="Sale Price" />
                    <SortableHeader label="Date Purchased" />
                    <SortableHeader label="Purchased From" />
                    <th style={TH_STYLE}>Image 1</th>
                    <th style={TH_STYLE}>Image 2</th>
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
                        <input value={v(row["Description"])} readOnly style={{ ...CELL_INPUT, width: 220, background: 'var(--paper)', cursor: 'not-allowed', opacity: 0.7 }} />
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
