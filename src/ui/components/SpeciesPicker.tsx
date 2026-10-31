import { useMemo, useState, type CSSProperties } from 'react';
import type { SpeciesSummary } from '../../data/loader';
import { FONT_BODY, FONT_UI, INFO_BOX, INK, OUTLINE, PANEL } from '../theme';

interface SpeciesPickerProps {
  allSpecies: SpeciesSummary[];
  excludeSpeciesIds: number[];
  onPick: (speciesId: number) => void;
}

const MAX_SEARCH_RESULTS = 40;

export function SpeciesPicker({ allSpecies, excludeSpeciesIds, onPick }: SpeciesPickerProps) {
  const [query, setQuery] = useState('');
  const excludeSet = useMemo(() => new Set(excludeSpeciesIds), [excludeSpeciesIds]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();
    return allSpecies.filter((s) => !excludeSet.has(s.id) && s.name.toLowerCase().includes(q)).slice(0, MAX_SEARCH_RESULTS);
  }, [allSpecies, query, excludeSet]);

  return (
    <div style={{ width: '100%' }}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a Pokémon…"
        aria-label="Search a Pokémon"
        style={searchInput}
      />
      {results.length > 0 && (
        <div style={resultsGrid}>
          {results.map((s) => (
            <button key={s.id} type="button" onClick={() => onPick(s.id)} style={tileButton}>
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const searchInput: CSSProperties = {
  width: '100%',
  minHeight: 46,
  boxSizing: 'border-box',
  fontSize: 16,
  fontFamily: FONT_BODY,
  padding: '0 12px',
  borderRadius: 8,
  border: OUTLINE,
  background: PANEL,
  color: INK,
};

const resultsGrid: CSSProperties = {
  marginTop: 8,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
  gap: 6,
  maxHeight: 180,
  overflowY: 'auto',
};

// The Lobby artboard's dex tiles: info-box fill, ink outline.
const tileButton: CSSProperties = {
  minHeight: 44,
  padding: '0 8px',
  fontSize: 16,
  fontFamily: FONT_UI,
  borderRadius: 6,
  border: OUTLINE,
  background: INFO_BOX,
  color: INK,
  cursor: 'pointer',
};
