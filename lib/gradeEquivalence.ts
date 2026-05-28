// Raw-grade → PSA-equivalent numeric grade mapping. Matches the rubric
// the AI grader uses (lib/ai/card-grading.ts) so a card the AI calls
// "EX" lines up with a listing titled "PSA 5" when the cross-type
// matching toggle is on. Single source of truth — if we change either
// side of the mapping, change it here.
const RAW_TO_PSA: Record<string, number> = {
  'Gem Mint': 10,
  'Mint': 9,
  'NM-MT': 8,
  'NM+': 7.5,
  'NM': 7,
  'EXMT+': 6.5,
  'EXMT': 6,
  'EX+': 5.5,
  'EX': 5,
  'VG-EX+': 4.5,
  'VG-EX': 4,
  'VG+': 3.5,
  'VG': 3,
  'G/VG': 2.5,
  'G': 2,
  'P': 1,
};

// Returns the PSA-equivalent grade (1.0 - 10.0) for a raw-grade label,
// or null if the label isn't a recognized raw grade.
export function rawGradeToPsa(label: string | null | undefined): number | null {
  if (!label) return null;
  const v = RAW_TO_PSA[label.trim()];
  return typeof v === 'number' ? v : null;
}

// Normalize a target's grade-range bound into a PSA-equivalent number.
// For 'Graded' targets the bound is already numeric (parses 'PSA 8' →
// 8, '5.5' → 5.5). For 'Raw' targets it's a label like 'EX' that goes
// through the table above.
export function targetGradeToPsa(targetType: string, value: string): number | null {
  const v = (value || '').trim();
  if (!v) return null;
  if (targetType === 'Raw') return rawGradeToPsa(v);
  // Graded: strip any "PSA " / "SGC " prefix, parse what's left.
  const stripped = v.replace(/^(PSA|SGC|BGS|CGC|BVG|TAG|HGA|GMA|AGS)\s*/i, '').trim();
  const n = parseFloat(stripped);
  return Number.isFinite(n) ? n : null;
}
