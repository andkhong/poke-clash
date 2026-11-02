import { useCallback, useState } from 'react';
import { PlayModeScreen } from './ui/screens/PlayModeScreen';
import { ActionMatchScreen } from './ui/screens/ActionMatchScreen';
import { initialLockOn } from './ui/playModeSettings';
import { ActionEngine } from './sim/action/ActionEngine';
import { PlayerController } from './sim/action/playerController';
import type { MatchConfig } from './sim/types';
import { buildSpeciesMapForLevel, moveLookup } from './data/loader';
import { createSimStore, type SimStore } from './ui/state/simStore';

interface PlayMatch {
  config: MatchConfig;
  store: SimStore;
  controller: PlayerController;
}

/** Solo Play Mode (`#/local`): the setup screen, then a match against bots. */
export function App() {
  const [playMatch, setPlayMatch] = useState<PlayMatch | null>(null);

  const startPlayMatch = useCallback((config: MatchConfig) => {
    const species = buildSpeciesMapForLevel(config.speciesIds, config.level);
    const engine = new ActionEngine(config, species, moveLookup, Math.floor(Math.random() * 0xffffffff));
    setPlayMatch({ config, store: createSimStore(engine), controller: new PlayerController(engine, initialLockOn()) });
  }, []);

  return (
    <div style={{ width: '100vw', height: '100dvh', overflow: 'hidden' }}>
      {playMatch ? (
        <ActionMatchScreen
          store={playMatch.store}
          engine={playMatch.controller.engine}
          controller={playMatch.controller}
          onPlayAgain={() => startPlayMatch(playMatch.config)}
          onExit={() => setPlayMatch(null)}
        />
      ) : (
        <PlayModeScreen onStart={startPlayMatch} />
      )}
    </div>
  );
}
