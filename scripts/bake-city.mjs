// Bake a real city's data into public/cities/<id>.json so players skip the
// in-browser download. Run on a machine with open internet access:
//
//   npm run bake -- worcester
//   npm run bake -- desmoines madison
//   npm run bake -- all
//
// Sources: Census TIGERweb (block group geometry), ACS 5-year (population),
// LEHD LODES WAC (jobs), OpenStreetMap via Overpass (streets).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import {
  buildBlockGroups, buildRoadGraph, overpassQuery, parseAcs, parseWac,
} from '../src/game/data/pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Keep in sync with src/game/data/cities.ts
const CITIES = {
  worcester: {
    id: 'worcester',
    name: 'Worcester',
    region: 'Massachusetts · pop ≈ 206k',
    kind: 'real',
    center: [-71.8023, 42.2626],
    zoom: 12.6,
    bbox: [-71.9, 42.2, -71.7, 42.36],
    counties: [{ state: '25', county: '027' }],
    lodesState: 'ma',
    calib: { workforceRate: 0.46, gravityBetaKm: 4.5, carSpeedKmh: 37 },
  },
  desmoines: {
    id: 'desmoines',
    name: 'Des Moines',
    region: 'Iowa · pop ≈ 214k',
    kind: 'real',
    center: [-93.6091, 41.5868],
    zoom: 12.4,
    bbox: [-93.82, 41.5, -93.5, 41.68],
    counties: [
      { state: '19', county: '153' },
      { state: '19', county: '049' },
      { state: '19', county: '181' },
    ],
    lodesState: 'ia',
    calib: { workforceRate: 0.5, gravityBetaKm: 5.0, carSpeedKmh: 40 },
  },
  madison: {
    id: 'madison',
    name: 'Madison',
    region: 'Wisconsin · pop ≈ 272k',
    kind: 'real',
    center: [-89.4012, 43.0731],
    zoom: 12.4,
    bbox: [-89.56, 42.96, -89.22, 43.17],
    counties: [{ state: '55', county: '025' }],
    lodesState: 'wi',
    calib: { workforceRate: 0.52, gravityBetaKm: 4.5, carSpeedKmh: 37 },
  },
};

const TIGERWEB =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer';
const ACS_YEAR = 2022;
const LODES_YEARS = [2021, 2020, 2019];
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function getJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function blockGroupLayerId() {
  const info = await getJson(`${TIGERWEB}?f=json`);
  const layer = info.layers.find((l) => /block group/i.test(l.name));
  if (!layer) throw new Error('TIGERweb block group layer not found');
  return layer.id;
}

async function fetchGeometries(meta, layerId) {
  const features = [];
  for (const c of meta.counties) {
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
      const gj = await getJson(`${TIGERWEB}/${layerId}/query?${params}`);
      const batch = gj.features ?? [];
      features.push(...batch);
      process.stdout.write(`  geometries: ${features.length}\r`);
      if (batch.length < 1000) break;
      offset += batch.length;
    }
  }
  console.log(`  geometries: ${features.length}`);
  return features;
}

async function fetchPop(meta) {
  const out = new Map();
  for (const c of meta.counties) {
    const url =
      `https://api.census.gov/data/${ACS_YEAR}/acs/acs5` +
      `?get=B01003_001E&for=block%20group:*&in=state:${c.state}%20county:${c.county}%20tract:*`;
    const rows = await getJson(url);
    for (const [k, v] of parseAcs(rows)) out.set(k, v);
  }
  console.log(`  population rows: ${out.size}`);
  return out;
}

async function fetchJobs(meta) {
  for (const year of LODES_YEARS) {
    const url = `https://lehd.ces.census.gov/data/lodes/LODES8/${meta.lodesState}/wac/${meta.lodesState}_wac_S000_JT00_${year}.csv.gz`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const buf = Buffer.from(await res.arrayBuffer());
      const text = gunzipSync(buf).toString('utf8');
      const map = parseWac(text);
      console.log(`  LODES ${year}: ${map.size} block groups with jobs`);
      return map;
    } catch (e) {
      console.warn(`  LODES ${year} failed: ${e.message}`);
    }
  }
  throw new Error('all LODES years failed');
}

async function fetchRoads(meta) {
  const q = overpassQuery(meta.bbox);
  let lastErr;
  for (const ep of OVERPASS) {
    try {
      console.log(`  overpass: ${ep}`);
      return await getJson(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(q)}`,
      });
    } catch (e) {
      lastErr = e;
      console.warn(`  overpass failed: ${e.message}`);
    }
  }
  throw lastErr;
}

async function bake(id) {
  const meta = CITIES[id];
  if (!meta) {
    console.error(`Unknown city "${id}". Options: ${Object.keys(CITIES).join(', ')}, all`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nBaking ${meta.name}…`);
  const layerId = await blockGroupLayerId();
  const features = await fetchGeometries(meta, layerId);
  const pop = await fetchPop(meta);
  let jobs = null;
  let source = 'US Census ACS + LEHD LODES + OpenStreetMap';
  try {
    jobs = await fetchJobs(meta);
  } catch {
    source = 'US Census ACS + OpenStreetMap (job locations estimated)';
    console.warn('  falling back to estimated job locations');
  }
  const overpass = await fetchRoads(meta);
  const blockGroups = buildBlockGroups(features, pop, jobs, meta.bbox, meta.center);
  const graph = buildRoadGraph(overpass, meta.bbox);
  const pack = {
    meta: { ...meta, dataSource: source },
    blockGroups,
    nodes: graph.nodes,
    edges: graph.edges,
  };
  const outPath = join(__dirname, '..', 'public', 'cities', `${id}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(pack));
  const mb = (JSON.stringify(pack).length / 1e6).toFixed(1);
  console.log(
    `  wrote ${outPath} (${mb} MB): ${blockGroups.length} block groups, ` +
      `${graph.nodes.length} nodes, ${graph.edges.length} edges`,
  );
}

const args = process.argv.slice(2).filter((a) => a !== '--');
const targets = args.includes('all') || args.length === 0 ? Object.keys(CITIES) : args;
for (const t of targets) {
  // eslint-disable-next-line no-await-in-loop
  await bake(t);
}
