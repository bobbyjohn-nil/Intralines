// Where the measured traffic counts come from.
//
// AADT (annual average daily traffic) is published by highway agencies as
// static open data — no key, no live feed, no per-request quota. It is fetched
// once while a city is being built and baked into the pack, so from then on
// the counts are simply part of the city and work with the network unplugged.
//
// Coverage is uneven by nature: agencies count highways and arterials, and
// state-by-state publishing is inconsistent. Every failure here is survivable
// — the city falls back to the modeled congestion estimate the game has always
// used — so this never blocks a download or breaks a bake.

import { aadtQueryUrl, buildTrafficGrid, parseAadt } from './pipeline.js';
import type { CityMeta, TrafficGrid } from '../types';

export { AADT_SOURCES } from './aadt.sources.mjs';
import { AADT_SOURCES } from './aadt.sources.mjs';

const TIMEOUT_MS = 20_000;

async function tryFetchJson(url: string): Promise<unknown | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null; // offline, blocked, moved, rate-limited — all the same to us
  }
}

/**
 * Measured traffic for a city, or null when nobody publishes counts for it.
 * Never throws: a city without counts is a city with modeled congestion.
 */
export async function fetchTrafficGrid(
  meta: CityMeta,
  note?: (msg: string) => void,
): Promise<TrafficGrid | null> {
  for (const src of AADT_SOURCES) {
    note?.(`traffic counts from ${src.name}`);
    const json = await tryFetchJson(aadtQueryUrl(src.url, meta.bbox, src.field));
    if (!json) continue;
    const samples = parseAadt(json, src.field);
    if (samples.length < 5) continue; // a handful of points is not a city
    const grid = buildTrafficGrid(samples, meta.bbox);
    if (grid) return grid;
  }
  return null;
}
