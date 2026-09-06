import { useMemo, useState, type CSSProperties } from 'react';
import type { SpeciesSummary } from '../../data/loader';

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
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a Pokémon…" style={searchInput} />
      {results.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 140, overflowY: 'auto' }}>
          {results.map((s) => (
            <button key={s.id} onClick={() => onPick(s.id)} style={pillButton}>
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
  boxSizing: 'border-box',
  fontSize: 13,
  fontFamily: 'monospace',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(255,255,255,0.05)',
  color: '#eee',
  outline: 'none',
};

const pillButton: CSSProperties = {
  fontSize: 12,
  fontFamily: 'monospace',
  padding: '6px 12px',
  borderRadius: 16,
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(255,255,255,0.05)',
  color: '#ddd',
  cursor: 'pointer',
};
