import { useCallback, useState } from 'react';
import { SetupScreen } from './ui/screens/SetupScreen';
import { CustomBattleScreen } from './ui/screens/CustomBattleScreen';
import { BossModeScreen } from './ui/screens/BossModeScreen';
import { TeamModeScreen } from './ui/screens/TeamModeScreen';
import { MatchScreen } from './ui/screens/MatchScreen';
import type { MatchConfig } from './sim/types';
import { SimulationEngine } from './sim/engine';
import { buildSpeciesMapForLevel, moveLookup } from './data/loader';
import { createSimStore, type SimStore } from './ui/state/simStore';

type PreMatchScreen = 'setup' | 'custom' | 'boss' | 'team';

export function App() {
  const [preMatchScreen, setPreMatchScreen] = useState<PreMatchScreen>('setup');
  const [store, setStore] = useState<SimStore | null>(null);

  const startMatch = useCallback((config: MatchConfig) => {
    // Boss Mode's boss species lives outside speciesIds (see MatchConfig.boss),
    // so it needs to be requested here too or matchSetup.ts's createMatch
    // throws "Unknown species id" building the boss's instance.
    const allSpeciesIds = config.boss ? [...config.speciesIds, config.boss.speciesId] : config.speciesIds;
    const species = buildSpeciesMapForLevel(allSpeciesIds, config.level);
    const seed = Math.floor(Math.random() * 0xffffffff);
    const engine = new SimulationEngine(config, species, moveLookup, seed);
    setStore(createSimStore(engine));
  }, []);

  const backToSetup = useCallback(() => {
    setStore(null);
    setPreMatchScreen('setup');
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {store ? (
        <MatchScreen store={store} onExit={backToSetup} />
      ) : preMatchScreen === 'custom' ? (
        <CustomBattleScreen onStart={startMatch} onBack={() => setPreMatchScreen('setup')} />
      ) : preMatchScreen === 'boss' ? (
        <BossModeScreen onStart={startMatch} onBack={() => setPreMatchScreen('setup')} />
      ) : preMatchScreen === 'team' ? (
        <TeamModeScreen onStart={startMatch} onBack={() => setPreMatchScreen('setup')} />
      ) : (
        <SetupScreen
          onStart={startMatch}
          onOpenCustomBattle={() => setPreMatchScreen('custom')}
          onOpenBossMode={() => setPreMatchScreen('boss')}
          onOpenTeamMode={() => setPreMatchScreen('team')}
        />
      )}
    </div>
  );
}
