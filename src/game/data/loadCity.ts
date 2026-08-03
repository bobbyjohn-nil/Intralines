import type { CityMeta, CityPack } from '../types';
import { idbGetPack, idbPutPack } from './idb';
import {
  buildBlockGroups, buildRoadGraph, overpassQuery, parseAcs, parseWac,
} from './pipeline';

export type ProgressFn = (msg: string, detail?: string) => void;

const ACS_YEAR = 2022;
const LODES_YEARS = [2021, 2020, 2019];
const TIGERWEB =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer';
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/**
 * Load a city pack, in order of preference:
 *  1. baked file shipped with the app (public/cities/<id>.json, via `npm run bake`)
 *  2. IndexedDB cache from a previous browser download
 *  3. live download in the browser: TIGERweb block groups + ACS population +
 *     LODES jobs + OpenStreetMap roads (cached to IndexedDB afterwards)
 */
export async function loadCity(meta: CityMeta, progress: ProgressFn): Promise<CityPack> {
  progress(`Loading ${meta.name}…`, 'checking for bundled data');
  const baked = await tryBaked(meta.id);
  if (baked) return baked;

  if (meta.kind === 'demo') throw new Error('Demo city pack missing from build.');

  const cached = await idbGetPack<CityPack>(meta.id);
  if (cached) {
    progress(`Loading ${meta.name}…`, 'found cached download');
    return cached;
  }

  // ---- live browser download -------------------------------------------
  progress(`Downloading ${meta.name}…`, 'census block groups (TIGERweb)');
  const features = await fetchBlockGroupGeometries(meta);

  progress(`Downloading ${meta.name}…`, 'population (American Community Survey)');
  const popByBg = await fetchAcsPopulation(meta);

  progress(`Downloading ${meta.name}…`, 'workplaces (LEHD LODES)');
  let jobsByBg: Map<string, number> | null = null;
  let jobsNote = 'US Census ACS + LEHD LODES + OpenStreetMap';
  try {
    jobsByBg = await fetchLodesJobs(meta);
  } catch {
    jobsNote = 'US Census ACS + OpenStreetMap (job locations estimated — LODES unavailable in browser)';
  }

  progress(`Downloading ${meta.name}…`, 'street network (OpenStreetMap) — the big one, ~10-40 MB');
  const overpass = await fetchRoads(meta);

  progress(`Building ${meta.name}…`, 'assembling city pack');
  const blockGroups = buildBlockGroups(features, popByBg, jobsByBg, meta.bbox, meta.center);
  const graph = buildRoadGraph(overpass, meta.bbox);
  if (blockGroups.length < 10) throw new Error('Too few census block groups — data fetch failed.');
  if (graph.nodes.length < 100) throw new Error('Street network fetch failed.');

  const pack: CityPack = {
    meta: { ...meta, dataSource: jobsNote },
    blockGroups,
    nodes: graph.nodes,
    edges: graph.edges,
  };
  progress(`Saving ${meta.name}…`, 'caching locally so this is a one-time download');
  await idbPutPack(meta.id, pack);
  return pack;
}

async function tryBaked(id: string): Promise<CityPack | null> {
  try {
    const res = await fetch(`./cities/${id}.json`, { cache: 'force-cache' });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('json')) return null;
    return (await res.json()) as CityPack;
  } catch {
    return null;
  }
}

// --- TIGERweb ---------------------------------------------------------------

let bgLayerId: number | null = null;

async function blockGroupLayerId(): Promise<number> {
  if (bgLayerId !== null) return bgLayerId;
  const res = await fetch(`${TIGERWEB}?f=json`);
  if (!res.ok) throw new Error('TIGERweb unavailable');
  const info = (await res.json()) as { layers: { id: number; name: string }[] };
  const layer =
    info.layers.find((l) => /block groups/i.test(l.name)) ??
    info.layers.find((l) => /block group/i.test(l.name));
  if (!layer) throw new Error('TIGERweb block group layer not found');
  bgLayerId = layer.id;
  return layer.id;
}

async function fetchBlockGroupGeometries(meta: CityMeta): Promise<GeoJSON.Feature[]> {
  const layerId = await blockGroupLayerId();
  const features: GeoJSON.Feature[] = [];
  for (const c of meta.counties ?? []) {
    let offset = 0;
    for (;;) {
      const params = new URLSearchParams({
        where: `STATE='${c.state}' AND COUNTY='${c.county}'`,
        outFields: 'GEOID,AREALAND',
        f: 'geojson',
        outSR: '4326',
        geometryPrecision: '5',
        resultRecordCount: '1000',
        resultOffset: String(offset),
      });
      const res = await fetch(`${TIGERWEB}/${layerId}/query?${params}`);
      if (!res.ok) throw new Error(`TIGERweb query failed (${res.status})`);
      const gj = (await res.json()) as GeoJSON.FeatureCollection & {
        properties?: { exceededTransferLimit?: boolean };
        exceededTransferLimit?: boolean;
      };
      const batch = gj.features ?? [];
      features.push(...batch);
      if (batch.length < 1000) break;
      offset += batch.length;
      if (offset > 20000) break; // safety
    }
  }
  return features;
}

// --- ACS ---------------------------------------------------------------------

async function fetchAcsPopulation(meta: CityMeta): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const c of meta.counties ?? []) {
    const url =
      `https://api.census.gov/data/${ACS_YEAR}/acs/acs5` +
      `?get=B01003_001E&for=block%20group:*` +
      `&in=state:${c.state}%20county:${c.county}%20tract:*`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Census API failed (${res.status})`);
    const rows = (await res.json()) as string[][];
    for (const [geoid, pop] of parseAcs(rows)) out.set(geoid, pop);
  }
  return out;
}

// --- LODES --------------------------------------------------------------------

async function fetchLodesJobs(meta: CityMeta): Promise<Map<string, number>> {
  if (!meta.lodesState) throw new Error('no LODES state');
  let lastErr: unknown = null;
  for (const year of LODES_YEARS) {
    const url = `https://lehd.ces.census.gov/data/lodes/LODES8/${meta.lodesState}/wac/${meta.lodesState}_wac_S000_JT00_${year}.csv.gz`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`LODES ${year}: ${res.status}`);
      let text: string;
      if (typeof DecompressionStream !== 'undefined' && res.body) {
        const ds = new DecompressionStream('gzip');
        text = await new Response(res.body.pipeThrough(ds)).text();
      } else {
        throw new Error('DecompressionStream unsupported');
      }
      return parseWac(text);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('LODES unavailable');
}

// --- Overpass -------------------------------------------------------------------

interface OverpassJson {
  elements: unknown[];
}

async function fetchRoads(meta: CityMeta): Promise<OverpassJson> {
  const q = overpassQuery(meta.bbox);
  let lastErr: unknown = null;
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(q)}`,
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      return (await res.json()) as OverpassJson;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('Overpass unavailable');
}
