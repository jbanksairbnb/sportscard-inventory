// Parsing listing "player" values into matchable player names.
//
// The player column is not a clean player name. On this inventory it is
// predominantly "Player Name - Team Name", frequently with a card-type suffix
// ("RC", "DP", "IA"), and it is also used for cards that have no single player
// at all: team cards, checklists, league leader cards naming three players,
// and whole-lot listings ("52 Card Lot", "Complete Set").
//
// Taking the last whitespace token as a surname — the obvious approach — is
// badly wrong here: 81% of distinct player values end in a team name or a card
// suffix, so "RC" alone would collapse 81 unrelated cards into one "player",
// and every Red Sox card would match every White Sox card.
//
// So we parse instead, and we bias hard toward returning nothing: a listing we
// can't confidently read yields no names and simply falls back to year-based
// matching. A missed match costs one suggestion; a false match tags a bidder
// for a player they never bid on, which is the error that erodes trust in the
// whole feature.

// Card-type suffixes that trail a player name. Stripped from the end, and
// repeatedly, since a few carry two ("... RC SP").
const CARD_SUFFIX_RE = /\s+(RC|DP|SP|IA|AS|BP|MG|TR|CL|COA|HL|WS|MVP)\.?$/i;

// Full team names, longest-first at match time, so "Chico Ruiz - California
// Angels" strips cleanly. Short forms are included because the data uses them
// ("Ken Harrelson - Red Sox AS").
const TEAM_NAMES = [
  'california angels', 'los angeles angels of anaheim', 'los angeles angels', 'anaheim angels',
  'houston astros', 'oakland athletics', 'kansas city athletics', 'philadelphia athletics',
  "oakland a's", 'atlanta braves', 'milwaukee braves', 'boston braves', 'milwaukee brewers',
  'st. louis cardinals', 'st louis cardinals', 'chicago cubs', 'los angeles dodgers',
  'brooklyn dodgers', 'montreal expos', 'san francisco giants', 'new york giants',
  'cleveland indians', 'cleveland guardians', 'new york mets', 'baltimore orioles',
  'san diego padres', 'philadelphia phillies', 'seattle pilots', 'pittsburgh pirates',
  'texas rangers', 'cincinnati reds', 'colorado rockies', 'kansas city royals',
  'washington senators', 'washington nationals', 'boston red sox', 'chicago white sox',
  'detroit tigers', 'minnesota twins', 'new york yankees', 'toronto blue jays',
  'seattle mariners', 'miami marlins', 'florida marlins', 'arizona diamondbacks',
  'tampa bay rays', 'tampa bay devil rays', 'red sox', 'white sox', 'blue jays',
].sort((a, b) => b.length - a.length);

// Any of these left inside a candidate means we are still looking at team
// context rather than a person, so the candidate is dropped.
const TEAM_NICKNAMES = new Set([
  'angels', 'astros', 'athletics', "a's", 'braves', 'brewers', 'cardinals', 'cubs',
  'dodgers', 'expos', 'giants', 'indians', 'guardians', 'mets', 'orioles', 'padres',
  'phillies', 'pilots', 'pirates', 'rangers', 'reds', 'rockies', 'royals', 'senators',
  'nationals', 'sox', 'tigers', 'twins', 'yankees', 'jays', 'mariners', 'marlins',
  'diamondbacks', 'rays',
]);

// Words that mark a listing as something other than one person's card. Chosen
// to avoid real surnames in this inventory — note the absence of Hall, King,
// Short, Young, May, Wise, Money, Stone and Brown, all of which are players
// here.
const NON_PLAYER_WORDS = new Set([
  'team', 'teams', 'checklist', 'checklists', 'rookies', 'rookie', 'leaders', 'leader',
  'leading', 'champions', 'champs', 'championship', 'series', 'game', 'playoffs', 'lcs',
  'summary', 'lot', 'lots', 'set', 'sets', 'card', 'cards', 'stars', 'famers', 'fame',
  'assorted', 'different', 'complete', 'factory', 'sealed', 'traded', 'test', 'removal',
  'listing', 'grade', 'loaded', 'including', 'greats', 'firemen', 'victory', 'batting',
  'pitching', 'strikeout', 'record', 'breaker', 'super', 'world', 'all-time', 'rbi', 'era',
]);

// Name suffixes dropped before taking a surname, so "Ken Griffey Jr." and
// "Ken Griffey" resolve to the same person.
const NAME_SUFFIX_RE = /\s+(jr|sr|ii|iii|iv|v)\.?$/i;

function stripCardSuffixes(s: string): string {
  let out = s.trim();
  for (;;) {
    const next = out.replace(CARD_SUFFIX_RE, '').trim();
    if (next === out) return out;
    out = next;
  }
}

// Drop a trailing team name. Returns null when the segment IS a team name (so
// the caller discards it) and the unchanged string when no team is present.
function stripTrailingTeam(segment: string): string | null {
  const lower = segment.toLowerCase();
  for (const team of TEAM_NAMES) {
    if (lower === team) return null;
    if (lower.endsWith(' ' + team)) return segment.slice(0, segment.length - team.length - 1).trim();
  }
  return segment;
}

function looksLikePerson(candidate: string): boolean {
  const cleaned = candidate.trim();
  if (!cleaned) return false;
  // Digits mean a year, a card number or a checklist range — never a name.
  if (/\d/.test(cleaned)) return false;
  const tokens = cleaned.split(/\s+/);
  if (tokens.length < 1 || tokens.length > 4) return false;
  for (const raw of tokens) {
    const t = raw.toLowerCase().replace(/[.,]/g, '');
    if (!t) return false;
    if (NON_PLAYER_WORDS.has(t)) return false;
    if (TEAM_NICKNAMES.has(t)) return false;
    if (!/^[a-z'’-]+$/.test(t)) return false;
  }
  return true;
}

// Every person named by a listing's player value. Leader cards and combo cards
// name several, and each one is a legitimate match target.
export function extractPlayers(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let work = raw.trim();
  if (!work) return [];
  // "Checklist (#458-533) Juan Marichal - ..." — the parenthetical range would
  // otherwise disqualify a segment that does name a player.
  work = work.replace(/^checklist\s*\([^)]*\)\s*/i, '');
  work = stripCardSuffixes(work);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawSegment of work.split(/\s+-\s+/)) {
    const afterTeam = stripTrailingTeam(stripCardSuffixes(rawSegment));
    if (afterTeam === null) continue;
    // Combo and leader cards separate their players with / & or commas.
    for (const rawPart of afterTeam.split(/\s*[/&,]\s*/)) {
      const part = stripCardSuffixes(rawPart.trim());
      if (!looksLikePerson(part)) continue;
      const key = part.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(part.replace(/\s+/g, ' '));
    }
  }
  return out;
}

// The surnames a listing can be matched on, lowercased.
export function lastNamesOf(raw: string | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const player of extractPlayers(raw)) {
    const base = player.replace(NAME_SUFFIX_RE, '').trim();
    const tokens = base.split(/\s+/);
    const last = (tokens[tokens.length - 1] || '').toLowerCase().replace(/[.,]/g, '');
    if (!last || seen.has(last)) continue;
    seen.add(last);
    out.push(last);
  }
  return out;
}

// True when two listing player values name a player in common by surname.
export function playersMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = lastNamesOf(a);
  if (left.length === 0) return false;
  const right = new Set(lastNamesOf(b));
  if (right.size === 0) return false;
  return left.some(n => right.has(n));
}
