import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import sharp from 'sharp';
import type { PmdAnimEntry } from '../src/data/types';

// Shared by fetch-pmd-sprites.ts (normal) and fetch-pmd-shiny-sprites.ts
// (shiny) — both ultimately parse the same sprites.zip shape (AnimData.xml +
// per-action PNGs), just sourced from a different URL per species.

export const TICK_MS = 1000 / 60; // AnimData.xml <Duration> units are frames of 1/60th second

// v1 only wires up this subset of the ~35 possible PMD actions (see
// PokemonSprite.ts). Idle+Walk are the hard minimum for a species to count as
// "has PMD sprites" — raw zips stay cached indefinitely, so widening this list
// later needs zero re-downloads.
// Shoot/Shock/SpAttack are ranged-attack poses PokemonSprite.ts prefers over
// the generic melee-swing Attack frame for non-melee move families (see
// RANGED_ATTACK_ACTION_PRIORITY) — most species only have Shoot, a handful
// have a more specific Shock (e.g. Pikachu) or SpAttack (e.g. Arceus)
// instead/as well.
export const CORE_ACTIONS = ['Idle', 'Walk', 'Attack', 'Shoot', 'Shock', 'SpAttack', 'Hurt', 'Sleep', 'Faint'] as const;
export const REQUIRED_ACTIONS: readonly string[] = ['Idle', 'Walk'];

interface ParsedAnim {
  frameWidth: number;
  frameHeight: number;
  durationsTicks: number[];
  /** AnimData.xml can define an action as an alias of another
   * (`<CopyOf>Walk</CopyOf>`, e.g. Beedrill's Idle): it then has no sheet
   * or metadata of its own and reuses the named one's. */
  copyOf?: string;
}

/** How many aliases to follow before giving up (guards a malformed cycle). */
const MAX_COPY_OF_HOPS = 5;

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  isArray: (name) => name === 'Anim' || name === 'Duration',
});

// A real 404 means "no sprite at this URL" and must not retry or abort a
// batch; transient errors get a few attempts with backoff (mirrors
// data-pipeline/pokeapi.ts's fetchWithRetry, which isn't exported).
export async function fetchZipWithRetry(url: string, attempts = 3): Promise<Buffer | 'unavailable'> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return 'unavailable';
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      lastError = new Error(`HTTP ${res.status} for ${url}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  throw lastError;
}

function parseAnimData(xml: string): Map<string, ParsedAnim> {
  const parsed = xmlParser.parse(xml) as {
    AnimData?: {
      Anims?: {
        Anim?: { Name: string; FrameWidth?: number; FrameHeight?: number; CopyOf?: string; Durations?: { Duration?: number[] } }[];
      };
    };
  };
  const anims = parsed.AnimData?.Anims?.Anim ?? [];
  const map = new Map<string, ParsedAnim>();
  for (const anim of anims) {
    map.set(String(anim.Name), {
      frameWidth: Number(anim.FrameWidth ?? 0),
      frameHeight: Number(anim.FrameHeight ?? 0),
      durationsTicks: (anim.Durations?.Duration ?? []).map(Number),
      copyOf: anim.CopyOf ? String(anim.CopyOf) : undefined,
    });
  }
  return map;
}

/** Follows CopyOf aliases to the action whose sheet and metadata actually
 * exist. Returns that action's name and metadata, or null for a missing
 * action or a broken alias chain. */
function resolveAnim(animMap: Map<string, ParsedAnim>, action: string): { source: string; anim: ParsedAnim } | null {
  let source = action;
  let anim = animMap.get(source);
  for (let hop = 0; anim?.copyOf && hop < MAX_COPY_OF_HOPS; hop++) {
    source = anim.copyOf;
    anim = animMap.get(source);
  }
  return anim && !anim.copyOf ? { source, anim } : null;
}

function extractZip(buffer: Buffer): { animDataXml: string; getPng: (name: string) => Buffer | undefined } {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const animDataEntry = entries.find((e) => e.entryName === 'AnimData.xml');
  if (!animDataEntry) throw new Error('AnimData.xml missing from sprites.zip');
  const pngByName = new Map<string, Buffer>();
  for (const entry of entries) {
    if (entry.entryName.endsWith('.png')) pngByName.set(entry.entryName, entry.getData());
  }
  return {
    animDataXml: animDataEntry.getData().toString('utf-8'),
    getPng: (name) => pngByName.get(name),
  };
}

export interface ExtractedActions {
  actions: Record<string, PmdAnimEntry>;
  pngsToWrite: Record<string, Buffer>;
}

/** Parses a sprites.zip buffer into CORE_ACTIONS metadata + the PNGs to
 * persist. Returns null if the required actions (Idle+Walk) aren't both
 * present with valid image data. */
export async function extractCoreActions(zipBuffer: Buffer): Promise<ExtractedActions | null> {
  const extracted = extractZip(zipBuffer);
  const animMap = parseAnimData(extracted.animDataXml);
  const { getPng } = extracted;

  const actions: Record<string, PmdAnimEntry> = {};
  const pngsToWrite: Record<string, Buffer> = {};

  for (const action of CORE_ACTIONS) {
    // An aliased action (Idle = CopyOf Walk) is stored under its own name
    // so the client, which asks for <action>-Anim.png, needs no alias table.
    const resolved = resolveAnim(animMap, action);
    const anim = resolved?.anim;
    const animPng = resolved && getPng(`${resolved.source}-Anim.png`);
    if (!anim || !animPng) continue;

    let width: number | undefined;
    let height: number | undefined;
    try {
      ({ width, height } = await sharp(animPng).metadata());
    } catch {
      continue;
    }
    if (!width || !height) continue;

    const frameWidth = anim.frameWidth || width;
    const frameHeight = anim.frameHeight || height;
    const rows = Math.max(1, Math.round(height / frameHeight));
    const directions: 1 | 8 = rows >= 8 ? 8 : 1;
    const durationsTicks =
      anim.durationsTicks.length > 0
        ? anim.durationsTicks
        : Array.from({ length: Math.max(1, Math.round(width / frameWidth)) }, () => 1);

    const shadowPng = getPng(`${resolved.source}-Shadow.png`);

    actions[action] = {
      frameWidth,
      frameHeight,
      directions,
      durationsMs: durationsTicks.map((t) => Math.round(t * TICK_MS)),
      hasShadow: shadowPng !== undefined,
    };
    pngsToWrite[`${action}-Anim.png`] = animPng;
    if (shadowPng) pngsToWrite[`${action}-Shadow.png`] = shadowPng;
  }

  if (!REQUIRED_ACTIONS.every((a) => actions[a])) return null;
  return { actions, pngsToWrite };
}
