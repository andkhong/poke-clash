import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const BASE_URL = 'https://pokeapi.co/api/v2';
const CACHE_ROOT = new URL('./cache/', import.meta.url).pathname;

// PokeAPI's fair-use policy asks callers to cache rather than repeatedly hit the
// live API. Every GET here is cached to disk indefinitely (the data is static
// game data — a Pokémon's base stats don't change) and resumable: re-running the
// pipeline after a partial failure just skips whatever's already on disk.
async function readCache<T>(cachePath: string): Promise<T | null> {
  try {
    const raw = await readFile(cachePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeCache(cachePath: string, data: unknown): Promise<void> {
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(data), 'utf-8');
}

let inFlight = 0;
const MAX_CONCURRENT = 6;
const queue: (() => void)[] = [];

async function acquireSlot(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => queue.push(resolve));
  inFlight += 1;
}

function releaseSlot(): void {
  inFlight -= 1;
  const next = queue.shift();
  if (next) next();
}

async function fetchWithRetry(url: string, attempts = 4): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      if (res.status === 404) return res; // don't retry a real 404
      lastError = new Error(`HTTP ${res.status} for ${url}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 300 * (i + 1)));
  }
  throw lastError;
}

/** Cached JSON GET against a PokeAPI resource path, e.g. "pokemon/25" or "move/85". */
export async function getPokeApi<T>(resourcePath: string): Promise<T> {
  const cachePath = `${CACHE_ROOT}${resourcePath}.json`;
  const cached = await readCache<T>(cachePath);
  if (cached) return cached;

  await acquireSlot();
  try {
    const res = await fetchWithRetry(`${BASE_URL}/${resourcePath}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${resourcePath}`);
    const data = (await res.json()) as T;
    await writeCache(cachePath, data);
    return data;
  } finally {
    releaseSlot();
  }
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
  concurrency: number = MAX_CONCURRENT
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let done = 0;

  async function runOne(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await worker(items[i], i);
      done += 1;
      onProgress?.(done, items.length);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, runOne);
  await Promise.all(workers);
  return results;
}
