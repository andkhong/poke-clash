// Team Mode's two side colors, shared by every place that needs to render
// which side a Pokémon is on: the setup screen's team columns, the roster
// HUD, and the in-arena sprite's team ring (PokemonSprite.ts). Kept as one
// module (rather than each spot picking its own colors) so the setup screen
// and the arena always agree on which color is which side.
export const TEAM_A_COLOR_CSS = '#4a9de0';
export const TEAM_B_COLOR_CSS = '#e0554a';
export const TEAM_A_COLOR_HEX = 0x4a9de0;
export const TEAM_B_COLOR_HEX = 0xe0554a;

export function teamColorCss(team: string | undefined): string | undefined {
  if (team === 'teamA') return TEAM_A_COLOR_CSS;
  if (team === 'teamB') return TEAM_B_COLOR_CSS;
  return undefined;
}

export function teamColorHex(team: string | undefined): number | undefined {
  if (team === 'teamA') return TEAM_A_COLOR_HEX;
  if (team === 'teamB') return TEAM_B_COLOR_HEX;
  return undefined;
}
