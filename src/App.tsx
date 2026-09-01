import { useCallback, useState } from 'react';
import { SetupScreen } from './ui/screens/SetupScreen';
import { MatchScreen } from './ui/screens/MatchScreen';
import type { MatchConfig } from './sim/types';
import { SimulationEngine } from './sim/engine';
import { buildSpeciesMapForLevel, moveLookup } from './data/loader';
import { createSimStore, type SimStore } from './ui/state/simStore';

export function App() {
  const [store, setStore] = useState<SimStore | null>(null);

  const startMatch = useCallback((config: MatchConfig) => {
    const species = buildSpeciesMapForLevel(config.speciesIds, config.level);
    const seed = Math.floor(Math.random() * 0xffffffff);
    const engine = new SimulationEngine(config, species, moveLookup, seed);
    setStore(createSimStore(engine));
  }, []);

  const backToSetup = useCallback(() => setStore(null), []);

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {store ? <MatchScreen store={store} onExit={backToSetup} /> : <SetupScreen onStart={startMatch} />}
    </div>
  );
}
