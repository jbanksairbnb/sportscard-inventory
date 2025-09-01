'use client';

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import Papa from "papaparse";

/* =====================  Constants  ===================== */
const EXPECTED_HEADERS = [
  "Card #",
  "Description",
  "Owned",
  "Raw Grade",          // NEW column after Owned
  "Graded",
  "Grading Company",
  "Grade",              // numeric 10..1 in 0.5 steps
  "Cost",
  "Value",
  "Target Price",
  "Sale Price",
  "Date Purchased",
  "Purchased From",
  "Upload Image(s)",
];

const YEARS = Array.from({ length: 2025 - 1953 + 1 }, (_, i) => 1953 + i);
const BRANDS = ["Topps", "Bowman", "Play Ball"] as const;
const YES_NO = ["Yes", "No"] as const;
const COMPANIES = ["", "PSA", "SGC"] as const; // blank allowed
const RAW_GRADES = ["", "Gem Mint", "Mint", "NM-MT", "NM", "EXMT", "EX", "VG-EX", "VG", "G", "P"] as const;

// 10 → 1 by 0.5 increments, plus blank
const GRADES_NUMERIC = ["", ...Array.from({ length: 19 }, (_, i) => (10 - i * 0.5).toString().replace(/\.0$/, ""))];

// Columns we allow sorting on
type SortKey = typeof EXPECTED_HEADERS[number];
type SortDir = 'asc' | 'desc';

// Default sort direction for numeric columns
const DEFAULT_DIR: Partial<Record<SortKey, SortDir>> = {
  "Grade": "desc",
  "Cost": "desc",
  "Value": "desc",
  "Target Price": "desc",
};

// Currency fields for $0.00/blank-last
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
    const roundedHalf = Math.round(num * 2) / 2;
    const clamped = Math.min(10, Math.max(1, roundedHalf));
    const asStr = clamped.toFixed(1).replace(/\.0$/, "");
    return GRADES_NUMERIC.includes(asStr) ? asStr : "";
  }
  return GRADES_NUMERIC.includes(s) ? s : "";
}

// localStorage helpers
function loadIndex(): any[] {
  try {
    const raw = localStorage.getItem("sc_sets_index");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveIndex(index: any[]) {
  localStorage.setItem("sc_sets_index", JSON.stringify(index));
}
function upsertIndexEntry(entry: {
  slug: string; title: string; year: number; brand: string; desc: string;
  updatedAt: number; rowCount: number; ownedCount: number; ownedPct: number;
}) {
  const idx = loadIndex();
  const i = idx.findIndex((x: any) => x.slug === entry.slug);
  if (i >= 0) idx[i] = entry; else idx.push(entry);
  saveIndex(idx);
}
function loadSet(slug: string) {
  try {
    const raw = localStorage.getItem(`sc_set_${slug}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveSet(slug: string, data: any) {
  localStorage.setItem(`sc_set_${slug}`, JSON.stringify(data));
}
function ensureUniqueSlug(base: string) {
  const idx = loadIndex();
  let slug = base, i = 2;
  const existing = new Set(idx.map((x: any) => x.slug));
  while (existing.has(slug)) slug = `${base}-${i++}`;
  return slug;
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
function computeOwnedStats(rows: any[]) {
  const total = rows?.length || 0;
  const owned = rows?.filter((r) => String(r?.["Owned"] || "") === "Yes").length || 0;
  const pct = total ? (owned / total) * 100 : 0;
  return { ownedCount: owned, ownedPct: pct, total };
}

// For sorting
function asNumberForSort(field: string, row: Record<string, any>): number | null {
  const raw = row[field];
  if (field === "Grade") {
    const s = String(raw ?? "").trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  if (CURRENCY_FIELDS.includes(field as any)) {
    const s = stripCurrency(String(raw ?? ""));
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  if (field === "Card #") {
    const n = Number(String(raw ?? "").trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function textForSort(raw: any): string {
  return String(raw ?? "").toLowerCase();
}

/* =====================  Component  ===================== */
export default function SetEditorPage() {
  const router = useRouter();
  const params = useParams();
  const paramSlug = String(params?.slug || "new");

  const [slug, setSlug] = useState<string>(paramSlug);
  const [datasetTitle, setDatasetTitle] = useState<string>("");
  const [year, setYear] = useState<number | "">("");
  const [brand, setBrand] = useState<string>("");
  const [desc, setDesc] = useState<string>("");

  const [rows, setRows] = useState<Array<Record<string, any>>>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<string>("");

  // View & sort state
  const [showNeededOnly, setShowNeededOnly] = useState<boolean>(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ------------------- Load existing set ------------------- */
  useEffect(() => {
    if (paramSlug !== "new") {
      const existing = loadSet(paramSlug);
      if (existing) {
        setSlug(paramSlug);
        setDatasetTitle(existing.title || "");
        setYear(existing.year ?? "");
        setBrand(existing.brand ?? "");
        setDesc(existing.desc ?? "");
        setRows(existing.rows ?? []);
      } else {
        setSlug(paramSlug);
      }
    } else {
      setSlug("new");
      setDatasetTitle("");
      setYear("");
      setBrand("");
      setDesc("");
      setRows([]);
    }
  }, [paramSlug]);

  const canCreateTitle = year !== "" && !!brand && desc.trim().length > 0;
  const titlePreview = useMemo(
    () => (canCreateTitle ? `${year} ${brand} — ${desc.trim()}` : ""),
    [year, brand, desc, canCreateTitle]
  );

  /* ------------------- Auto-save ------------------- */
  function scheduleAutoSave(nextRows?: any[]) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (!slug || slug === "new" || !datasetTitle) return;

      const payload = { title: datasetTitle, year: year || "", brand, desc, rows: nextRows ?? rows };
      saveSet(slug, payload);

      const { ownedCount, ownedPct } = computeOwnedStats(nextRows ?? rows);
      upsertIndexEntry({
        slug,
        title: datasetTitle,
        year: Number(year) || 0,
        brand,
        desc,
        updatedAt: Date.now(),
        rowCount: (nextRows ?? rows)?.length || 0,
        ownedCount,
        ownedPct,
      });

      setSaveStatus(`Saved at ${new Date().toLocaleTimeString()}`);
    }, 500);
  }

  /* ------------------- File upload ------------------- */
  function handleFileChosen(file: File) {
    setErrors([]);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const incomingHeaders = result.meta.fields || [];
        const missing = EXPECTED_HEADERS.filter((h) => !incomingHeaders.includes(h));
        if (missing.length > 0) {
          setErrors([`CSV is missing required columns: ${missing.join(", ")}.`]);
          setRows([]);
          return;
        }

        const cleaned = (result.data as any[]).map((r) => {
          const norm: Record<string, any> = {};
          EXPECTED_HEADERS.forEach((h) => { norm[h] = r[h] ?? ""; });

          ["Owned", "Graded"].forEach((f) => {
            const v = String(norm[f]).trim().toLowerCase();
            norm[f] =
              v === "yes" || v === "y" || v === "true" || v === "1" ? "Yes" :
              v === "no"  || v === "n" || v === "false"|| v === "0" ? "No"  : "";
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
            if (digits.length === 8) {
              norm["Date Purchased"] = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
            }
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

  /* ------------------- Create title ------------------- */
  function handleCreateTitle(e?: React.MouseEvent) {
    e?.preventDefault();
    if (!canCreateTitle) return;

    const newTitle = `${year} ${brand} — ${desc.trim()}`;
    const base = slugify(newTitle);
    const unique = slug === "new" ? ensureUniqueSlug(base) : slug;

    const payload = { title: newTitle, year: year || "", brand, desc, rows };
    saveSet(unique, payload);

    const { ownedCount, ownedPct } = computeOwnedStats(rows);
    upsertIndexEntry({
      slug: unique,
      title: newTitle,
      year: Number(year) || 0,
      brand,
      desc,
      updatedAt: Date.now(),
      rowCount: rows.length,
      ownedCount,
      ownedPct,
    });

    setDatasetTitle(newTitle);
    setSlug(unique);
    if (slug === "new") router.replace(`/set/${unique}`);
  }

  /* ------------------- Cell changes ------------------- */
  function onChangeCell(index: number, field: string, value: any) {
    setRows((prev) => {
      const copy = [...prev];
      const r = { ...copy[index] };

      if (field === "Purchased From" && value.length > 50) {
        r[field] = value.slice(0, 50);
      } else if (CURRENCY_FIELDS.includes(field as any)) {
        r[field] = value;
      } else if (field === "Date Purchased") {
        r[field] = autoSlashDate(value);
      } else {
        r[field] = value;
      }

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
      const r = { ...copy[index] };
      const s = String(r["Date Purchased"] ?? "");
      if (s && !isValidMMDDYYYY(s)) alert(`Invalid date: ${s}. Use MM/DD/YYYY`);
      copy[index] = r;
      return copy;
    });
    scheduleAutoSave();
  }

  /* ------------------- Export ------------------- */
  function handleExport() {
    if (!rows.length) {
      alert("No data to export.");
      return;
    }
    const name = datasetTitle || "sportscard-export";
    downloadCSV(name, rows);
  }

  /* ------------------- Sorting ------------------- */
  const displayRows: Array<{ row: Record<string, any>, origIndex: number }> = useMemo(() => {
    let filtered = rows.map((r, idx) => ({ row: r, origIndex: idx }));
    if (showNeededOnly) {
      filtered = filtered.filter(({ row }) => String(row["Owned"] ?? "") !== "Yes");
    }

    if (!sortKey) return filtered;

    const dir = sortDir === 'asc' ? 1 : -1;

    const cmp = (a: {row: any}, b: {row: any}) => {
      if ((CURRENCY_FIELDS as readonly string[]).includes(sortKey)) {
        const as = stripCurrency(String(a.row[sortKey] ?? ""));
        const bs = stripCurrency(String(b.row[sortKey] ?? ""));
        const an = as === "" ? null : Number(as);
        const bn = bs === "" ? null : Number(bs);

        const aEmptyZero = an === null || an === 0;
        const bEmptyZero = bn === null || bn === 0;

        if (aEmptyZero !== bEmptyZero) return aEmptyZero ? 1 : -1; // empty/zero last
        if (an === null && bn === null) return 0;
        if (an! < bn!) return -1 * dir;
        if (an! > bn!) return  1 * dir;
        return 0;
      }

      const an = asNumberForSort(sortKey, a.row);
      const bn = asNumberForSort(sortKey, b.row);
      if (an !== null || bn !== null) {
        if (an === null && bn === null) return 0;
        if (an === null) return 1;   // blank last
        if (bn === null) return -1;  // blank last
        if (an < bn) return -1 * dir;
        if (an > bn) return  1 * dir;
        return 0;
      }

      const at = textForSort(a.row[sortKey]);
      const bt = textForSort(b.row[sortKey]);
      const aBlank = at === "";
      const bBlank = bt === "";
      if (aBlank !== bBlank) return aBlank ? 1 : -1; // blank last
      return at.localeCompare(bt) * dir;
    };

    return [...filtered].sort(cmp);
  }, [rows, showNeededOnly, sortKey, sortDir]);

  function handleSortClick(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir(DEFAULT_DIR[key] ?? 'asc');
    } else {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    }
  }

  function SortableHeader({ label }: { label: SortKey }) {
    const isActive = sortKey === label;
    const arrow = isActive ? (sortDir === 'asc' ? "↑" : "↓") : "";
    return (
      <th
        className={`whitespace-nowrap px-3 py-2 sticky top-0 z-10 bg-gray-100 ${isActive ? 'font-semibold' : 'font-medium'}`}
      >
        <button
          type="button"
          onClick={() => handleSortClick(label)}
          className="text-left underline decoration-dotted underline-offset-4 hover:decoration-solid"
        >
          {label} {arrow}
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
            {/* 👇 Small logo next to Saved Sets */}
            <Image
              src="/sports-collective-logo.png"
              alt="Sports Collective"
              width={240}
              height={64}
              className="h-8 w-auto"
              priority
            />
            <Link href="/" className="rounded-xl bg-white px-3 py-1 text-sm shadow">← Saved Sets</Link>
            <h1 className="text-2xl font-semibold">{datasetTitle || "New Set"}</h1>
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <span>{saveStatus}</span>
            <button
              type="button"
              onClick={handleExport}
              className="rounded-2xl bg-gray-900 px-4 py-2 text-white shadow hover:bg-black disabled:opacity-40"
              disabled={!rows.length}
            >
              Export CSV
            </button>
          </div>
        </header>

        {/* Upload */}
        <section className="rounded-2xl bg-white p-4 shadow">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-lg font-medium">1) Upload CSV</h2>
              <p className="text-sm text-gray-600">Expected headers: {EXPECTED_HEADERS.join(", ")}</p>
            </div>
            <div>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileChosen(f); }}
                className="block w-full rounded-xl border border-gray-300 bg-white p-2"
              />
            </div>
          </div>

          {errors.length > 0 && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <ul className="list-disc pl-5">
                {errors.map((er, i) => <li key={i}>{er}</li>)}
              </ul>
            </div>
          )}
        </section>

        {/* Title form */}
        <section className="rounded-2xl bg-white p-4 shadow">
          <h2 className="text-lg font-medium">2) Name this dataset</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col">
              <label className="text-sm font-medium">Year</label>
              <select
                value={year as any}
                onChange={(e) => setYear(e.target.value ? Number(e.target.value) : "")}
                className="rounded-xl border border-gray-300 p-2"
              >
                <option value="">Select year</option>
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="flex flex-col">
              <label className="text-sm font-medium">Brand</label>
              <select
                value={v(brand)}
                onChange={(e) => setBrand(e.target.value)}
                className="rounded-xl border border-gray-300 p-2"
              >
                <option value="">Select brand</option>
                {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="flex flex-col">
              <label className="text-sm font-medium">Description (≤ 60 chars)</label>
              <input
                type="text"
                value={v(desc)}
                maxLength={60}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="e.g., Base set checklist"
                className="rounded-xl border border-gray-300 p-2"
              />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {canCreateTitle
                ? <>Title preview: <span className="font-medium">{titlePreview}</span></>
                : <>Choose year, brand, and enter a short description.</>}
            </div>
            <button
              type="button"
              onClick={handleCreateTitle}
              disabled={!canCreateTitle}
              className="rounded-2xl bg-blue-600 px-4 py-2 text-white shadow hover:bg-blue-700 disabled:opacity-40"
            >
              Save Title
            </button>
          </div>
        </section>

        {/* Info + Controls */}
        {datasetTitle && (
          <div className="rounded-2xl bg-white p-4 shadow">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <h3 className="text-lg font-semibold">Dataset: {datasetTitle}</h3>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-gray-600">{rows.length} rows</span>
                <button
                  type="button"
                  onClick={() => setShowNeededOnly(s => !s)}
                  className={`rounded-xl px-3 py-1 shadow border ${showNeededOnly ? 'bg-amber-500 text-white border-amber-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'}`}
                >
                  {showNeededOnly ? 'Showing: Cards Needed' : 'Show Cards Needed'}
                </button>
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
                    <th className="whitespace-nowrap px-3 py-2 font-medium sticky top-0 z-10 bg-gray-100">
                      Upload Image(s)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map(({ row, origIndex }, i) => (
                    <tr key={`${origIndex}-${i}`} className="border-b last:border-0">
                      <td className="px-3 py-2 align-top">
                        <input value={v(row["Card #"])} readOnly className="w-24 cursor-not-allowed rounded border border-gray-200 bg-gray-100 p-1" />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <input value={v(row["Description"])} readOnly className="w-72 cursor-not-allowed rounded border border-gray-200 bg-gray-100 p-1" />
                      </td>
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
                      <td className="px-3 py-2 align-top">
                        <input value={v(row["Cost"])} onChange={(e) => onChangeCell(origIndex, "Cost", e.target.value)} onBlur={() => onBlurCurrency(origIndex, "Cost")} placeholder="$0.00" className="w-28 rounded border border-gray-300 p-1" />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <input value={v(row["Value"])} onChange={(e) => onChangeCell(origIndex, "Value", e.target.value)} onBlur={() => onBlurCurrency(origIndex, "Value")} placeholder="$0.00" className="w-28 rounded border border-gray-300 p-1" />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <input value={v(row["Target Price"])} onChange={(e) => onChangeCell(origIndex, "Target Price", e.target.value)} onBlur={() => onBlurCurrency(origIndex, "Target Price")} placeholder="$0.00" className="w-28 rounded border border-gray-300 p-1" />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <input value={v(row["Sale Price"])} onChange={(e) => onChangeCell(origIndex, "Sale Price", e.target.value)} onBlur={() => onBlurCurrency(origIndex, "Sale Price")} placeholder="$0.00" className="w-28 rounded border border-gray-300 p-1" />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <input value={v(row["Date Purchased"])} onChange={(e) => onChangeCell(origIndex, "Date Purchased", e.target.value)} onBlur={() => onBlurDate(origIndex)} placeholder="MM/DD/YYYY" className="w-32 rounded border border-gray-300 p-1" />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <input value={v(row["Purchased From"])} onChange={(e) => onChangeCell(origIndex, "Purchased From", e.target.value)} maxLength={50} placeholder="Seller name or site" className="w-40 rounded border border-gray-300 p-1" />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(e) => {
                            const files = e.target.files;
                            if (!files || !files.length) return;
                            const urls = Array.from(files).map((f) => URL.createObjectURL(f));
                            onChangeCell(origIndex, "Upload Image(s)", urls.join("; "));
                          }}
                          className="w-44 rounded border border-gray-300 p-1"
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
            Upload your CSV to begin. After naming the dataset, edits auto-save under that set.
          </div>
        )}
      </div>
    </div>
  );
}
