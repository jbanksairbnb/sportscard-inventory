'use client';

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/client";

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

/* =====================  Share helpers  ===================== */
function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}
function encodeSharePayload(data: {
  title: string; year: string; brand: string; desc: string; rows: any[]; pinHash: string | null;
}): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(data))));
}

/* =====================  Image Modal  ===================== */
function ImageViewModal({
  url,
  onClose,
  onDelete,
}: {
  url: string;
  onClose: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85"
      onClick={onClose}
    >
      <div className="relative max-w-4xl max-h-[90vh] p-4" onClick={(e) => e.stopPropagation()}>
        <img src={url} alt="Card" className="max-w-full max-h-[80vh] rounded-lg shadow-2xl object-contain" />
        <div className="absolute top-2 right-2 flex gap-2">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              title="Delete image"
              className="rounded-full bg-red-600 px-3 py-1.5 text-white text-sm shadow hover:bg-red-700"
            >
              🗑 Delete
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-gray-900/80 px-3 py-1.5 text-white text-sm shadow hover:bg-gray-900"
          >
            ✕ Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* =====================  Image Cell  ===================== */
function ImageCell({
  url,
  label,
  onUpload,
  onDelete,
}: {
  url: string;
  label: string;
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
    <div className="flex flex-col items-center gap-1">
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      {url ? (
        <>
          <img
            src={url}
            alt={label}
            title="Click to view full size"
            onClick={() => setShowModal(true)}
            className="h-16 w-16 rounded border border-gray-200 object-cover cursor-pointer hover:opacity-75"
          />
          {showModal && (
            <ImageViewModal
              url={url}
              onClose={() => setShowModal(false)}
              onDelete={() => { onDelete(); setShowModal(false); }}
            />
          )}
        </>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="h-16 w-16 rounded border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 text-xs hover:border-blue-400 hover:text-blue-400 disabled:opacity-50"
        >
          {uploading ? "…" : "+ " + label}
        </button>
      )}
      {uploading && <span className="text-xs text-gray-400">Uploading…</span>}
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
  const [errors, setErrors] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<string>("");

  const [showNeededOnly, setShowNeededOnly] = useState<boolean>(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const [showShareModal, setShowShareModal] = useState(false);
  const [sharePin, setSharePin] = useState('');
  const [shareCopied, setShareCopied] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareLinkCopied, setShareLinkCopied] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ------------------- Auth + Load ------------------- */
  useEffect(() => {
    const supabase = createClient();
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUserId(user.id);
      setUserEmail(user.email || '');

      if (paramSlug !== "new") {
        const { data } = await supabase
          .from("sets")
          .select("*")
          .eq("slug", paramSlug)
          .single();
        if (data) {
          setSlug(paramSlug);
          setDatasetTitle(data.title || "");
          setYear(data.year ? String(data.year) : "");
          setBrand(data.brand ?? "");
          setDesc(data.description ?? "");
          setRows(data.rows ?? []);
          setShareToken(data.share_token || null);
        }
      }
    }
    init();
  }, [paramSlug, router]);

  const canCreateTitle = year.trim().length > 0 && brand.trim().length > 0 && desc.trim().length > 0;
  const titlePreview = useMemo(
    () => (canCreateTitle ? `${year.trim()} ${brand.trim()} — ${desc.trim()}` : ""),
    [year, brand, desc, canCreateTitle]
  );

  /* ------------------- Auto-save ------------------- */
  function scheduleAutoSave(nextRows?: any[]) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (!slug || slug === "new" || !datasetTitle || !userId) return;
      const theRows = nextRows ?? rows;
      const { ownedCount, ownedPct } = computeOwnedStats(theRows);
      const { totalCost, totalValue, gainLoss } = computeFinancials(theRows);
      const supabase = createClient();
      await supabase.from("sets").upsert({
        user_id: userId,
        slug,
        title: datasetTitle,
        year: Number(year) || null,
        brand,
        description: desc,
        rows: theRows,
        row_count: theRows.length,
        owned_count: ownedCount,
        owned_pct: ownedPct,
        total_cost: totalCost,
        total_value: totalValue,
        gain_loss: gainLoss,
        owner_email: userEmail,
        updated_at: Date.now(),
      }, { onConflict: "user_id,slug" });
      setSaveStatus(`Saved at ${new Date().toLocaleTimeString()}`);
    }, 600);
  }

  /* ------------------- Image upload ------------------- */
  async function handleImageUpload(origIndex: number, slot: 1 | 2, file: File) {
    if (!userId || !slug || slug === "new") return;
    const supabase = createClient();
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${userId}/${slug}/${origIndex}/img${slot}.${ext}`;
    const { error } = await supabase.storage
      .from("card-images")
      .upload(path, file, { upsert: true });
    if (error) { alert("Image upload failed: " + error.message); return; }
    const { data } = supabase.storage.from("card-images").getPublicUrl(path);
    const field = slot === 1 ? "Image 1" : "Image 2";
    setRows((prev) => {
      const copy = [...prev];
      copy[origIndex] = { ...copy[origIndex], [field]: data.publicUrl };
      scheduleAutoSave(copy);
      return copy;
    });
  }

  /* ------------------- File upload ------------------- */
  function handleFileChosen(file: File) {
    setErrors([]);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const missing = EXPECTED_HEADERS.filter((h) => !(result.meta.fields || []).includes(h));
        if (missing.length > 0) {
          setErrors([`CSV is missing required columns: ${missing.join(", ")}.`]);
          setRows([]);
          return;
        }
        const cleaned = (result.data as any[]).map((r) => {
          const norm: Record<string, any> = {};
          EXPECTED_HEADERS.forEach((h) => { norm[h] = r[h] ?? ""; });
          ["Owned", "Graded"].forEach((f) => {
            const val = String(norm[f]).trim().toLowerCase();
            norm[f] = val === "yes" || val === "y" || val === "true" || val === "1" ? "Yes"
              : val === "no" || val === "n" || val === "false" || val === "0" ? "No" : "";
          });
          const rg = String(norm["Raw Grade"]).trim();
          norm["Raw Grade"] = RAW_GRADES.includes(rg as any) ? rg : "";
          norm["Grade"] = normalizeNumericGrade(norm["Grade"]);
          ["Cost", "Value", "Target Price", "Sale Price"].forEach((f) => {
            const raw = norm[f];
            if (String(raw).trim() !== "") {
              const stripped = stripCurrency(String(raw));
              if (!Number.isNaN(Number(stripped))) norm[f] = toCurrency(stripped);
            }
          });
          const d = String(norm["Date Purchased"]).trim();
          if (d) {
            const digits = d.replace(/[^0-9]/g, "");
            if (digits.length === 8) norm["Date Purchased"] = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
          }
          const cardNum = Number(String(norm["Card #"]).trim());
          if (Number.isNaN(cardNum)) norm["Card #"] = "";
          if (!String(norm["Description"]).trim()) norm["Description"] = "";
          return norm;
        });
        setRows(cleaned);
        scheduleAutoSave(cleaned);
      },
      error: (err) => setErrors([`Parse error: ${err.message}`]),
    });
  }

  /* ------------------- PSA file upload ------------------- */
  function handlePSAFileChosen(file: File) {
    setErrors([]);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (result) => {
        const fields = result.meta.fields || [];
        const requiredPSA = ['Card #', 'Item', 'Grade'];
        const missing = requiredPSA.filter((f) => !fields.includes(f));
        if (missing.length > 0) {
          setErrors([`This doesn't look like a PSA export file. Missing columns: ${missing.join(', ')}.`]);
          return;
        }
        const cleaned = (result.data as any[])
          .filter((r: any) => String(r['Card #'] ?? '').trim() !== '')
          .map((r: any) => {
            const norm: Record<string, any> = {};
            EXPECTED_HEADERS.forEach((h) => { norm[h] = ''; });
            const certNum = String(r['Cert #'] ?? '').trim();
            const isOwned = certNum !== '';
            norm['Card #'] = String(r['Card #'] ?? '').trim();
            norm['Description'] = String(r['Item'] ?? '').trim();
            norm['Owned'] = isOwned ? 'Yes' : 'No';
            if (isOwned) {
              norm['Grade'] = normalizeNumericGrade(r['Grade']);
              norm['Grading Company'] = 'PSA';
              norm['Graded'] = 'Yes';
              const cost = String(r['My Cost'] ?? '').trim();
              if (cost && Number(cost) > 0) norm['Cost'] = toCurrency(stripCurrency(cost));
              const dp = String(r['Purchase Date'] ?? '').trim();
              if (dp) {
                const digits = dp.replace(/[^0-9]/g, '');
                if (digits.length === 8) norm['Date Purchased'] = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
                else norm['Date Purchased'] = dp;
              }
              norm['Purchased From'] = String(r['Source'] ?? '').trim();
            }
            return norm;
          });
        setRows(cleaned);
        scheduleAutoSave(cleaned);
      },
      error: (err) => setErrors([`Parse error: ${err.message}`]),
    });
  }

  /* ------------------- Create title ------------------- */
  async function handleCreateTitle(e?: React.MouseEvent) {
    e?.preventDefault();
    if (!canCreateTitle || !userId) return;

    const newTitle = `${year.trim()} ${brand.trim()} — ${desc.trim()}`;
    let newSlug = slug;

    if (slug === "new") {
      const base = slugify(newTitle);
      const supabase = createClient();
      const { data: existing } = await supabase
        .from("sets").select("slug").ilike("slug", `${base}%`);
      const taken = new Set((existing || []).map((r: any) => r.slug as string));
      newSlug = base;
      let i = 2;
      while (taken.has(newSlug)) newSlug = `${base}-${i++}`;
    }

    const { ownedCount, ownedPct } = computeOwnedStats(rows);
    const { totalCost, totalValue, gainLoss } = computeFinancials(rows);
    const supabase = createClient();
    await supabase.from("sets").upsert({
      user_id: userId,
      slug: newSlug,
      title: newTitle,
      year: Number(year) || null,
      brand: brand.trim(),
      description: desc,
      rows,
      row_count: rows.length,
      owned_count: ownedCount,
      owned_pct: ownedPct,
      total_cost: totalCost,
      total_value: totalValue,
      gain_loss: gainLoss,
      updated_at: Date.now(),
    }, { onConflict: "user_id,slug" });

    setDatasetTitle(newTitle);
    setSlug(newSlug);
    setSaveStatus(`Saved at ${new Date().toLocaleTimeString()}`);
    if (slug === "new") router.replace(`/set/${newSlug}`);
  }

  /* ------------------- Cell changes ------------------- */
  function onChangeCell(index: number, field: string, value: any) {
    setRows((prev) => {
      const copy = [...prev];
      const r = { ...copy[index] };
      if (field === "Purchased From" && value.length > 50) r[field] = value.slice(0, 50);
      else if (CURRENCY_FIELDS.includes(field as any)) r[field] = value;
      else if (field === "Date Purchased") r[field] = autoSlashDate(value);
      else r[field] = value;
      copy[index] = r;
      return copy;
    });
    scheduleAutoSave();
  }
  function onBlurCurrency(index: number, field: string) {
    setRows((prev) => {
      const copy = [...prev];
      const r = { ...copy[index] };
      const raw = stripCurrency(String(r[field] ?? ""));
      r[field] = raw ? toCurrency(raw) : "";
      copy[index] = r;
      return copy;
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

  /* ------------------- Image delete ------------------- */
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
    setRows((prev) => {
      const copy = [...prev];
      copy[origIndex] = { ...copy[origIndex], [field]: '' };
      scheduleAutoSave(copy);
      return copy;
    });
  }

  /* ------------------- Export ------------------- */
  function handleExport() {
    if (!rows.length) { alert("No data to export."); return; }
    downloadCSV(datasetTitle || "sportscard-export", rows);
  }

  /* ------------------- Share ------------------- */
  async function handleGenerateShareLink() {
    if (!userId || !slug || slug === 'new') return;
    const token = crypto.randomUUID();
    const supabase = createClient();
    const { error } = await supabase.from('sets').update({ share_token: token }).eq('slug', slug).eq('user_id', userId);
    if (error) { alert('Failed to generate share link: ' + error.message); return; }
    setShareToken(token);
  }

  async function handleRevokeShareLink() {
    if (!userId || !slug || slug === 'new') return;
    const supabase = createClient();
    await supabase.from('sets').update({ share_token: null }).eq('slug', slug).eq('user_id', userId);
    setShareToken(null);
  }

  function handleCopyPublicLink() {
    if (!shareToken) return;
    const url = `${window.location.origin}/share/${shareToken}`;
    navigator.clipboard.writeText(url).then(() => {
      setShareLinkCopied(true);
      setTimeout(() => setShareLinkCopied(false), 2500);
    });
  }

  function handleCopyShareCode() {
    const pinHash = sharePin.trim() ? simpleHash(sharePin.trim()) : null;
    const code = encodeSharePayload({ title: datasetTitle, year, brand, desc, rows, pinHash });
    navigator.clipboard.writeText(code).then(() => {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2500);
    });
  }

  /* ------------------- Sorting ------------------- */
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

  function SortableHeader({ label }: { label: SortKey }) {
    const isActive = sortKey === label;
    return (
      <th className={`whitespace-nowrap px-3 py-2 sticky top-0 z-10 bg-gray-100 ${isActive ? 'font-semibold' : 'font-medium'}`}>
        <button type="button" onClick={() => handleSortClick(label)}
          className="text-left underline decoration-dotted underline-offset-4 hover:decoration-solid">
          {label} {isActive ? (sortDir === 'asc' ? "↑" : "↓") : ""}
        </button>
      </th>
    );
  }

  /* ------------------- Render ------------------- */
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/"><Image src="/sports-collective-logo.png" alt="Sports Collective" width={240} height={64} className="h-8 w-auto" priority /></Link>
            <Link href="/" className="rounded-xl bg-white px-3 py-1 text-sm shadow">← Saved Sets</Link>
            <h1 className="text-2xl font-semibold">{datasetTitle || "New Set"}</h1>
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <span>{saveStatus}</span>
            <button type="button"
              onClick={() => { setSharePin(''); setShareCopied(false); setShowShareModal(true); }}
              disabled={!datasetTitle || !rows.length}
              className="rounded-2xl bg-emerald-600 px-4 py-2 text-white shadow hover:bg-emerald-700 disabled:opacity-40">
              Share
            </button>
            <button type="button" onClick={handleExport} disabled={!rows.length}
              className="rounded-2xl bg-gray-900 px-4 py-2 text-white shadow hover:bg-black disabled:opacity-40">
              Export CSV
            </button>
          </div>
        </header>

        {/* Upload */}
        <section className="rounded-2xl bg-white p-4 shadow">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex-1">
              <h2 className="text-lg font-medium">1) Upload CSV</h2>
              <p className="text-sm text-gray-600 mb-2">Standard format with headers: {EXPECTED_HEADERS.join(", ")}</p>
              <input type="file" accept=".csv,text/csv"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileChosen(f); }}
                className="block w-full rounded-xl border border-gray-300 bg-white p-2" />
            </div>
            <div className="flex-1 border-t pt-4 lg:border-t-0 lg:pt-0 lg:border-l lg:pl-4">
              <h2 className="text-lg font-medium">— or — Load PSA Export</h2>
              <p className="text-sm text-gray-600 mb-2">Upload a CSV exported from your PSA account. Grading Company auto-sets to PSA.</p>
              <input type="file" accept=".csv,text/csv"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePSAFileChosen(f); }}
                className="block w-full rounded-xl border border-blue-300 bg-blue-50 p-2" />
            </div>
          </div>
          {errors.length > 0 && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <ul className="list-disc pl-5">{errors.map((er, i) => <li key={i}>{er}</li>)}</ul>
            </div>
          )}
        </section>

        {/* Title form */}
        <section className="rounded-2xl bg-white p-4 shadow">
          <h2 className="text-lg font-medium">2) Name this dataset</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col">
              <label className="text-sm font-medium">Year</label>
              <input
                type="text"
                list="year-options"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="e.g., 1954"
                className="rounded-xl border border-gray-300 p-2"
              />
              <datalist id="year-options">
                {YEARS.map((y) => <option key={y} value={y} />)}
              </datalist>
            </div>
            <div className="flex flex-col">
              <label className="text-sm font-medium">Brand</label>
              <input
                type="text"
                list="brand-options"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g., Topps"
                className="rounded-xl border border-gray-300 p-2"
              />
              <datalist id="brand-options">
                {BRANDS.map((b) => <option key={b} value={b} />)}
              </datalist>
            </div>
            <div className="flex flex-col">
              <label className="text-sm font-medium">Description (≤ 60 chars)</label>
              <input type="text" value={v(desc)} maxLength={60} onChange={(e) => setDesc(e.target.value)}
                placeholder="e.g., Base set checklist" className="rounded-xl border border-gray-300 p-2" />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {canCreateTitle ? <>Title preview: <span className="font-medium">{titlePreview}</span></> : <>Choose year, brand, and enter a short description.</>}
            </div>
            <button type="button" onClick={handleCreateTitle} disabled={!canCreateTitle}
              className="rounded-2xl bg-blue-600 px-4 py-2 text-white shadow hover:bg-blue-700 disabled:opacity-40">
              Save Title
            </button>
          </div>
        </section>

        {/* Controls */}
        {datasetTitle && (
          <div className="rounded-2xl bg-white p-4 shadow">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <h3 className="text-lg font-semibold">Dataset: {datasetTitle}</h3>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-gray-600">{rows.length} rows</span>
                <button type="button" onClick={() => setShowNeededOnly(s => !s)}
                  className={`rounded-xl px-3 py-1 shadow border ${showNeededOnly ? 'bg-amber-500 text-white border-amber-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'}`}>
                  {showNeededOnly ? 'Showing: Cards Needed' : 'Show Cards Needed'}
                </button>
                <Link
                  href={`/set/${encodeURIComponent(slug)}/view`}
                  className="rounded-xl px-3 py-1 shadow border bg-white text-gray-800 border-gray-300 hover:bg-gray-50"
                >
                  View Inventory
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Table */}
        {rows.length > 0 ? (
          <section className="overflow-x-auto rounded-2xl bg-white p-0 shadow">
            <div className="max-h-[70vh] overflow-y-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-100">
                  <tr className="text-left">
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
                    <th className="whitespace-nowrap px-3 py-2 font-medium sticky top-0 z-10 bg-gray-100">Image 1</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium sticky top-0 z-10 bg-gray-100">Image 2</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map(({ row, origIndex }, i) => (
                    <tr key={`${origIndex}-${i}`} className="border-b last:border-0">
                      <td className="px-3 py-2 align-top"><input value={v(row["Card #"])} readOnly className="w-24 cursor-not-allowed rounded border border-gray-200 bg-gray-100 p-1" /></td>
                      <td className="px-3 py-2 align-top"><input value={v(row["Description"])} readOnly className="w-72 cursor-not-allowed rounded border border-gray-200 bg-gray-100 p-1" /></td>
                      <td className="px-3 py-2 align-top">
                        <select value={v(row["Owned"])} onChange={(e) => onChangeCell(origIndex, "Owned", e.target.value)} className="rounded border border-gray-300 p-1">
                          {YES_NO.map((o) => <option key={o} value={o}>{o}</option>)}
                          <option value=""></option>
                        </select>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <select value={v(row["Raw Grade"])} onChange={(e) => onChangeCell(origIndex, "Raw Grade", e.target.value)} className="rounded border border-gray-300 p-1">
                          {RAW_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <select value={v(row["Graded"])} onChange={(e) => onChangeCell(origIndex, "Graded", e.target.value)} className="rounded border border-gray-300 p-1">
                          {YES_NO.map((o) => <option key={o} value={o}>{o}</option>)}
                          <option value=""></option>
                        </select>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <select value={v(row["Grading Company"])} onChange={(e) => onChangeCell(origIndex, "Grading Company", e.target.value)} className="rounded border border-gray-300 p-1">
                          {COMPANIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <select value={v(row["Grade"])} onChange={(e) => onChangeCell(origIndex, "Grade", normalizeNumericGrade(e.target.value))} className="rounded border border-gray-300 p-1">
                          {GRADES_NUMERIC.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 align-top"><input value={v(row["Cost"])} onChange={(e) => onChangeCell(origIndex, "Cost", e.target.value)} onBlur={() => onBlurCurrency(origIndex, "Cost")} placeholder="$0.00" className="w-28 rounded border border-gray-300 p-1" /></td>
                      <td className="px-3 py-2 align-top"><input value={v(row["Value"])} onChange={(e) => onChangeCell(origIndex, "Value", e.target.value)} onBlur={() => onBlurCurrency(origIndex, "Value")} placeholder="$0.00" className="w-28 rounded border border-gray-300 p-1" /></td>
                      <td className="px-3 py-2 align-top"><input value={v(row["Target Price"])} onChange={(e) => onChangeCell(origIndex, "Target Price", e.target.value)} onBlur={() => onBlurCurrency(origIndex, "Target Price")} placeholder="$0.00" className="w-28 rounded border border-gray-300 p-1" /></td>
                      <td className="px-3 py-2 align-top"><input value={v(row["Sale Price"])} onChange={(e) => onChangeCell(origIndex, "Sale Price", e.target.value)} onBlur={() => onBlurCurrency(origIndex, "Sale Price")} placeholder="$0.00" className="w-28 rounded border border-gray-300 p-1" /></td>
                      <td className="px-3 py-2 align-top"><input value={v(row["Date Purchased"])} onChange={(e) => onChangeCell(origIndex, "Date Purchased", e.target.value)} onBlur={() => onBlurDate(origIndex)} placeholder="MM/DD/YYYY" className="w-32 rounded border border-gray-300 p-1" /></td>
                      <td className="px-3 py-2 align-top"><input value={v(row["Purchased From"])} onChange={(e) => onChangeCell(origIndex, "Purchased From", e.target.value)} maxLength={50} placeholder="Seller name or site" className="w-40 rounded border border-gray-300 p-1" /></td>
                      <td className="px-3 py-2 align-middle">
                        <ImageCell
                          url={v(row["Image 1"])}
                          label="Img 1"
                          onUpload={(file) => handleImageUpload(origIndex, 1, file)}
                          onDelete={() => handleImageDelete(origIndex, 1)}
                        />
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <ImageCell
                          url={v(row["Image 2"])}
                          label="Img 2"
                          onUpload={(file) => handleImageUpload(origIndex, 2, file)}
                          onDelete={() => handleImageDelete(origIndex, 2)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-gray-600">
            Upload your CSV to begin. After naming the dataset, edits auto-save.
          </div>
        )}
      </div>

      {/* Share modal */}
      {showShareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold">Share &ldquo;{datasetTitle}&rdquo;</h2>
            <p className="mt-1 text-sm text-gray-500">
              {shareToken
                ? 'This set is publicly listed. Anyone with the link can view it.'
                : 'Make this set public so anyone can view it, and it will appear on the Community Sets page.'}
            </p>
            <div className="mt-4 space-y-3">
              {shareToken ? (
                <>
                  <button type="button" onClick={handleCopyPublicLink}
                    className="w-full rounded-2xl bg-blue-600 px-4 py-2 text-sm text-white shadow hover:bg-blue-700">
                    {shareLinkCopied ? 'Copied!' : 'Copy Public Link'}
                  </button>
                  <button type="button" onClick={handleRevokeShareLink}
                    className="w-full rounded-2xl border border-red-300 bg-white px-4 py-2 text-sm text-red-600 shadow hover:bg-red-50">
                    Remove from Public
                  </button>
                </>
              ) : (
                <button type="button" onClick={handleGenerateShareLink}
                  className="w-full rounded-2xl bg-emerald-600 px-4 py-2 text-sm text-white shadow hover:bg-emerald-700">
                  Make Public
                </button>
              )}
              <button type="button" onClick={() => setShowShareModal(false)}
                className="w-full rounded-2xl border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 shadow hover:bg-gray-50">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
