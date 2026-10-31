import type { CrowdCardId } from '../../net/play/playProtocol';
import { INK } from '../theme';

const PATHS: Record<CrowdCardId, string> = {
  speed: 'M13 2L4 14h7l-1 8 9-12h-7z',
  shield: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z',
  energy: 'M3 7h16v10H3zM21 10v4M7 10v4M11 10v4',
  supply: 'M12 5v14M5 12h14',
};

/** The card's pictogram: bolt, shield, battery, crate cross. */
export function CrowdCardIcon({ card, size = 20, color = INK }: { card: CrowdCardId; size?: number; color?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round">
      <path d={PATHS[card]} />
    </svg>
  );
}
