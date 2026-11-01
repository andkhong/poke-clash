import Phaser from 'phaser';
import { getPlayableBounds } from '../../sim/movement';
import type { ArenaBounds } from '../../sim/types';

// Play Mode's floor: a Pokémon-gym stadium drawn entirely with Graphics (no
// image to download). The court is the sim's playable area (getPlayableBounds,
// which clamps fighter centres) grown by roughly a body's radius, so the drawn
// boundary line is where fighters actually stop; everything outside it is
// barrier wall and crowd stands.

const COURT_MARGIN = 44;
const WALL = 18;
// Hoenn Handheld (src/ui/theme.ts): pale bag-screen stands, an ink wall that
// reads as the message boxes' outline with a teal FRAME stripe, clay court.
const COLORS = {
  stands: 0xbdcde6,
  standsRow: 0x9cb4de,
  wall: 0x29315a,
  wallStripe: 0x62a4de,
  court: 0xa4625a,
  courtGrain: 0x9c7373,
  line: 0xffffff,
  ballTop: 0xff625a,
  ballBottom: 0xffffff,
  ballBand: 0x29315a,
};
// Team Ruby/Sapphire, Emerald, badge gold and friends — saturated enough to pop on the pale stands.
const CROWD_COLORS = [0xc54141, 0x394a7b, 0x62acee, 0x398b31, 0xffc55a, 0xff625a, 0x83c562, 0x624152, 0xffffff, 0x29315a];

/** Each layer is a full-arena texture drawn every frame, so fewer is cheaper on a phone's GPU; two still ripple. */
const CROWD_LAYERS = 2;
const CROWD_IDLE_ALPHA = 0.45;

/** The stadium, plus the crowd that bobs along and jumps up on hits. */
export interface Stadium {
  /** 0..1: a glancing hit is a murmur, a KO is the whole stand on its feet. */
  cheer(amount: number): void;
  update(dtMs: number): void;
}

export function createStadiumBackground(scene: Phaser.Scene, arena: ArenaBounds): Stadium {
  const b = getPlayableBounds(arena);
  const court = new Phaser.Geom.Rectangle(Math.max(WALL, b.minX - COURT_MARGIN), Math.max(WALL, b.minY - COURT_MARGIN), 0, 0);
  court.width = Math.min(arena.width - WALL, b.maxX + COURT_MARGIN) - court.x;
  court.height = Math.min(arena.height - WALL, b.maxY + COURT_MARGIN) - court.y;
  const outer = new Phaser.Geom.Rectangle(court.x - WALL, court.y - WALL, court.width + WALL * 2, court.height + WALL * 2);
  // Fixed seed: every player in an online room sees the same crowd.
  const rng = new Phaser.Math.RandomDataGenerator(['poke-clash-stadium']);

  // Every layer is drawn once into a texture: a live Graphics re-tessellates
  // its thousands of crowd circles every frame, which stutters; a baked
  // texture costs one quad. The crowd is split across layers, each moved as
  // a whole, so the stands ripple instead of bouncing in lockstep. Only the
  // crowd moves, so everything static is folded into as few layers (and as
  // few pixels) as possible: the floodlights go into the seats below the
  // crowd and the court above it, and the court layer is only court-sized.
  const bake = (depth: number, area: Phaser.Geom.Rectangle, draws: ((g: Phaser.GameObjects.Graphics) => void)[]): void => {
    const texture = scene.add.renderTexture(area.x, area.y, area.width, area.height).setOrigin(0, 0).setDepth(depth);
    for (const [i, draw] of draws.entries()) {
      const g = scene.make.graphics({}, false);
      if (i > 0) g.setBlendMode(Phaser.BlendModes.ADD); // every draw after the first is lighting
      draw(g);
      texture.draw(g, -area.x, -area.y);
      g.destroy();
    }
  };
  const lights = (g: Phaser.GameObjects.Graphics) => drawFloodlights(g, arena);
  bake(-100, new Phaser.Geom.Rectangle(0, 0, arena.width, arena.height), [(g) => drawSeats(g, arena, court), lights]);
  const crowd = Array.from({ length: CROWD_LAYERS }, () => scene.make.graphics({}, false));
  drawCrowd(crowd, arena, outer, rng);
  const layers = crowd.map((g) => {
    const texture = scene.add
      .renderTexture(0, 0, arena.width, arena.height)
      .setOrigin(0, 0)
      .setDepth(-99)
      .draw(g)
      .setAlpha(CROWD_IDLE_ALPHA);
    g.destroy();
    return texture;
  });
  bake(-98, outer, [
    (g) => {
      drawWall(g, outer);
      drawCourt(g, court);
    },
    lights,
  ]);

  let excitement = 0;
  let clockS = 0;
  return {
    cheer(amount) {
      excitement = Math.min(1, excitement + amount);
    },
    update(dtMs) {
      clockS += dtMs / 1000;
      excitement = Math.max(0, excitement - (dtMs / 1000) * 0.7);
      layers.forEach((layer, i) => {
        const phase = i * 2.1;
        const idle = 1.5 * (0.5 + 0.5 * Math.sin(clockS * 2 + phase));
        const jump = excitement * 8 * Math.abs(Math.sin(clockS * 13 + phase));
        layer.y = -(idle + jump);
        layer.alpha = CROWD_IDLE_ALPHA + 0.45 * excitement;
      });
    },
  };
}

function drawSeats(g: Phaser.GameObjects.Graphics, arena: ArenaBounds, court: Phaser.Geom.Rectangle): void {
  g.fillStyle(COLORS.stands, 1).fillRect(0, 0, arena.width, arena.height);
  // Seat rows: concentric rings stepping out from the wall.
  const rowGap = 26;
  for (let inset = WALL + rowGap; inset < Math.max(arena.width, arena.height); inset += rowGap) {
    g.lineStyle(10, COLORS.standsRow, 1).strokeRect(court.x - inset, court.y - inset, court.width + inset * 2, court.height + inset * 2);
  }
}

/** A head on most seats outside the wall, dealt round-robin across the layers. */
function drawCrowd(
  layers: Phaser.GameObjects.Graphics[],
  arena: ArenaBounds,
  outer: Phaser.Geom.Rectangle,
  rng: Phaser.Math.RandomDataGenerator
): void {
  for (let y = 10; y < arena.height; y += 22) {
    for (let x = 8 + ((y / 22) % 2) * 9; x < arena.width; x += 18) {
      if (outer.contains(x, y) || rng.frac() < 0.25) continue;
      const g = layers[rng.between(0, layers.length - 1)];
      g.fillStyle(rng.pick(CROWD_COLORS), 1).fillCircle(x + rng.between(-3, 3), y + rng.between(-2, 2), rng.between(5, 7));
    }
  }
}

/** Barrier wall with a gym-red stripe. */
function drawWall(g: Phaser.GameObjects.Graphics, outer: Phaser.Geom.Rectangle): void {
  g.fillStyle(COLORS.wall, 1).fillRect(outer.x, outer.y, outer.width, outer.height);
  g.lineStyle(5, COLORS.wallStripe, 1).strokeRect(outer.x + WALL / 2, outer.y + WALL / 2, outer.width - WALL, outer.height - WALL);
}

function drawCourt(g: Phaser.GameObjects.Graphics, court: Phaser.Geom.Rectangle): void {
  g.fillStyle(COLORS.court, 1).fillRectShape(court);
  // Raked-clay grain along the long axis.
  const wide = court.width >= court.height;
  g.lineStyle(3, COLORS.courtGrain, 0.6);
  for (let i = 12; i < (wide ? court.height : court.width); i += 16) {
    if (wide) g.lineBetween(court.x, court.y + i, court.right, court.y + i);
    else g.lineBetween(court.x + i, court.y, court.x + i, court.bottom);
  }

  const cx = court.centerX;
  const cy = court.centerY;
  const inset = 14;
  g.lineStyle(6, COLORS.line, 0.9).strokeRect(court.x + inset, court.y + inset, court.width - inset * 2, court.height - inset * 2);
  if (wide) g.lineBetween(cx, court.y + inset, cx, court.bottom - inset);
  else g.lineBetween(court.x + inset, cy, court.right - inset, cy);
  const r = Math.min(court.width, court.height) * 0.16;
  g.strokeCircle(cx, cy, r + 26);

  // Poké Ball emblem at centre court, faded so fighters read on top of it.
  g.fillStyle(COLORS.ballBottom, 0.5).fillCircle(cx, cy, r);
  g.fillStyle(COLORS.ballTop, 0.5).slice(cx, cy, r, Math.PI, 0, false).fillPath();
  g.fillStyle(COLORS.ballBand, 0.5).fillRect(cx - r, cy - r * 0.08, r * 2, r * 0.16);
  g.fillStyle(COLORS.ballBand, 0.5).fillCircle(cx, cy, r * 0.3);
  g.fillStyle(COLORS.ballBottom, 0.6).fillCircle(cx, cy, r * 0.18);

  // Trainer boxes at each end.
  const box = Math.min(court.width, court.height) * 0.22;
  g.lineStyle(5, COLORS.line, 0.7);
  if (wide) {
    g.strokeRect(court.x + inset, cy - box / 2, box * 0.6, box);
    g.strokeRect(court.right - inset - box * 0.6, cy - box / 2, box * 0.6, box);
  } else {
    g.strokeRect(cx - box / 2, court.y + inset, box, box * 0.6);
    g.strokeRect(cx - box / 2, court.bottom - inset - box * 0.6, box, box * 0.6);
  }
}

/** Soft additive pools of light from the four corners. */
function drawFloodlights(g: Phaser.GameObjects.Graphics, arena: ArenaBounds): void {
  const radius = Math.max(arena.width, arena.height) * 0.45;
  for (const [x, y] of [
    [0, 0],
    [arena.width, 0],
    [0, arena.height],
    [arena.width, arena.height],
  ]) {
    for (let i = 4; i >= 1; i--) g.fillStyle(0xffd5b4, 0.025).fillCircle(x, y, (radius * i) / 4);
  }
}
