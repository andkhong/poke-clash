/** Language filter for room chat — swearing and, more importantly, slurs.
 * Lives beside chat.ts because both sides need it: game-server enforces it
 * (a rejected message never reaches the log or the SSE broadcast) and the
 * client pre-checks with the same code so the sender gets an instant notice
 * instead of a round-trip.
 *
 * Matching is deliberately obfuscation-tolerant rather than literal, because
 * every real bypass attempt in a game chat is a spelling trick: `f u c k`,
 * `fuuuck`, `sh!t`, `f*ck`, `nlgger`, `ＦＵＣＫ`, `fúck`. Text is folded
 * (compatibility-decomposed, de-accented, lowercased, homoglyphs mapped),
 * then each term is matched as a pattern that allows per-letter leetspeak
 * substitutions, runs of repeated letters, a `*`-style censor character in
 * any letter's place, and short separators between letters.
 *
 * The trade-off that shapes the two lists below: separator-tolerant matching
 * makes the Scunthorpe problem worse, not better, so only terms whose
 * letters are effectively never a substring of an innocent word are matched
 * anywhere in the text. Everything else — anything that lives inside `class`,
 * `raccoon`, `spice`, `Pakistan`, `Japan` — is matched at word boundaries. */

/** Terms matched anywhere in the folded text, including inside a longer run
 * of characters (`xxniggerxx`). Only slurs distinctive enough that an
 * innocent word never contains them belong here. */
const ANYWHERE_TERMS: readonly string[] = [
  'nigger',
  'nigga',
  'niglet',
  'faggot',
  'fagget',
  'wetback',
  'towelhead',
  'raghead',
  'shemale',
  'tranny',
  'kike',
  'gook',
  'beaner',
  'zipperhead',
  'jigaboo',
  'porchmonkey',
  'coonass',
  'halfbreed',
  'whitepower',
  'heilhitler',
  'motherfucker',
  'cocksucker',
];

/** Terms matched only as whole words (leading and trailing non-alphanumeric
 * or end of string), so `class`, `bass`, `raccoon`, `spice`, `Pakistan`,
 * `Japan`, `assassin`, `Scunthorpe` and friends stay sendable. */
const WORD_TERMS: readonly string[] = [
  // Slurs whose letters do appear inside ordinary words.
  'fag',
  'fags',
  'spic',
  'spics',
  'chink',
  'chinks',
  'coon',
  'coons',
  'paki',
  'pakis',
  'jap',
  'japs',
  'dyke',
  'dykes',
  'retard',
  'retards',
  'retarded',
  'tard',
  'mongoloid',
  'sand nigger',
  'white trash',
  'gas the jews',
  // Profanity.
  'fuck',
  'fuk',
  'fuc',
  'fck',
  'fucker',
  'fucking',
  'fucked',
  'fucks',
  'clusterfuck',
  'shit',
  'shite',
  'shitty',
  'bullshit',
  'bitch',
  'bitches',
  'bitching',
  'cunt',
  'cunts',
  'ass',
  'asses',
  'arse',
  'asshole',
  'assholes',
  'arsehole',
  'dumbass',
  'jackass',
  'bastard',
  'bastards',
  'dick',
  'dicks',
  'dickhead',
  'cock',
  'cocks',
  'prick',
  'pricks',
  'twat',
  'wanker',
  'wank',
  'bollocks',
  'piss',
  'pissed',
  'slut',
  'sluts',
  'whore',
  'whores',
  'hoe',
  'hoes',
  'douchebag',
  'cum',
  'jizz',
  'dildo',
  'porn',
  'pornhub',
  'rape',
  'rapist',
  'kys',
  'stfu',
  'gtfo',
];

/** Characters that are not the letter they look like. NFKD already folds
 * fullwidth/styled Latin and strips accents; this covers the Cyrillic and
 * Greek lookalikes that survive it. */
const HOMOGLYPHS: Record<string, string> = {
  а: 'a', в: 'b', с: 'c', ԁ: 'd', е: 'e', ѕ: 's', і: 'i', ї: 'i', ј: 'j', к: 'k',
  м: 'm', н: 'h', о: 'o', р: 'p', т: 't', у: 'y', х: 'x', ѵ: 'v', г: 'r',
  α: 'a', β: 'b', ε: 'e', ι: 'i', κ: 'k', ο: 'o', ρ: 'p', σ: 's', τ: 't', υ: 'u', χ: 'x',
};

/** Every character that can stand in for a given letter. `*` is handled
 * separately as a wildcard, so `f*ck` and `sh*t` are caught without listing
 * it against each letter. */
const SUBSTITUTES: Record<string, string> = {
  a: 'a@4^',
  b: 'b8',
  c: 'c(<{[',
  d: 'd',
  e: 'e3&',
  f: 'f',
  g: 'g69q',
  h: 'h#',
  i: 'i1!|lj',
  j: 'j',
  k: 'k',
  l: 'l1|i',
  m: 'm',
  n: 'n',
  o: 'o0()',
  p: 'p',
  q: 'q9',
  r: 'r',
  s: 's5$z',
  t: 't7+',
  u: 'uv',
  v: 'vu',
  w: 'w',
  x: 'x',
  y: 'y',
  z: 'z2s',
};

/** Up to two characters of "separator" between letters — the `f.u.c.k` /
 * `f u c k` / `s-h-i-t` family. Two rather than unlimited so a term's
 * letters can't be found scattered across a whole sentence. */
const SEPARATOR = '[^a-z0-9]{0,2}';

function escapeClass(chars: string): string {
  return chars.replace(/[\\\]^-]/g, '\\$&');
}

/** One term → a source pattern. Each letter becomes its substitution class
 * plus the `*` wildcard, repeated (`fuuuck`), with separators allowed
 * between letters. A space in the term is just a separator that must be
 * there. Digits and anything else match themselves. */
function termPattern(term: string): string {
  const parts: string[] = [];
  for (const char of term) {
    if (char === ' ') {
      parts.push('[^a-z0-9]{1,3}');
      continue;
    }
    const substitutes = SUBSTITUTES[char];
    parts.push(substitutes ? `[${escapeClass(substitutes)}*]+` : `${char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}+`);
  }
  // A term's own space already carries its separator, so only join the rest.
  return parts.reduce((pattern, part, index) => {
    if (index === 0) return part;
    const isSpaceJoin = part.startsWith('[^a-z0-9]') || parts[index - 1].startsWith('[^a-z0-9]{1,3}');
    return isSpaceJoin ? pattern + part : `${pattern}${SEPARATOR}${part}`;
  }, '');
}

const ANYWHERE_RE = new RegExp(ANYWHERE_TERMS.map(termPattern).join('|'));
const WORD_SOURCE = WORD_TERMS.map(termPattern).join('|');
const WORD_RE = new RegExp(`(?:^|[^a-z0-9])(?:${WORD_SOURCE})(?:[^a-z0-9]|$)`);

/** Terms that also count at the very start or end of a name segment, where
 * there is no space to make a word boundary (`Fuck482`, `Sh1tMunchr`). Only
 * terms long and distinctive enough to survive that looser rule: short ones
 * like `ass`, `coon` and `fag` are left out on purpose, because the names
 * here are generated from species and `Nosepass`, `Froslass`, `Cascoon` and
 * `Cofagrigus` all end or begin with one. */
const NAME_EDGE_TERMS: readonly string[] = [
  'fuck',
  'fucker',
  'shit',
  'bitch',
  'cunt',
  'asshole',
  'arsehole',
  'bastard',
  'dickhead',
  'dick',
  'cock',
  'prick',
  'twat',
  'wanker',
  'whore',
  'slut',
  'retard',
  'rapist',
  'rape',
  'porn',
  'dildo',
  'jizz',
];

const NAME_EDGE_SOURCE = NAME_EDGE_TERMS.map(termPattern).join('|');
const NAME_PREFIX_RE = new RegExp(`^(?:${NAME_EDGE_SOURCE})`);
const NAME_SUFFIX_RE = new RegExp(`(?:${NAME_EDGE_SOURCE})$`);

/** Lowercased, de-accented, homoglyph-mapped text — the form both regexes
 * are written against. Exported for tests. */
export function foldForFilter(raw: string): string {
  const stripped = raw.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  let folded = '';
  for (const char of stripped) folded += HOMOGLYPHS[char] ?? char;
  return folded;
}

/** True when the text contains a slur or a swear word, however it was
 * spelled. Callers treat that as "don't send this", not as something to
 * censor in place: a partially starred-out line still reads as the insult it
 * was, and masking invites finding the mask's edges. */
export function containsBlockedLanguage(raw: string): boolean {
  const folded = foldForFilter(raw);
  return ANYWHERE_RE.test(folded) || WORD_RE.test(folded);
}

/** A display name split the way a reader reads it: on separators and on
 * camelCase humps, so `Sh1tMunchr` is ['sh1t', 'munchr']. Letter/digit
 * transitions are deliberately not split — a digit inside a word is usually
 * leetspeak (`sh1t`), and a trailing `482` is handled by the prefix rule. */
function nameSegments(raw: string): string[] {
  const spaced = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return foldForFilter(spaced).split(/[^a-z0-9]+/).filter((segment) => segment.length > 0);
}

/** The same rule as containsBlockedLanguage, plus a stricter pass for names:
 * a NAME_EDGE_TERMS word at the start or end of any segment counts, because
 * a name is a coinage rather than a sentence and `Fuck482` / `Sh1tMunchr`
 * would sail through a word-boundary check. */
export function containsBlockedLanguageInName(raw: string): boolean {
  if (containsBlockedLanguage(raw)) return true;
  return nameSegments(raw).some((segment) => NAME_PREFIX_RE.test(segment) || NAME_SUFFIX_RE.test(segment));
}
