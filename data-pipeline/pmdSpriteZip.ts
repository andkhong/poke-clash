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
export const CORE_ACTIONS = ['Idle', 'Walk', 'Attack', 'Hurt', 'Sleep', 'Faint'] as const;
export const REQUIRED_ACTIONS: readonly string[] = ['Idle', 'Walk'];

interface ParsedAnim {
  frameWidth: number;
  frameHeight: number;
  durationsTicks: number[];
}

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
    AnimData?: { Anims?: { Anim?: { Name: string; FrameWidth: number; FrameHeight: number; Durations?: { Duration?: number[] } }[] } };
  };
  const anims = parsed.AnimData?.Anims?.Anim ?? [];
  const map = new Map<string, ParsedAnim>();
  for (const anim of anims) {
    map.set(anim.Name, {
      frameWidth: Number(anim.FrameWidth),
      frameHeight: Number(anim.FrameHeight),
      durationsTicks: (anim.Durations?.Duration ?? []).map(Number),
    });
  }
  return map;
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
    const anim = animMap.get(action);
    const animPng = anim && getPng(`${action}-Anim.png`);
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

    const shadowPng = getPng(`${action}-Shadow.png`);

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
