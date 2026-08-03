// Bake a real city's data into public/cities/<id>.json so players skip the
// in-browser download. Run on a machine with open internet access:
//
//   npm run bake -- worcester
//   npm run bake -- desmoines madison
//   npm run bake -- all
//
// Sources: Census TIGERweb (block group geometry), ACS 5-year (population),
// LEHD LODES WAC (jobs), OpenStreetMap via Overpass (streets).

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  buildBlockGroups, buildRoadGraph, overpassQuery, overpassScenicQuery, parseAcs,
  parseRac, parseScenic, parseWac,
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
const ACS_YEARS = [2023, 2022, 2021];
const LODES_YEARS = [2022, 2021, 2020];
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
// OSM services block anonymous datacenter clients — identify ourselves
const USER_AGENT =
  'TransitLinesGame/0.1 (open-source bus simulation; https://github.com/bobbyjohn-nil/Transit-Lines)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    const base = {
      where: `STATE='${c.state}' AND COUNTY='${c.county}'`,
      outFields: 'GEOID,AREALAND,OBJECTID',
      outSR: '4326',
      geometryPrecision: '5',
    };
    let got = [];
    // try paginated geojson, then plain geojson, then OBJECTID windows
    try {
      let offset = 0;
      for (;;) {
        const gj = await getJson(
          `${TIGERWEB}/${layerId}/query?${new URLSearchParams({
            ...base, f: 'geojson', resultRecordCount: '1000', resultOffset: String(offset),
          })}`,
        );
        if (gj.error || !Array.isArray(gj.features)) throw new Error('pagination unsupported');
        got.push(...gj.features);
        if (gj.features.length < 1000) break;
        offset += gj.features.length;
      }
    } catch {
      got = [];
      const gj = await getJson(
        `${TIGERWEB}/${layerId}/query?${new URLSearchParams({ ...base, f: 'geojson' })}`,
      );
      if (!gj.error && Array.isArray(gj.features)) got = gj.features;
      let lastOid = got.reduce((m, f) => Math.max(m, f.properties?.OBJECTID ?? 0), 0);
      while (gj.exceededTransferLimit && lastOid > 0) {
        const more = await getJson(
          `${TIGERWEB}/${layerId}/query?${new URLSearchParams({
            ...base, where: `${base.where} AND OBJECTID>${lastOid}`, f: 'geojson',
          })}`,
        );
        if (more.error || !Array.isArray(more.features) || !more.features.length) break;
        got.push(...more.features);
        const next = more.features.reduce(
          (m, f) => Math.max(m, f.properties?.OBJECTID ?? 0), 0,
        );
        if (next <= lastOid) break;
        lastOid = next;
        if (!more.exceededTransferLimit) break;
      }
    }
    features.push(...got);
    console.log(`  geometries so far: ${features.length}`);
  }
  return features;
}

async function fetchLodesGz(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
}

/**
 * Population per block group. Primary: ACS 5-year (true population).
 * Fallback: LODES RAC employed residents scaled by the workforce rate —
 * the Census API rate-limits anonymous callers (especially shared CI IPs),
 * while the LEHD file server does not.
 */
async function fetchPop(meta) {
  const out = new Map();
  try {
    for (const c of meta.counties) {
      let done = false;
      let lastErr;
      for (const year of ACS_YEARS) {
        for (const inClause of [
          `in=state:${c.state}%20county:${c.county}%20tract:*`,
          `in=state:${c.state}%20county:${c.county}&in=tract:*`,
          `in=state:${c.state}%20county:${c.county}`,
        ]) {
          try {
            const rows = await getJson(
              `https://api.census.gov/data/${year}/acs/acs5?get=B01003_001E&for=block%20group:*&${inClause}`,
            );
            if (!Array.isArray(rows) || rows.length < 2) throw new Error('empty response');
            for (const [k, v] of parseAcs(rows)) out.set(k, v);
            done = true;
            break;
          } catch (e) {
            lastErr = e;
          }
        }
        if (done) break;
      }
      if (!done) throw lastErr;
    }
    console.log(`  population rows (ACS): ${out.size}`);
    return { pop: out, source: 'ACS' };
  } catch (e) {
    console.warn(`  ACS unavailable (${e.message ?? e}); using LODES RAC residents`);
  }
  let lastErr;
  for (const year of LODES_YEARS) {
    try {
      const text = await fetchLodesGz(
        `https://lehd.ces.census.gov/data/lodes/LODES8/${meta.lodesState}/rac/${meta.lodesState}_rac_S000_JT00_${year}.csv.gz`,
      );
      const workers = parseRac(text);
      const rate = meta.calib.workforceRate;
      for (const [bg, w] of workers) out.set(bg, Math.round(w / rate));
      console.log(`  population rows (RAC ${year}): ${out.size}`);
      return { pop: out, source: `LODES RAC ${year}` };
    } catch (e) {
      lastErr = e;
      console.warn(`  RAC ${year} failed: ${e.message}`);
    }
  }
  throw lastErr;
}

async function fetchJobs(meta) {
  for (const year of LODES_YEARS) {
    try {
      const text = await fetchLodesGz(
        `https://lehd.ces.census.gov/data/lodes/LODES8/${meta.lodesState}/wac/${meta.lodesState}_wac_S000_JT00_${year}.csv.gz`,
      );
      const map = parseWac(text);
      console.log(`  LODES WAC ${year}: ${map.size} block groups with jobs`);
      return map;
    } catch (e) {
      console.warn(`  LODES WAC ${year} failed: ${e.message}`);
    }
  }
  throw new Error('all LODES years failed');
}

async function overpass(q) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const ep of OVERPASS) {
      try {
        console.log(`  overpass: ${ep}${attempt ? ' (retry)' : ''}`);
        return await getJson(ep, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
          },
          body: `data=${encodeURIComponent(q)}`,
        });
      } catch (e) {
        lastErr = e;
        console.warn(`  overpass failed: ${e.message}`);
        if (/429/.test(String(e.message))) await sleep(15000);
      }
    }
    if (attempt === 0) await sleep(20000);
  }
  throw lastErr;
}

async function bake(id, force) {
  const meta = CITIES[id];
  if (!meta) {
    console.error(`Unknown city "${id}". Options: ${Object.keys(CITIES).join(', ')}, all`);
    process.exitCode = 1;
    return;
  }
  const existing = join(__dirname, '..', 'public', 'cities', `${id}.json.gz`);
  if (existsSync(existing) && !force) {
    console.log(`\n${meta.name}: already baked (${existing}) — use --force to refresh.`);
    return;
  }
  console.log(`\nBaking ${meta.name}…`);
  const layerId = await blockGroupLayerId();
  const features = await fetchGeometries(meta, layerId);
  const { pop, source: popSource } = await fetchPop(meta);
  let jobs = null;
  let source = `US Census (${popSource}) + LEHD LODES + OpenStreetMap`;
  try {
    jobs = await fetchJobs(meta);
  } catch {
    source = `US Census (${popSource}) + OpenStreetMap (job locations estimated)`;
    console.warn('  falling back to estimated job locations');
  }
  const roadsJson = await overpass(overpassQuery(meta.bbox));
  let scenic = { water: [], parks: [] };
  try {
    scenic = parseScenic(await overpass(overpassScenicQuery(meta.bbox)));
  } catch (e) {
    console.warn(`  water/parks fetch failed (cosmetic only): ${e.message}`);
  }
  const blockGroups = buildBlockGroups(features, pop, jobs, meta.bbox, meta.center);
  const graph = buildRoadGraph(roadsJson, meta.bbox);
  const pack = {
    meta: { ...meta, dataSource: source },
    blockGroups,
    nodes: graph.nodes,
    edges: graph.edges,
    water: scenic.water,
    parks: scenic.parks,
  };
  const json = JSON.stringify(pack);
  const outPath = join(__dirname, '..', 'public', 'cities', `${id}.json.gz`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, gzipSync(Buffer.from(json), { level: 9 }));
  console.log(
    `  wrote ${outPath} (${(json.length / 1e6).toFixed(1)} MB raw, ` +
      `${(gzipSync(Buffer.from(json)).length / 1e6).toFixed(1)} MB gz): ` +
      `${blockGroups.length} block groups, ${graph.nodes.length} nodes, ` +
      `${graph.edges.length} edges, ${scenic.water.length} water, ${scenic.parks.length} parks`,
  );
}

const args = process.argv.slice(2).filter((a) => a !== '--');
const force = args.includes('--force');
const names = args.filter((a) => a !== '--force');
const targets = names.includes('all') || names.length === 0 ? Object.keys(CITIES) : names;
let failures = 0;
for (const t of targets) {
  try {
    // eslint-disable-next-line no-await-in-loop
    await bake(t, force);
  } catch (e) {
    failures++;
    console.error(`\n${t} FAILED: ${e.stack ?? e}`);
  }
}
if (failures) {
  console.error(`\n${failures} city bake(s) failed.`);
  process.exitCode = 1;
}
