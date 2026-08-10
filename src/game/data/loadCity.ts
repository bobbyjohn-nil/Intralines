import type { CityMeta, CityPack, Poi } from '../types';
import { idbGetPack, idbPutPack } from './idb';
import { fetchTrafficGrid } from './aadt';
import {
  applyPoiDemand, buildBlockGroups, buildRoadGraph, overpassIndustrialQuery,
  overpassPoiQuery, overpassQuery, parseIndustrial,
  overpassScenicQuery, parseAcs, parsePois, parseRac, parseScenic, parseWac,
} from './pipeline';
import { generateBuildings } from './proceduralBuildings';

export type ProgressFn = (msg: string, detail?: string) => void;

const ACS_YEARS = [2023, 2022, 2021];
const LODES_YEARS = [2022, 2021, 2020];
const TIGERWEB =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer';
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

class StageError extends Error {
  constructor(stage: string, cause: unknown) {
    super(`${stage}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/**
 * Load a city pack, in order of preference:
 *  1. baked file shipped with the app (public/cities/<id>.json[.gz], via `npm run bake`)
 *  2. IndexedDB cache from a previous browser download
 *  3. live download in the browser (cached to IndexedDB afterwards — playing is
 *     fully offline from then on)
 */
export async function loadCity(meta: CityMeta, progress: ProgressFn): Promise<CityPack> {
  progress(`Loading ${meta.name}…`, 'checking for bundled data');
  const baked = await tryBaked(meta.id);
  if (baked) return finalize(baked);

  if (meta.kind === 'demo') throw new Error('Demo city pack missing from build.');

  const cached = await idbGetPack<CityPack>(meta.id);
  if (cached) {
    progress(`Loading ${meta.name}…`, 'found cached download — playing offline');
    return finalize(cached);
  }

  // ---- live browser download -------------------------------------------
  progress(`Downloading ${meta.name}…`, 'census block group boundaries (TIGERweb)');
  const features = await stage('Census boundaries (TIGERweb)', () =>
    fetchBlockGroupGeometries(meta),
  );

  progress(`Downloading ${meta.name}…`, 'population (American Community Survey)');
  let popByBg: Map<string, number>;
  let popSource = 'ACS';
  try {
    popByBg = await fetchAcsPopulation(meta);
  } catch {
    // the Census API rate-limits anonymous callers; LEHD's file server doesn't
    progress(`Downloading ${meta.name}…`, 'population (LODES residents — ACS was busy)');
    popByBg = await stage('Census population (LODES RAC)', () => fetchRacPopulation(meta));
    popSource = 'LODES residents';
  }

  progress(`Downloading ${meta.name}…`, 'workplaces (LEHD LODES)');
  let wac: ReturnType<typeof parseWac> | null = null;
  let jobsNote = `US Census (${popSource}) + LEHD LODES + OpenStreetMap`;
  try {
    wac = await fetchLodesJobs(meta);
  } catch {
    jobsNote = `US Census (${popSource}) + OpenStreetMap (job locations estimated — LODES unavailable in browser)`;
  }

  progress(
    `Downloading ${meta.name}…`,
    'street network (OpenStreetMap) — the big one, ~10-40 MB',
  );
  const overpass = await stage('OpenStreetMap streets (Overpass)', () => fetchRoads(meta));

  progress(`Downloading ${meta.name}…`, 'lakes, rivers and parks (OpenStreetMap)');
  let scenic: { water: [number, number][][]; parks: [number, number][][] } = {
    water: [],
    parks: [],
  };
  try {
    scenic = parseScenic(await fetchOverpass(overpassScenicQuery(meta.bbox)));
  } catch {
    // cosmetic only — the game works without water/park polygons
  }

  progress(`Downloading ${meta.name}…`, 'airports and rail stations (OpenStreetMap)');
  let pois: Poi[] = [];
  try {
    pois = parsePois(await fetchOverpass(overpassPoiQuery(meta.bbox)));
  } catch {
    // optional flavor demand — the game works without it
  }

  let industrial: [number, number][][] = [];
  try {
    industrial = parseIndustrial(await fetchOverpass(overpassIndustrialQuery(meta.bbox)));
  } catch {
    // no land-use data: depot zoning falls back to the census heuristic
  }

  // measured traffic counts, baked in now so congestion works offline later
  let traffic = null as Awaited<ReturnType<typeof fetchTrafficGrid>>;
  try {
    traffic = await fetchTrafficGrid(meta, (d) =>
      progress(`Measuring ${meta.name}'s traffic…`, d),
    );
  } catch {
    // counts are a bonus, never a blocker
  }

  progress(`Building ${meta.name}…`, 'assembling city pack');
  const blockGroups = buildBlockGroups(
    features, popByBg, wac ? wac.jobs : null, meta.bbox, meta.center,
    wac ? { edu: wac.edu, tour: wac.tour } : undefined,
  );
  applyPoiDemand(blockGroups, pois);
  const graph = buildRoadGraph(overpass, meta.bbox);
  if (blockGroups.length < 10) {
    throw new Error('Census data came back empty — try again, or use npm run bake.');
  }
  if (graph.nodes.length < 100) {
    throw new Error('Street network came back empty — try again, or use npm run bake.');
  }

  const pack: CityPack = {
    meta: { ...meta, dataSource: jobsNote },
    blockGroups,
    nodes: graph.nodes,
    edges: graph.edges,
    water: scenic.water,
    parks: scenic.parks,
    pois,
    traffic: traffic ?? undefined,
    industrial: industrial.length ? industrial : undefined,
  };
  progress(`Saving ${meta.name}…`, 'caching locally — future launches are offline');
  await idbPutPack(meta.id, pack);
  return finalize(pack);
}

/** every pack leaves here able to render offline (buildings included) */
function finalize(pack: CityPack): CityPack {
  if (!pack.buildings || pack.buildings.length === 0) {
    pack.buildings = generateBuildings(pack);
  }
  return pack;
}

async function stage<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw new StageError(label, e);
  }
}

const GZ_MAGIC = [0x1f, 0x8b];

async function tryBaked(id: string): Promise<CityPack | null> {
  // gzipped pack first (what `npm run bake` produces), then plain json.
  // 'no-cache' revalidates with the server so a stale 404 cached from before
  // the packs were deployed can't hide them forever.
  try {
    const res = await fetch(`./cities/${id}.json.gz`, { cache: 'no-cache' });
    if (res.ok) {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf[0] === GZ_MAGIC[0] && buf[1] === GZ_MAGIC[1]) {
        const ds = new DecompressionStream('gzip');
        const text = await new Response(new Blob([buf]).stream().pipeThrough(ds)).text();
        return JSON.parse(text) as CityPack;
      }
      // some servers set Content-Encoding: gzip on .gz files, so the browser
      // already decompressed the body for us
      const text = new TextDecoder().decode(buf);
      if (text.trimStart().startsWith('{')) return JSON.parse(text) as CityPack;
    }
  } catch {
    // fall through
  }
  try {
    const res = await fetch(`./cities/${id}.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trimStart().startsWith('{')) return null; // SPA index.html fallback
    return JSON.parse(text) as CityPack;
  } catch {
    return null;
  }
}

// --- TIGERweb ---------------------------------------------------------------

interface EsriJson {
  error?: { message?: string };
  exceededTransferLimit?: boolean;
  features?: {
    attributes?: Record<string, unknown>;
    geometry?: { rings?: number[][][] };
  }[];
}

let bgLayerId: number | null = null;

async function blockGroupLayerId(): Promise<number> {
  if (bgLayerId !== null) return bgLayerId;
  const res = await fetch(`${TIGERWEB}?f=json`);
  if (!res.ok) throw new Error(`TIGERweb unreachable (${res.status})`);
  const info = (await res.json()) as { layers?: { id: number; name: string }[] };
  const layer = (info.layers ?? []).find((l) => /block group/i.test(l.name));
  if (!layer) throw new Error('TIGERweb block group layer not found');
  bgLayerId = layer.id;
  return layer.id;
}

function esriToGeoJson(json: EsriJson): GeoJSON.Feature[] {
  return (json.features ?? [])
    .filter((f) => f.geometry?.rings?.length)
    .map((f) => ({
      type: 'Feature' as const,
      properties: (f.attributes ?? {}) as GeoJSON.GeoJsonProperties,
      geometry: {
        type: 'Polygon' as const,
        coordinates: f.geometry!.rings as unknown as GeoJSON.Position[][],
      },
    }));
}

/**
 * ArcGIS servers vary: some reject pagination, some reject f=geojson, and
 * errors come back as HTTP 200 with an {error} body. Try progressively
 * simpler request shapes, then OBJECTID-windowed paging as a last resort.
 */
async function queryCounty(
  layerId: number,
  state: string,
  county: string,
): Promise<GeoJSON.Feature[]> {
  const where = `STATE='${state}' AND COUNTY='${county}'`;
  const base = {
    where,
    outFields: 'GEOID,AREALAND,OBJECTID',
    outSR: '4326',
    geometryPrecision: '5',
  };
  const call = async (params: Record<string, string>): Promise<unknown> => {
    const res = await fetch(`${TIGERWEB}/${layerId}/query?${new URLSearchParams(params)}`);
    if (!res.ok) throw new Error(`TIGERweb ${res.status}`);
    return res.json();
  };

  // attempt 1: geojson with offset pagination
  try {
    const out: GeoJSON.Feature[] = [];
    let offset = 0;
    for (;;) {
      const gj = (await call({
        ...base,
        f: 'geojson',
        resultRecordCount: '1000',
        resultOffset: String(offset),
      })) as GeoJSON.FeatureCollection & { error?: unknown };
      if (gj.error || !Array.isArray(gj.features)) throw new Error('pagination unsupported');
      out.push(...gj.features);
      if (gj.features.length < 1000 || offset > 20000) return out;
      offset += gj.features.length;
    }
  } catch {
    // fall through
  }

  // attempt 2: plain geojson, no pagination
  try {
    const gj = (await call({ ...base, f: 'geojson' })) as GeoJSON.FeatureCollection & {
      error?: unknown;
    };
    if (!gj.error && Array.isArray(gj.features) && gj.features.length) return gj.features;
  } catch {
    // fall through
  }

  // attempt 3: esri json, OBJECTID-windowed so huge counties still complete
  const out: GeoJSON.Feature[] = [];
  let lastOid = 0;
  for (let i = 0; i < 40; i++) {
    const json = (await call({
      ...base,
      where: `${where} AND OBJECTID>${lastOid}`,
      f: 'json',
    })) as EsriJson;
    if (json.error) throw new Error(json.error.message ?? 'TIGERweb query error');
    const batch = esriToGeoJson(json);
    if (!batch.length) break;
    out.push(...batch);
    const oids = batch.map((f) => Number(f.properties?.OBJECTID ?? 0));
    const maxOid = Math.max(...oids);
    if (!isFinite(maxOid) || maxOid <= lastOid) break;
    lastOid = maxOid;
    if (!json.exceededTransferLimit && batch.length < 1000) break;
  }
  if (!out.length) throw new Error('no boundaries returned');
  return out;
}

async function fetchBlockGroupGeometries(meta: CityMeta): Promise<GeoJSON.Feature[]> {
  const layerId = await blockGroupLayerId();
  const features: GeoJSON.Feature[] = [];
  for (const c of meta.counties ?? []) {
    features.push(...(await queryCounty(layerId, c.state, c.county)));
  }
  return features;
}

// --- ACS ---------------------------------------------------------------------

async function fetchAcsPopulation(meta: CityMeta): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const c of meta.counties ?? []) {
    let ok = false;
    let lastErr: unknown = null;
    for (const year of ACS_YEARS) {
      // the API has accepted a few different `in` spellings over the years —
      // try them all before giving up
      const variants = [
        `in=state:${c.state}%20county:${c.county}%20tract:*`,
        `in=state:${c.state}%20county:${c.county}&in=tract:*`,
        `in=state:${c.state}%20county:${c.county}`,
      ];
      for (const inClause of variants) {
        const url =
          `https://api.census.gov/data/${year}/acs/acs5` +
          `?get=B01003_001E&for=block%20group:*&${inClause}`;
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`ACS ${year}: ${res.status}`);
          const rows = (await res.json()) as string[][];
          if (!Array.isArray(rows) || rows.length < 2) throw new Error('empty ACS response');
          for (const [geoid, pop] of parseAcs(rows)) out.set(geoid, pop);
          ok = true;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (ok) break;
    }
    if (!ok) throw lastErr ?? new Error('ACS unavailable');
  }
  return out;
}

// --- LODES --------------------------------------------------------------------

async function fetchLodesCsv(meta: CityMeta, kind: 'wac' | 'rac'): Promise<string> {
  if (!meta.lodesState) throw new Error('no LODES state');
  let lastErr: unknown = null;
  for (const year of LODES_YEARS) {
    const url = `https://lehd.ces.census.gov/data/lodes/LODES8/${meta.lodesState}/${kind}/${meta.lodesState}_${kind}_S000_JT00_${year}.csv.gz`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`LODES ${kind} ${year}: ${res.status}`);
      if (typeof DecompressionStream === 'undefined' || !res.body) {
        throw new Error('DecompressionStream unsupported');
      }
      const ds = new DecompressionStream('gzip');
      return await new Response(res.body.pipeThrough(ds)).text();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('LODES unavailable');
}

async function fetchLodesJobs(meta: CityMeta): Promise<ReturnType<typeof parseWac>> {
  return parseWac(await fetchLodesCsv(meta, 'wac'));
}

/** employed residents scaled to approximate total population */
async function fetchRacPopulation(meta: CityMeta): Promise<Map<string, number>> {
  const workers = parseRac(await fetchLodesCsv(meta, 'rac'));
  const out = new Map<string, number>();
  for (const [bg, w] of workers) {
    out.set(bg, Math.round(w / meta.calib.workforceRate));
  }
  return out;
}

// --- Overpass -------------------------------------------------------------------

interface OverpassJson {
  elements: unknown[];
}

async function fetchOverpass(query: string): Promise<OverpassJson> {
  let lastErr: unknown = null;
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = (await res.json()) as OverpassJson;
      if (!Array.isArray(json.elements)) throw new Error('bad Overpass response');
      return json;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('Overpass unavailable');
}

async function fetchRoads(meta: CityMeta): Promise<OverpassJson> {
  return fetchOverpass(overpassQuery(meta.bbox));
}
