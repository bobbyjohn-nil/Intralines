// Pure data-transform pipeline shared by the in-browser loader and the Node
// bake script (scripts/bake-city.mjs). No DOM/Node APIs here — callers fetch
// raw payloads, these functions turn them into a CityPack.

/** speed by OSM highway class (km/h) */
const CLASS_SPEED = {
  motorway: 88, motorway_link: 60, trunk: 70, trunk_link: 50,
  primary: 52, primary_link: 40, secondary: 45, secondary_link: 35,
  tertiary: 40, tertiary_link: 32, unclassified: 32, residential: 30,
  living_street: 15,
};

export const ROAD_CLASSES = Object.keys(CLASS_SPEED);

export function overpassQuery(bbox) {
  const [w, s, e, n] = bbox;
  const cls = ROAD_CLASSES.join('|');
  return (
    `[out:json][timeout:300];` +
    `(way["highway"~"^(${cls})$"](${s},${w},${n},${e}););` +
    `out body; >; out skel qt;`
  );
}

/** water + green space, for the offline self-rendered basemap */
export function overpassScenicQuery(bbox) {
  const [w, s, e, n] = bbox;
  const bb = `(${s},${w},${n},${e})`;
  return (
    `[out:json][timeout:240];(` +
    `way["natural"="water"]${bb};` +
    `relation["natural"="water"]${bb};` +
    `way["waterway"="riverbank"]${bb};` +
    `way["leisure"~"^(park|golf_course|nature_reserve|pitch|garden)$"]${bb};` +
    `way["landuse"~"^(forest|grass|recreation_ground|cemetery|meadow|village_green)$"]${bb};` +
    `);out geom;`
  );
}

/**
 * Parse the scenic query (issued with `out geom`) into water/park rings.
 * Relations (big lakes are multipolygons) get their outer ways stitched
 * end-to-end into closed rings; unstitchable leftovers are dropped.
 */
export function parseScenic(overpass) {
  const water = [];
  const parks = [];
  const pushRing = (dest, coords) => {
    if (!coords || coords.length < 4) return;
    const ring = simplifyRing(coords, 0.00025);
    if (ring.length < 4) return;
    if (ringAreaKm2(ring) < 0.004) return;
    dest.push(ring);
  };
  for (const el of overpass.elements ?? []) {
    const tags = el.tags ?? {};
    const isWater = tags.natural === 'water' || tags.waterway === 'riverbank';
    const dest = isWater ? water : parks;
    if (el.type === 'way' && Array.isArray(el.geometry)) {
      pushRing(dest, el.geometry.map((g) => [g.lon, g.lat]));
    } else if (el.type === 'relation' && Array.isArray(el.members)) {
      const segs = el.members
        .filter((m) => (m.role === 'outer' || m.role === '') && Array.isArray(m.geometry))
        .map((m) => m.geometry.map((g) => [g.lon, g.lat]));
      for (const ring of stitchRings(segs)) pushRing(dest, ring);
    }
    if (water.length > 400 && parks.length > 700) break;
  }
  return { water: water.slice(0, 400), parks: parks.slice(0, 700) };
}

const keyOf = (p) => `${Math.round(p[0] * 1e6)}:${Math.round(p[1] * 1e6)}`;

/** join way segments end-to-end into closed rings (best effort) */
export function stitchRings(segs) {
  const pool = segs.filter((s) => s.length >= 2).map((s) => [...s]);
  const rings = [];
  while (pool.length) {
    let ring = pool.pop();
    let guard = pool.length + 4;
    while (guard-- > 0 && keyOf(ring[0]) !== keyOf(ring[ring.length - 1])) {
      const end = keyOf(ring[ring.length - 1]);
      let found = -1;
      let flip = false;
      for (let i = 0; i < pool.length; i++) {
        if (keyOf(pool[i][0]) === end) { found = i; flip = false; break; }
        if (keyOf(pool[i][pool[i].length - 1]) === end) { found = i; flip = true; break; }
      }
      if (found === -1) break;
      const next = pool.splice(found, 1)[0];
      if (flip) next.reverse();
      ring = ring.concat(next.slice(1));
    }
    if (keyOf(ring[0]) === keyOf(ring[ring.length - 1]) && ring.length >= 4) {
      rings.push(ring);
    }
  }
  return rings;
}

function inBbox(lng, lat, bbox) {
  return lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

const q5 = (v) => Math.round(v * 1e5) / 1e5;

/**
 * Overpass JSON -> road graph {nodes: [lng,lat][], edges: {a,b,lenM,kmh,pts}[]}
 * Ways are split at intersections; only the largest connected component kept.
 */
export function buildRoadGraph(overpass, bbox) {
  const nodeCoord = new Map(); // osm id -> [lng, lat]
  const usage = new Map(); // osm id -> count
  const ways = [];
  for (const el of overpass.elements) {
    if (el.type === 'node') nodeCoord.set(el.id, [q5(el.lon), q5(el.lat)]);
    else if (el.type === 'way' && el.tags && el.tags.highway in CLASS_SPEED) ways.push(el);
  }
  for (const w of ways) {
    for (let i = 0; i < w.nodes.length; i++) {
      const id = w.nodes[i];
      const endpoint = i === 0 || i === w.nodes.length - 1;
      usage.set(id, (usage.get(id) || 0) + (endpoint ? 2 : 1));
    }
  }

  const nodes = [];
  const nodeIdx = new Map(); // osm id -> graph index
  const edges = [];
  const idxOf = (osmId) => {
    let i = nodeIdx.get(osmId);
    if (i === undefined) {
      const coord = nodeCoord.get(osmId);
      if (!coord) return -1; // node missing from the response — skip segment
      i = nodes.length;
      nodes.push(coord);
      nodeIdx.set(osmId, i);
    }
    return i;
  };

  const distM = (a, b) => {
    const cos = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
    const dx = (b[0] - a[0]) * 111320 * cos;
    const dy = (b[1] - a[1]) * 110540;
    return Math.sqrt(dx * dx + dy * dy);
  };

  for (const w of ways) {
    let speed = CLASS_SPEED[w.tags.highway];
    const ms = w.tags.maxspeed;
    if (ms) {
      const m = /^(\d+)(\s*mph)?/.exec(ms);
      if (m) speed = m[2] ? Math.round(+m[1] * 1.609) : +m[1];
      speed = Math.min(Math.max(speed, 10), 100);
    }
    let segStartI = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      const isSplit = i === w.nodes.length - 1 || (usage.get(w.nodes[i]) || 0) >= 2;
      if (!isSplit) continue;
      const idsSeg = w.nodes.slice(segStartI, i + 1);
      const coords = idsSeg.map((id) => nodeCoord.get(id)).filter(Boolean);
      if (coords.length >= 2) {
        const anyIn = coords.some((c) => inBbox(c[0], c[1], bbox));
        if (anyIn) {
          let len = 0;
          for (let k = 1; k < coords.length; k++) len += distM(coords[k - 1], coords[k]);
          if (len >= 5) {
            // light simplification of interior shape points (~8m tolerance)
            const pts = [];
            let last = coords[0];
            for (let k = 1; k < coords.length - 1; k++) {
              const p = coords[k];
              if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) > 0.00012) {
                pts.push(p);
                last = p;
              }
            }
            const ia = idxOf(idsSeg[0]);
            const ib = idxOf(idsSeg[idsSeg.length - 1]);
            if (ia >= 0 && ib >= 0 && ia !== ib) {
              edges.push({ a: ia, b: ib, lenM: Math.round(len), kmh: speed, pts });
            }
          }
        }
      }
      segStartI = i;
    }
  }

  // largest connected component
  const adj = Array.from({ length: nodes.length }, () => []);
  edges.forEach((e, i) => {
    adj[e.a].push(e.b);
    adj[e.b].push(e.a);
  });
  const comp = new Int32Array(nodes.length).fill(-1);
  let bestC = -1;
  let bestSize = 0;
  let c = 0;
  for (let s = 0; s < nodes.length; s++) {
    if (comp[s] !== -1 || adj[s].length === 0) continue;
    const stack = [s];
    comp[s] = c;
    let size = 0;
    while (stack.length) {
      const u = stack.pop();
      size++;
      for (const v of adj[u]) if (comp[v] === -1) { comp[v] = c; stack.push(v); }
    }
    if (size > bestSize) { bestSize = size; bestC = c; }
    c++;
  }
  const remap = new Int32Array(nodes.length).fill(-1);
  const outNodes = [];
  nodes.forEach((pt, i) => {
    if (comp[i] === bestC) {
      remap[i] = outNodes.length;
      outNodes.push(pt);
    }
  });
  const outEdges = edges
    .filter((e) => comp[e.a] === bestC && comp[e.b] === bestC)
    .map((e) => ({ ...e, a: remap[e.a], b: remap[e.b] }));
  return { nodes: outNodes, edges: outEdges };
}

/**
 * ACS rows (first row = header) -> Map geoid(12) -> population
 * Expects get=B01003_001E with for=block group.
 */
export function parseAcs(rows) {
  const header = rows[0];
  const iPop = header.indexOf('B01003_001E');
  const iState = header.indexOf('state');
  const iCounty = header.indexOf('county');
  const iTract = header.indexOf('tract');
  const iBg = header.indexOf('block group');
  const out = new Map();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const geoid = `${row[iState]}${row[iCounty]}${row[iTract]}${row[iBg]}`;
    out.set(geoid, Math.max(0, +row[iPop] || 0));
  }
  return out;
}

/** LODES WAC csv text -> Map geoid(12 = block group) -> jobs */
export function parseWac(csvText) {
  const out = new Map();
  let pos = 0;
  const nl = csvText.indexOf('\n');
  const header = csvText.slice(0, nl).split(',');
  const iGeo = header.indexOf('w_geocode');
  const iJobs = header.indexOf('C000');
  pos = nl + 1;
  while (pos < csvText.length) {
    let end = csvText.indexOf('\n', pos);
    if (end === -1) end = csvText.length;
    const line = csvText.slice(pos, end);
    pos = end + 1;
    if (!line) continue;
    const cells = line.split(',');
    const bg = String(cells[iGeo]).slice(0, 12);
    const jobs = +cells[iJobs] || 0;
    out.set(bg, (out.get(bg) || 0) + jobs);
  }
  return out;
}

function ringCentroid(ring) {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [q5(x / ring.length) , q5(y / ring.length)];
}

function ringAreaKm2(ring) {
  if (!ring || ring.length < 3) return 0;
  const midLat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const cos = Math.cos((midLat * Math.PI) / 180);
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    area += p[0] * 111.32 * cos * (q[1] * 110.54) - q[0] * 111.32 * cos * (p[1] * 110.54);
  }
  return Math.abs(area) / 2;
}

function simplifyRing(ring, tol) {
  if (ring.length <= 10) return ring.map((p) => [q5(p[0]), q5(p[1])]);
  const out = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const last = out[out.length - 1];
    if (Math.abs(ring[i][0] - last[0]) + Math.abs(ring[i][1] - last[1]) > tol) {
      out.push(ring[i]);
    }
  }
  return (out.length >= 4 ? out : ring).map((p) => [q5(p[0]), q5(p[1])]);
}

/**
 * TIGERweb GeoJSON features + ACS pop + (optional) LODES jobs -> BlockGroup[]
 * When jobsByBg is null, jobs are estimated from population with a
 * center-weighted decay (clearly labeled in meta.dataSource by the caller).
 */
export function buildBlockGroups(features, popByBg, jobsByBg, bbox, center) {
  const bgs = [];
  for (const f of features) {
    const geoid = f.properties.GEOID || f.properties.geoid;
    if (!geoid) continue;
    const geom = f.geometry;
    if (!geom) continue;
    let rings = [];
    if (geom.type === 'Polygon') rings = [geom.coordinates[0]];
    else if (geom.type === 'MultiPolygon') rings = geom.coordinates.map((p) => p[0]);
    if (!rings.length) continue;
    rings = rings.map((r) => simplifyRing(r, 0.00035));
    const biggest = rings.reduce((a, b) => (ringAreaKm2(b) > ringAreaKm2(a) ? b : a));
    const centroid = ringCentroid(biggest);
    if (!inBbox(centroid[0], centroid[1], bbox)) continue;
    const pop = popByBg.get(geoid) ?? 0;
    const jobs = jobsByBg ? jobsByBg.get(geoid) ?? 0 : 0;
    const areaKm2 =
      (f.properties.AREALAND ? f.properties.AREALAND / 1e6 : 0) ||
      rings.reduce((s, r) => s + ringAreaKm2(r), 0) ||
      0.05;
    if (pop <= 0 && jobs <= 0 && !jobsByBg) continue;
    bgs.push({ id: geoid, centroid, rings, pop, jobs, areaKm2 });
  }
  if (!jobsByBg) estimateJobs(bgs, center);
  // drop fully-empty cells
  return bgs.filter((b) => b.pop > 0 || b.jobs > 0);
}

/**
 * Fallback when LODES can't be fetched from the browser: distribute a
 * plausible job total (45% of resident count) with a strong downtown bias.
 */
export function estimateJobs(bgs, center) {
  const totalPop = bgs.reduce((s, b) => s + b.pop, 0);
  const target = totalPop * 0.45;
  let wsum = 0;
  const ws = bgs.map((b) => {
    const dx = (b.centroid[0] - center[0]) * 88;
    const dy = (b.centroid[1] - center[1]) * 111;
    const d = Math.sqrt(dx * dx + dy * dy);
    const w = Math.exp(-d / 2.2) * 3 + Math.pow(Math.max(b.pop, 1), 0.4) / 10;
    wsum += w;
    return w;
  });
  bgs.forEach((b, i) => {
    b.jobs = Math.round((ws[i] / wsum) * target);
  });
}
