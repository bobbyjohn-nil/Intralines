// Generates the bundled offline demo city "Riverton" — a plausible small city
// with a river, downtown core, university, industrial park and suburbs.
// Deterministic (seeded) so the file is stable across runs.
// Output: public/cities/demo.json  (CityPack, see src/game/types.ts)

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260803);

// City frame: planar meters -> lng/lat around a neutral anchor.
const CENTER = [-100.0, 41.5];
const COS = Math.cos((CENTER[1] * Math.PI) / 180);
const m2lng = (x) => CENTER[0] + x / (111320 * COS);
const m2lat = (y) => CENTER[1] + y / 110540;
const P = (x, y) => [round6(m2lng(x)), round6(m2lat(y))];
const round6 = (v) => Math.round(v * 1e6) / 1e6;

// ---------------------------------------------------------------------------
// Road grid: 200m blocks downtown, 400m in suburbs. x,y in meters, origin center.
const BLOCK = 200;
const HALF = 27; // grid half-extent in blocks => streets out to ±5.4 km
const nodes = [];
const nodeIdx = new Map(); // "gx:gy" -> index
const edges = [];

// River: vertical band through x ≈ +600..+900 with a gentle curve.
function riverXAt(y) {
  return 700 + 250 * Math.sin(y / 1800);
}
function inRiver(x, y) {
  const rx = riverXAt(y);
  return x > rx - 130 && x < rx + 130;
}

function gridNode(gx, gy) {
  const key = `${gx}:${gy}`;
  if (nodeIdx.has(key)) return nodeIdx.get(key);
  const x = gx * BLOCK;
  const y = gy * BLOCK;
  const i = nodes.length;
  nodes.push(P(x, y));
  nodeIdx.set(key, i);
  return i;
}

const BRIDGE_GYS = new Set([-6, 0, 6]); // bridge rows (every ~1.2km)

const ST_NAMES = [
  'Main St', 'Oak St', 'Maple St', 'Cedar St', 'Pine St', 'Elm St', 'Birch St',
  'Walnut St', 'Chestnut St', 'Spruce St', 'Willow St', 'Aspen St', 'Hickory St',
  'Laurel St', 'Magnolia St', 'Juniper St', 'Poplar St', 'Sycamore St',
  'Dogwood St', 'Hawthorn St', 'Linden St', 'Alder St', 'Beech St', 'Holly St',
  'Ivy St', 'Rose St', 'Garden St', 'Harbor St', 'Mill St',
];
function ordinal(n) {
  const tail = n % 100;
  if (tail >= 11 && tail <= 13) return `${n}th`;
  const last = n % 10;
  return `${n}${last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th'}`;
}
const aveName = (gx) => `${ordinal(gx + HALF + 1)} Ave`;
const stName = (gy) => ST_NAMES[(((gy + HALF) % ST_NAMES.length) + ST_NAMES.length) % ST_NAMES.length];

function addEdge(gxa, gya, gxb, gyb, kmh, name) {
  const xa = gxa * BLOCK, ya = gya * BLOCK;
  const xb = gxb * BLOCK, yb = gyb * BLOCK;
  const midX = (xa + xb) / 2, midY = (ya + yb) / 2;
  const crossesRiver = inRiver(midX, midY) || inRiver(xa, ya) || inRiver(xb, yb);
  const horizontal = gya === gyb;
  if (crossesRiver && !(horizontal && BRIDGE_GYS.has(gya))) return;
  const a = gridNode(gxa, gya);
  const b = gridNode(gxb, gyb);
  const lenM = Math.hypot(xb - xa, yb - ya);
  const edge = { a, b, lenM: Math.round(lenM), kmh, pts: [] };
  if (name) edge.name = name;
  edges.push(edge);
}

for (let gx = -HALF; gx <= HALF; gx++) {
  for (let gy = -HALF; gy <= HALF; gy++) {
    const suburban = Math.max(Math.abs(gx), Math.abs(gy)) > 8;
    // suburbs: skip half the local streets for a coarser, looser grid
    const arterialX = gx % 4 === 0;
    const arterialY = gy % 4 === 0;
    if (suburban && !arterialX && !arterialY && (gx + gy) % 2 !== 0) continue;
    if (gx < HALF) {
      const art = arterialY;
      if (!suburban || art || gy % 2 === 0) {
        addEdge(gx, gy, gx + 1, gy, art ? 42 : 28, stName(gy));
      }
    }
    if (gy < HALF) {
      const art = arterialX;
      if (!suburban || art || gx % 2 === 0) {
        addEdge(gx, gy, gx, gy + 1, art ? 42 : 28, aveName(gx));
      }
    }
  }
}

// Diagonal avenue from SW suburbs to downtown
for (let i = -12; i < -2; i++) addEdge(i, i, i + 1, i + 1, 45, 'Riverton Blvd');

// Drop a few random local streets for organic texture (never arterials)
const keptEdges = edges.filter((e) => e.kmh > 30 || rnd() > 0.06);

// Keep only the largest connected component so A* never strands a stop.
function largestComponent(nodesLen, es) {
  const adj = Array.from({ length: nodesLen }, () => []);
  es.forEach((e, i) => {
    adj[e.a].push([e.b, i]);
    adj[e.b].push([e.a, i]);
  });
  const comp = new Int32Array(nodesLen).fill(-1);
  let best = -1, bestSize = 0, c = 0;
  for (let s = 0; s < nodesLen; s++) {
    if (comp[s] !== -1 || adj[s].length === 0) continue;
    let size = 0;
    const stack = [s];
    comp[s] = c;
    while (stack.length) {
      const u = stack.pop();
      size++;
      for (const [v] of adj[u]) if (comp[v] === -1) { comp[v] = c; stack.push(v); }
    }
    if (size > bestSize) { bestSize = size; best = c; }
    c++;
  }
  return { comp, best };
}
const { comp, best } = largestComponent(nodes.length, keptEdges);
const remap = new Int32Array(nodes.length).fill(-1);
const outNodes = [];
nodes.forEach((pt, i) => {
  if (comp[i] === best) {
    remap[i] = outNodes.length;
    outNodes.push(pt);
  }
});
const outEdges = keptEdges
  .filter((e) => comp[e.a] === best && comp[e.b] === best)
  .map((e) => ({ ...e, a: remap[e.a], b: remap[e.b] }));

// ---------------------------------------------------------------------------
// Block groups: 400m cells. Population from a downtown-centered falloff plus
// neighborhoods; jobs concentrated downtown / industrial / university.
const CELL = 400;
const CH = 13; // half-extent in cells => 10.4km
const blockGroups = [];
const UNI = { x: -1600, y: 1800 }; // university NW
const IND = { x: 1800, y: -1800 }; // industrial park SE (across river)
const MALL = { x: -2000, y: -400 };
const EASTVILLE = { x: 4800, y: 2400 }; // satellite town NE
const WESTON = { x: -4600, y: -3400 }; // satellite town SW

let bgSeq = 0;
for (let cx = -CH; cx < CH; cx++) {
  for (let cy = -CH; cy < CH; cy++) {
    const x0 = cx * CELL, y0 = cy * CELL;
    const cxm = x0 + CELL / 2, cym = y0 + CELL / 2;
    if (inRiver(cxm, cym)) continue;
    const dDowntown = Math.hypot(cxm, cym);
    const dUni = Math.hypot(cxm - UNI.x, cym - UNI.y);
    const dInd = Math.hypot(cxm - IND.x, cym - IND.y);
    const dMall = Math.hypot(cxm - MALL.x, cym - MALL.y);

    const dEast = Math.hypot(cxm - EASTVILLE.x, cym - EASTVILLE.y);
    const dWest = Math.hypot(cxm - WESTON.x, cym - WESTON.y);
    let popDens =
      5200 * Math.exp(-dDowntown / 1500) +
      2600 * Math.exp(-dUni / 900) +
      1900 * Math.exp(-dEast / 700) +
      1500 * Math.exp(-dWest / 650) +
      240 * Math.exp(-dDowntown / 4200); // thin suburban carpet
    popDens *= 0.75 + rnd() * 0.5;
    if (dInd < 700) popDens *= 0.15; // nobody lives in the industrial park
    let pop = popDens * 0.16; // cell is 0.16 km²

    let jobs =
      2600 * Math.exp(-dDowntown / 600) +
      1500 * Math.exp(-dInd / 500) +
      900 * Math.exp(-dUni / 400) +
      700 * Math.exp(-dMall / 350) +
      520 * Math.exp(-dEast / 450) +
      380 * Math.exp(-dWest / 420) +
      pop * 0.012;
    jobs *= 0.7 + rnd() * 0.6;

    // themed demand slices (heatmap layers): campuses/schools + attractions
    let edu =
      2400 * Math.exp(-dUni / 380) +
      pop * 0.02; // neighborhood schools follow the people
    edu *= 0.75 + rnd() * 0.5;
    let tour =
      1700 * Math.exp(-dDowntown / 450) +
      850 * Math.exp(-dMall / 300) +
      450 * Math.exp(-dUni / 350) +
      650 * Math.exp(-dEast / 480);
    if (Math.abs(cxm) < 900 && Math.abs(cym) < 2400) tour += 500; // riverfront strip
    tour *= 0.7 + rnd() * 0.6;

    if (pop < 60 && jobs < 60) continue;
    const ring = [P(x0, y0), P(x0 + CELL, y0), P(x0 + CELL, y0 + CELL), P(x0, y0 + CELL)];
    blockGroups.push({
      id: `demo-${bgSeq++}`,
      centroid: P(cxm, cym),
      rings: [ring],
      pop,
      jobs,
      edu: Math.round(edu * 0.16),
      tour: Math.round(tour * 0.16),
      areaKm2: 0.16,
    });
  }
}

// Normalize totals to a plausible small city: 128k residents, 64k jobs.
{
  const popSum = blockGroups.reduce((s, b) => s + b.pop, 0);
  const jobSum = blockGroups.reduce((s, b) => s + b.jobs, 0);
  const pf = 128_000 / popSum;
  const jf = 64_000 / jobSum;
  for (const bg of blockGroups) {
    bg.pop = Math.round((bg.pop * pf) / 10) * 10;
    bg.jobs = Math.round((bg.jobs * jf) / 10) * 10;
  }
}

// ---------------------------------------------------------------------------
// Synthetic buildings for the 3D tilt effect: rectangles inside blocks,
// taller near downtown.
const buildings = [];
for (const bg of blockGroups) {
  const [clng, clat] = bg.centroid;
  const bx = (clng - CENTER[0]) * 111320 * COS;
  const by = (clat - CENTER[1]) * 110540;
  const dDowntown = Math.hypot(bx, by);
  const density = bg.pop + bg.jobs;
  const count = Math.min(14, Math.max(2, Math.round(density / 260)));
  for (let i = 0; i < count; i++) {
    const px = bx - CELL / 2 + 30 + rnd() * (CELL - 90);
    const py = by - CELL / 2 + 30 + rnd() * (CELL - 90);
    if (inRiver(px, py)) continue;
    const w = 18 + rnd() * 42;
    const d = 18 + rnd() * 42;
    let h = 5 + rnd() * 7;
    if (dDowntown < 700) h = 18 + rnd() * 55;
    else if (dDowntown < 1400) h = 9 + rnd() * 18;
    if (Math.hypot(px - IND.x, py - IND.y) < 700) h = 6 + rnd() * 6;
    buildings.push({
      ring: [P(px, py), P(px + w, py), P(px + w, py + d), P(px, py + d)],
      h: Math.round(h),
    });
  }
}

// River polygon + parks
const water = [];
{
  const left = [];
  const right = [];
  for (let y = -HALF * BLOCK - 400; y <= HALF * BLOCK + 400; y += 200) {
    const rx = riverXAt(y);
    left.push(P(rx - 130, y));
    right.push(P(rx + 130, y));
  }
  water.push([...left, ...right.reverse()]);
}
const parks = [
  [P(-500, 300), P(100, 300), P(100, 800), P(-500, 800)], // central park
  [P(-2400, 1400), P(-1900, 1400), P(-1900, 2000), P(-2400, 2000)],
  [P(1300, 900), P(1800, 900), P(1800, 1400), P(1300, 1400)],
];

const extent = HALF * BLOCK + 600; // bbox reaches just past the last street
const pack = {
  meta: {
    id: 'demo',
    name: 'Riverton',
    region: 'Demo City — no download needed',
    kind: 'demo',
    center: CENTER,
    zoom: 12.9,
    bbox: [m2lng(-extent), m2lat(-extent), m2lng(extent), m2lat(extent)],
    calib: { workforceRate: 0.47, gravityBetaKm: 3.2, carSpeedKmh: 34 },
    dataSource: 'Procedurally generated demonstration data',
  },
  blockGroups,
  nodes: outNodes,
  edges: outEdges,
  buildings,
  water,
  parks,
};

const outPath = join(__dirname, '..', 'public', 'cities', 'demo.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(pack));
const pop = blockGroups.reduce((s, b) => s + b.pop, 0);
const jobs = blockGroups.reduce((s, b) => s + b.jobs, 0);
console.log(
  `Riverton: ${outNodes.length} nodes, ${outEdges.length} edges, ${blockGroups.length} block groups, ` +
    `${buildings.length} buildings, pop ${pop}, jobs ${jobs}`,
);
