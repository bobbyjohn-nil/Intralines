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

/** airports + regional rail stations — special trip generators */
export function overpassPoiQuery(bbox) {
  const [w, s, e, n] = bbox;
  const bb = `(${s},${w},${n},${e})`;
  return (
    `[out:json][timeout:120];(` +
    `way["aeroway"="aerodrome"]${bb};` +
    `relation["aeroway"="aerodrome"]${bb};` +
    `node["aeroway"="aerodrome"]${bb};` +
    `node["railway"="station"]["station"!~"subway|light_rail|monorail"]${bb};` +
    `way["railway"="station"]["station"!~"subway|light_rail|monorail"]${bb};` +
    `);out center tags;`
  );
}

/**
 * Overpass POI response -> Poi[]. Airports with an IATA code count as
 * commercial (big demand); private strips are dropped. Rail stations are
 * deduplicated (OSM often maps one station several times) and capped.
 */
export function parsePois(overpass) {
  const airports = [];
  const rails = [];
  for (const el of overpass.elements ?? []) {
    const tags = el.tags ?? {};
    const lng = el.lon ?? el.center?.lon;
    const lat = el.lat ?? el.center?.lat;
    if (lng === undefined || lat === undefined) continue;
    const pt = [q5(lng), q5(lat)];
    if (tags.aeroway === 'aerodrome') {
      if (tags.access === 'private' || tags['aerodrome:type'] === 'private') continue;
      if (tags.abandoned === 'yes' || tags.disused === 'yes') continue;
      airports.push({
        kind: 'airport',
        pt,
        name: tags.name || 'Airport',
        big: Boolean(tags.iata),
      });
    } else if (tags.railway === 'station') {
      rails.push({ kind: 'rail', pt, name: tags.name || 'Rail station' });
    }
  }
  // commercial airports first, then whatever's left; at most a few
  airports.sort((a, b) => Number(b.big) - Number(a.big));
  // dedupe rail stations within ~300 m of one another
  const keptRail = [];
  for (const r of rails) {
    const dup = keptRail.some(
      (k) =>
        Math.abs(k.pt[0] - r.pt[0]) * 87000 < 300 &&
        Math.abs(k.pt[1] - r.pt[1]) * 111000 < 300,
    );
    if (!dup) keptRail.push(r);
  }
  return [...airports.slice(0, 3), ...keptRail.slice(0, 12)];
}

/**
 * Attach POI trip demand to the nearest block group: shows up on the air /
 * rail heatmap layers and adds job-like attraction so bus lines serving an
 * airport or a train station actually win riders.
 */
export function applyPoiDemand(bgs, pois) {
  if (!bgs.length) return;
  for (const poi of pois) {
    let best = null;
    let bestKm = Infinity;
    const cos = Math.cos((poi.pt[1] * Math.PI) / 180);
    for (const bg of bgs) {
      const dx = (bg.centroid[0] - poi.pt[0]) * 111.32 * cos;
      const dy = (bg.centroid[1] - poi.pt[1]) * 110.54;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestKm) {
        bestKm = d;
        best = bg;
      }
    }
    const maxKm = poi.kind === 'airport' ? 4 : 2;
    if (!best || bestKm > maxKm) continue;
    if (poi.kind === 'airport') {
      const trips = poi.big ? 2600 : 400;
      best.air = (best.air || 0) + trips;
      best.jobs += poi.big ? 1300 : 160;
    } else {
      best.rail = (best.rail || 0) + 550;
      best.jobs += 220;
    }
  }
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
    const streetName =
      typeof w.tags.name === 'string' && w.tags.name.length
        ? w.tags.name.slice(0, 48)
        : undefined;
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
              const edge = { a: ia, b: ib, lenM: Math.round(len), kmh: speed, pts };
              if (streetName) edge.name = streetName;
              edges.push(edge);
            }
          }
        }
      }
      segStartI = i;
    }
  }

  healJunctions(nodes, edges);

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
 * Connect dead-end street stubs to a road they almost touch (<= 8 m).
 * OSM sometimes digitizes a side street ending a few meters short of the
 * avenue it joins; without this the router loops a whole block to reach a
 * stop just past the invisible gap. Runs before the largest-component
 * filter so neighborhoods hanging off a healed joint are kept. The radius
 * is small on purpose: genuine cul-de-sacs and grade-separated crossings
 * stay unconnected. Mutates nodes/edges in place.
 */
const HEAL_M = 8;
function healJunctions(nodes, edges) {
  if (!nodes.length || !edges.length) return;
  const degree = new Uint32Array(nodes.length);
  for (const e of edges) {
    degree[e.a]++;
    degree[e.b]++;
  }
  const cosLat = Math.cos((nodes[0][1] * Math.PI) / 180);
  const mx = 111320 * cosLat;
  const my = 110540;
  // bucket edge chain segments on a coarse grid for the near lookup
  const CELL = 0.0008;
  const buckets = new Map();
  const key = (cx, cy) => `${cx}:${cy}`;
  const snapshot = edges.length;
  for (let i = 0; i < snapshot; i++) {
    const e = edges[i];
    const chain = [nodes[e.a], ...e.pts, nodes[e.b]];
    for (let s = 0; s < chain.length - 1; s++) {
      const a = chain[s];
      const b = chain[s + 1];
      // sample along the segment so every grid cell it crosses knows it
      const steps = Math.max(
        1,
        Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / (CELL * 0.9)),
      );
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const cx = Math.floor((a[0] + (b[0] - a[0]) * t) / CELL);
        const cy = Math.floor((a[1] + (b[1] - a[1]) * t) / CELL);
        const kk = key(cx, cy);
        let bk = buckets.get(kk);
        if (!bk) buckets.set(kk, (bk = new Set()));
        bk.add(i);
      }
    }
  }
  for (let n = 0; n < degree.length; n++) {
    if (degree[n] !== 1) continue;
    const p = nodes[n];
    const cx = Math.floor(p[0] / CELL);
    const cy = Math.floor(p[1] / CELL);
    const cand = new Set();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const b = buckets.get(key(cx + dx, cy + dy));
        if (b) for (const i of b) cand.add(i);
      }
    }
    let best = null;
    for (const ei of cand) {
      const e = edges[ei];
      if (e.a === n || e.b === n) continue;
      const chain = [nodes[e.a], ...e.pts, nodes[e.b]];
      let along = 0;
      for (let s = 0; s < chain.length - 1; s++) {
        const a = chain[s];
        const b = chain[s + 1];
        const bx = (b[0] - a[0]) * mx;
        const by = (b[1] - a[1]) * my;
        const segLen = Math.hypot(bx, by);
        if (segLen < 0.5) continue;
        const px = (p[0] - a[0]) * mx;
        const py = (p[1] - a[1]) * my;
        const t = Math.max(0, Math.min(1, (px * bx + py * by) / (segLen * segLen)));
        const d = Math.hypot(px - bx * t, py - by * t);
        if (d <= HEAL_M && (!best || d < best.d)) {
          best = {
            ei, d,
            alongM: along + segLen * t,
            proj: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
          };
        }
        along += segLen;
      }
    }
    if (!best) continue;
    const e = edges[best.ei];
    const stubKmh = edges.find((x) => x.a === n || x.b === n)?.kmh ?? 30;
    let target;
    if (best.alongM < 10) target = e.a;
    else if (e.lenM - best.alongM < 10) target = e.b;
    else {
      // split the target edge at the projection
      const chain = [nodes[e.a], ...e.pts, nodes[e.b]];
      const ptsA = [];
      const ptsB = [];
      let along = 0;
      let placed = false;
      for (let s = 0; s < chain.length - 1; s++) {
        const a = chain[s];
        const b = chain[s + 1];
        const segLen = Math.hypot((b[0] - a[0]) * mx, (b[1] - a[1]) * my);
        if (!placed && along + segLen >= best.alongM - 0.01) placed = true;
        else if (!placed) ptsA.push(b);
        else ptsB.push(a);
        along += segLen;
      }
      target = nodes.length;
      nodes.push([best.proj[0], best.proj[1]]);
      const oldB = e.b;
      const oldLen = e.lenM;
      const half = {
        a: target, b: oldB, lenM: Math.max(1, Math.round(oldLen - best.alongM)),
        kmh: e.kmh, pts: ptsB,
      };
      if (e.name) half.name = e.name;
      e.b = target;
      e.pts = ptsA;
      e.lenM = Math.max(1, Math.round(best.alongM));
      edges.push(half);
    }
    if (target === n) continue;
    edges.push({ a: n, b: target, lenM: Math.max(1, Math.round(best.d)), kmh: stubKmh, pts: [] });
  }
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

/** LODES csv text -> Map geoid(12 = block group) -> C000 count */
function parseLodes(csvText, geoColumn, columns = ['C000']) {
  const maps = columns.map(() => new Map());
  let pos = 0;
  const nl = csvText.indexOf('\n');
  const header = csvText.slice(0, nl).split(',');
  const iGeo = header.indexOf(geoColumn);
  const idx = columns.map((c) => header.indexOf(c));
  if (iGeo === -1 || idx[0] === -1) throw new Error(`bad LODES header (${geoColumn})`);
  pos = nl + 1;
  while (pos < csvText.length) {
    let end = csvText.indexOf('\n', pos);
    if (end === -1) end = csvText.length;
    const line = csvText.slice(pos, end);
    pos = end + 1;
    if (!line) continue;
    const cells = line.split(',');
    const bg = String(cells[iGeo]).slice(0, 12);
    for (let c = 0; c < idx.length; c++) {
      if (idx[c] === -1) continue;
      const n = +cells[idx[c]] || 0;
      maps[c].set(bg, (maps[c].get(bg) || 0) + n);
    }
  }
  return maps;
}

/**
 * LODES WAC (workplaces) per block group: total jobs plus two themed
 * slices — education (NAICS 61, CNS15) and tourism (arts/entertainment +
 * hotels/restaurants, NAICS 71+72, CNS17+CNS18).
 */
export function parseWac(csvText) {
  const [jobs, cns15, cns17, cns18] = parseLodes(csvText, 'w_geocode', [
    'C000', 'CNS15', 'CNS17', 'CNS18',
  ]);
  const tour = new Map();
  for (const [bg, n] of cns17) tour.set(bg, n);
  for (const [bg, n] of cns18) tour.set(bg, (tour.get(bg) || 0) + n);
  return { jobs, edu: cns15, tour };
}

/** LODES RAC (residences): employed residents per block group */
export function parseRac(csvText) {
  return parseLodes(csvText, 'h_geocode')[0];
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
export function buildBlockGroups(features, popByBg, jobsByBg, bbox, center, sectors) {
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
    const bg = { id: geoid, centroid, rings, pop, jobs, areaKm2 };
    if (sectors) {
      bg.edu = sectors.edu?.get(geoid) ?? 0;
      bg.tour = sectors.tour?.get(geoid) ?? 0;
    }
    bgs.push(bg);
  }
  if (!jobsByBg) estimateJobs(bgs, center);
  // no sector data (estimated-jobs fallback): rough national shares so the
  // tourism/education heatmap layers aren't just empty
  if (!sectors) {
    for (const b of bgs) {
      b.edu = b.edu ?? Math.round(b.jobs * 0.09);
      b.tour = b.tour ?? Math.round(b.jobs * 0.1);
    }
  }
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

// ---------------------------------------------------------------------------
// Measured traffic
//
// AADT — annual average daily traffic — is the count highway agencies publish
// for a road: the average number of vehicles that use it per day. It is
// exactly the "average traffic" a congestion model wants, and unlike a live
// traffic feed it is a static number, so it can be baked into the city pack
// once and used forever without a network.
//
// Coverage is by nature partial: agencies count arterials and highways, not
// every residential street. So the counts are reduced to a coarse grid of how
// busy each part of town measurably is, and road class still decides each
// street's share of that. A city with no coverage keeps the modeled estimate.

/** ArcGIS REST query for AADT features inside a bbox */
export function aadtQueryUrl(base, bbox, field = 'AADT') {
  const [w, s, e, n] = bbox;
  const params = new URLSearchParams({
    f: 'geojson',
    where: `${field} > 0`,
    geometry: `${w},${s},${e},${n}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: field,
    returnGeometry: 'true',
    resultRecordCount: '4000',
  });
  return `${base}/query?${params}`;
}

/** midpoint + count for every usable feature in an AADT response */
export function parseAadt(geojson, field = 'AADT') {
  const out = [];
  for (const f of geojson?.features ?? []) {
    const raw = f?.properties?.[field] ?? f?.properties?.[field?.toLowerCase()];
    const aadt = Number(raw);
    if (!isFinite(aadt) || aadt <= 0) continue;
    const pt = featureMidpoint(f?.geometry);
    if (pt) out.push({ pt, aadt });
  }
  return out;
}

/** a representative point for a point/line/multiline feature */
function featureMidpoint(geom) {
  if (!geom) return null;
  if (geom.type === 'Point') return geom.coordinates.slice(0, 2);
  const lines =
    geom.type === 'LineString' ? [geom.coordinates]
    : geom.type === 'MultiLineString' ? geom.coordinates
    : null;
  if (!lines || !lines.length) return null;
  const line = lines[Math.floor(lines.length / 2)];
  if (!line?.length) return null;
  const mid = line[Math.floor(line.length / 2)];
  return mid ? mid.slice(0, 2) : null;
}

/** grid cell size, in degrees — roughly a kilometre of city */
const TRAFFIC_CELL = 0.01;

/**
 * Reduce scattered counts to a grid of mean AADT per cell, then normalize
 * against the city's own busiest corridor so a small city and a big one both
 * span the same 0..1 range of "measurably busy".
 */
export function buildTrafficGrid(samples, bbox) {
  if (!samples?.length) return null;
  const [w, s, e, n] = bbox;
  const cols = Math.max(1, Math.ceil((e - w) / TRAFFIC_CELL));
  const rows = Math.max(1, Math.ceil((n - s) / TRAFFIC_CELL));
  const sum = new Float64Array(cols * rows);
  const count = new Int32Array(cols * rows);
  for (const { pt, aadt } of samples) {
    const cx = Math.floor((pt[0] - w) / TRAFFIC_CELL);
    const cy = Math.floor((pt[1] - s) / TRAFFIC_CELL);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
    const i = cy * cols + cx;
    sum[i] += aadt;
    count[i] += 1;
  }
  const mean = new Array(cols * rows).fill(0);
  let busiest = 0;
  for (let i = 0; i < mean.length; i++) {
    if (!count[i]) continue;
    mean[i] = Math.round(sum[i] / count[i]);
    busiest = Math.max(busiest, mean[i]);
  }
  if (!busiest) return null;
  // counted cells are sparse; spread each one into its neighbours so a stop
  // one block off a counted arterial still sees the traffic it sits in
  const spread = mean.slice();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (mean[y * cols + x]) continue;
      let best = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          best = Math.max(best, mean[ny * cols + nx] * 0.6);
        }
      }
      spread[y * cols + x] = Math.round(best);
    }
  }
  return {
    cell: TRAFFIC_CELL,
    lng0: w,
    lat0: s,
    cols,
    rows,
    busiest,
    aadt: spread,
    samples: samples.length,
  };
}

/** measured AADT at a point, or 0 where nothing was counted nearby */
export function trafficAadtAt(grid, pt) {
  if (!grid) return 0;
  const x = Math.floor((pt[0] - grid.lng0) / grid.cell);
  const y = Math.floor((pt[1] - grid.lat0) / grid.cell);
  if (x < 0 || y < 0 || x >= grid.cols || y >= grid.rows) return 0;
  return grid.aadt[y * grid.cols + x] || 0;
}
