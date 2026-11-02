import { useMemo, useState, type CSSProperties } from 'react';
import { useIntl } from 'react-intl';
import type { SpeciesSummary } from '../../data/loader';
import { hoennButtonSm } from '../crowd/hoenn';
import { ACTION, FONT_BODY, INFO_BOX, INK, INK_MUTED, OUTLINE, PANEL, SUNK } from '../theme';
import { SpeciesSprite } from './SpeciesSprite';

interface SpeciesPickerProps {
  allSpecies: SpeciesSummary[];
  /** Picked by someone else: shown greyed out, not pickable. */
  takenSpeciesIds?: number[];
  selectedSpeciesId?: number | null;
  onPick: (speciesId: number) => void;
}

const TILE = 76;
/** Last national dex id of each generation, in order. */
const GEN_ENDS = [151, 251, 386, 493];
const genOf = (id: number) => GEN_ENDS.findIndex((end) => id <= end) + 1;

/** Every species as a sprite tile, one generation at a time (search spans them all): players know Pokémon by shape faster than by spelling. */
export function SpeciesPicker({ allSpecies, takenSpeciesIds = [], selectedSpeciesId = null, onPick }: SpeciesPickerProps) {
  const intl = useIntl();
  const [query, setQuery] = useState('');
  const gens = useMemo(() => [...new Set(allSpecies.map((s) => genOf(s.id)))].sort((a, b) => a - b), [allSpecies]);
  const [gen, setGen] = useState(() => (selectedSpeciesId !== null ? genOf(selectedSpeciesId) : (gens[0] ?? 1)));
  const takenSet = useMemo(() => new Set(takenSpeciesIds), [takenSpeciesIds]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? allSpecies.filter((s) => s.name.toLowerCase().includes(q)) : allSpecies.filter((s) => genOf(s.id) === gen);
  }, [allSpecies, query, gen]);

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={intl.formatMessage({
          id: 'speciesPicker.placeholder',
          defaultMessage: 'Search a Pokémon…',
        })}
        aria-label={intl.formatMessage({
          id: 'speciesPicker.label',
          defaultMessage: 'Search a Pokémon',
        })}
        style={searchInput}
      />
      {gens.length > 1 && !query.trim() && (
        <div
          role="group"
          aria-label={intl.formatMessage({ id: 'speciesPicker.genLabel', defaultMessage: 'Generation' })}
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
        >
          {gens.map((g) => (
            <button key={g} type="button" aria-pressed={g === gen} onClick={() => setGen(g)} style={hoennButtonSm(g === gen ? 'primary' : 'secondary')}>
              {intl.formatMessage({ id: 'speciesPicker.gen', defaultMessage: 'Gen {gen}' }, { gen: g })}
            </button>
          ))}
        </div>
      )}
      {results.length > 0 ? (
        <div style={grid}>
          {results.map((s) => {
            const taken = takenSet.has(s.id);
            const selected = s.id === selectedSpeciesId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onPick(s.id)}
                disabled={taken}
                aria-pressed={selected}
                aria-label={
                  taken ? intl.formatMessage({ id: 'speciesPicker.taken', defaultMessage: '{name} (taken)' }, { name: s.name }) : s.name
                }
                title={s.name}
                style={tile(selected, taken)}
              >
                <SpeciesSprite speciesId={s.id} size={TILE - 16} name={s.name} />
                <span style={tileName}>{s.name}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 14, color: INK_MUTED }}>
          {intl.formatMessage({ id: 'speciesPicker.noMatch', defaultMessage: 'No Pokémon match “{query}”.' }, { query: query.trim() })}
        </p>
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

const grid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fill, minmax(${TILE + 8}px, 1fr))`,
  gap: 6,
  maxHeight: 4 * (TILE + 26) + 3 * 6,
  overflowY: 'auto',
  padding: 3,
};

// The Lobby artboard's dex tiles: info-box fill, ink outline; gold ring on your pick.
function tile(selected: boolean, taken: boolean): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    padding: '4px 2px',
    borderRadius: 6,
    border: OUTLINE,
    background: taken ? SUNK : selected ? ACTION : INFO_BOX,
    opacity: taken ? 0.45 : 1,
    filter: taken ? 'grayscale(1)' : 'none',
    color: INK,
    cursor: taken ? 'not-allowed' : 'pointer',
    minWidth: 0,
  };
}

const tileName: CSSProperties = {
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontFamily: FONT_BODY,
  fontSize: 12,
  fontWeight: 700,
};
