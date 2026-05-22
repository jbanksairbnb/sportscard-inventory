// Centralized brand list. Used by:
// - the brand datalist on /set/new (manual upload form)
// - the brand datalist on /set/[slug] (edit set info)
// - the filename-inference regex in /admin/templates (KNOWN_BRANDS)
// Keep alphabetized for the datalist UX. inferFromFilename has its own
// ordered regex list (longer multi-word patterns first) — keep in sync
// by name, even though the order there is fixed for matching.
export const BRANDS = [
  'Bowman',
  'Donruss',
  'Fleer',
  'Goudey',
  'Leaf',
  'O-Pee-Chee',
  'Panini',
  'Pinnacle',
  'Play Ball',
  'Score',
  'Sportflics',
  'Stadium Club',
  'Topps',
  'Upper Deck',
] as const;
