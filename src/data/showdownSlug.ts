// Pokémon Showdown's sprite filenames follow its own toID() convention: lowercase,
// every non-alphanumeric character stripped (no hyphens, apostrophes, spaces,
// colons, periods, gender symbols). Empirically verified against the live CDN
// across ~19 tricky names (Mr. Mime, Ho-Oh, Nidoran-F, Type: Null, Farfetch'd,
// Jangmo-o, Great Tusk, Ting-Lu, ...) — the naive rule below matches for all but
// genuine exceptions, which get a small override table rather than a large
// hand-curated one.
const OVERRIDES: Record<string, string> = {
  // PokeAPI slug -> Showdown slug, only for species where the naive strip is wrong.
  // (Left empty for now — the runtime resolver's onerror fallback chain covers
  // any individual miss gracefully, so this only needs entries if/when a
  // specific species is spot-checked and found wrong.)
};

export function toShowdownSlug(pokeApiName: string): string {
  const override = OVERRIDES[pokeApiName];
  if (override) return override;
  return pokeApiName.toLowerCase().replace(/[^a-z0-9]/g, '');
}
