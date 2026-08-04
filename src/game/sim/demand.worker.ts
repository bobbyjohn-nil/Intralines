// Ridership model, run off-thread. Commuters are generated from census
// residents/jobs with a distance-decay gravity model (the Subway Builder
// approach), then each origin-destination flow picks bus vs car from
// door-to-door travel times. Recomputed whenever the network changes.

import type { LngLat } from '../types';
import {
  DWELL_SEC,
  HOURLY_PROFILE,
  LAYOVER_MIN,
  MAX_WALK_M,
  MAX_WAIT_MIN,
  MODE_TAU,
  CAPTIVE_SHARE,
  SUBSIDY_PER_RIDER,
  TRANSFER_PENALTY_MIN,
  CAR_PARK_PENALTY_MIN,
  WALK_MIN_PER_KM,
  DRIVER_WAGE_PER_HOUR,
} from '../constants';

interface WBlockGroup {
  centroid: LngLat;
  pop: number;
  jobs: number;
}

interface WLine {
  id: string;
  stopIds: string[];
  stopDist: number[];
  pathLenM: number;
  headwayMin: number;
  firstHour: number;
  lastHour: number;
  fare: number;
  capacity: number;
  kmh: number;
  costPerKm: number;
  vehicles: number;
  active: boolean;
}

interface WStop {
  id: string;
  pt: LngLat;
}

interface InitMsg {
  type: 'init';
  blockGroups: WBlockGroup[];
  calib: { workforceRate: number; gravityBetaKm: number; carSpeedKmh: number };
}

interface NetworkMsg {
  type: 'network';
  lines: WLine[];
  stops: WStop[];
  costMult: number;
  reqId: number;
}

let bgs: WBlockGroup[] = [];
let calib = { workforceRate: 0.45, gravityBetaKm: 4, carSpeedKmh: 35 };
let cosLat = 1;
/** T[i*n+j]: daily home(i)->work(j) commuters (gravity), network-independent */
let T: Float32Array | null = null;
let distKm: Float32Array | null = null;

function fastKm(a: LngLat, b: LngLat): number {
  const dx = (b[0] - a[0]) * 111.32 * cosLat;
  const dy = (b[1] - a[1]) * 110.54;
  return Math.sqrt(dx * dx + dy * dy);
}

function buildGravity(): void {
  const n = bgs.length;
  T = new Float32Array(n * n);
  distKm = new Float32Array(n * n);
  const beta = calib.gravityBetaKm;
  for (let i = 0; i < n; i++) {
    const workers = bgs[i].pop * calib.workforceRate;
    if (workers <= 0) continue;
    let denom = 0;
    const row = i * n;
    for (let j = 0; j < n; j++) {
      const d = fastKm(bgs[i].centroid, bgs[j].centroid);
      distKm[row + j] = d;
      if (d > 45) continue;
      const w = bgs[j].jobs * Math.exp(-d / beta);
      T[row + j] = w; // temp: weight
      denom += w;
    }
    if (denom <= 0) continue;
    const scale = workers / denom;
    for (let j = 0; j < n; j++) T[row + j] *= scale;
  }
}

// ---------------------------------------------------------------------------

interface NearStop {
  stopIdx: number;
  walkMin: number;
}

self.onmessage = (ev: MessageEvent<InitMsg | NetworkMsg>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    bgs = msg.blockGroups;
    calib = msg.calib;
    cosLat = bgs.length
      ? Math.cos((bgs[0].centroid[1] * Math.PI) / 180)
      : 1;
    buildGravity();
    (self as unknown as Worker).postMessage({ type: 'ready' });
    return;
  }
  if (msg.type === 'network') {
    const stats = computeNetwork(msg);
    (self as unknown as Worker).postMessage({ type: 'stats', reqId: msg.reqId, stats });
  }
};

function computeNetwork(msg: NetworkMsg) {
  const n = bgs.length;
  const lines = msg.lines.filter((l) => l.active && l.stopIds.length >= 2 && l.vehicles > 0);
  const stops = msg.stops;
  const stopIndex = new Map<string, number>();
  stops.forEach((s, i) => stopIndex.set(s.id, i));

  // per-line derived numbers
  const lineCalc = lines.map((l) => {
    const rideMinFull =
      (l.pathLenM / 1000 / l.kmh) * 60 + (l.stopIds.length - 2) * (DWELL_SEC / 60);
    const cycleMin = 2 * rideMinFull + 2 * LAYOVER_MIN + 2 * (DWELL_SEC / 60);
    const vehiclesNeeded = Math.max(1, Math.ceil(cycleMin / l.headwayMin));
    // short fleet => the schedule stretches
    const headwayEff =
      l.vehicles >= vehiclesNeeded ? l.headwayMin : cycleMin / Math.max(l.vehicles, 1);
    const stopsOnLine = l.stopIds
      .map((sid) => stopIndex.get(sid))
      .filter((x): x is number => x !== undefined);
    return { l, rideMinFull, cycleMin, vehiclesNeeded, headwayEff, stopsOnLine };
  });

  // stop -> lines serving it (with position index on the line)
  const linesAtStop = new Map<number, { li: number; pos: number }[]>();
  lineCalc.forEach((lc, li) => {
    lc.stopsOnLine.forEach((si, pos) => {
      let arr = linesAtStop.get(si);
      if (!arr) {
        arr = [];
        linesAtStop.set(si, arr);
      }
      arr.push({ li, pos });
    });
  });

  // nearest stops per block group (walk catchment)
  const near: NearStop[][] = new Array(n);
  const cell = 0.004;
  const grid = new Map<string, number[]>();
  stops.forEach((s, i) => {
    const k = `${Math.floor(s.pt[0] / cell)}:${Math.floor(s.pt[1] / cell)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });
  const span = Math.ceil((MAX_WALK_M / 111320) * (1 / cell)) + 1;
  for (let i = 0; i < n; i++) {
    const c = bgs[i].centroid;
    const found: NearStop[] = [];
    const gx = Math.floor(c[0] / cell);
    const gy = Math.floor(c[1] / cell);
    for (let x = gx - span; x <= gx + span; x++) {
      for (let y = gy - span; y <= gy + span; y++) {
        const arr = grid.get(`${x}:${y}`);
        if (!arr) continue;
        for (const si of arr) {
          const dKm = fastKm(c, stops[si].pt);
          if (dKm * 1000 <= MAX_WALK_M && linesAtStop.has(si)) {
            found.push({ stopIdx: si, walkMin: dKm * WALK_MIN_PER_KM });
          }
        }
      }
    }
    found.sort((a, b) => a.walkMin - b.walkMin);
    near[i] = found.slice(0, 4);
  }

  // ride time between two stop positions on a line
  const rideMin = (li: number, posA: number, posB: number): number => {
    const lc = lineCalc[li];
    const dM = Math.abs(lc.l.stopDist[posB] - lc.l.stopDist[posA]);
    const stopsBetween = Math.abs(posB - posA) - 1;
    return (dM / 1000 / lc.l.kmh) * 60 + Math.max(0, stopsBetween) * (DWELL_SEC / 60);
  };

  // transfer clusters: stops within a short walk of each other act as one
  // interchange station, so lines crossing at a corner connect even when
  // their curbs are separate stops
  const CLUSTER_M = 130;
  const parent = stops.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let i = 0; i < stops.length; i++) {
    const gx = Math.floor(stops[i].pt[0] / cell);
    const gy = Math.floor(stops[i].pt[1] / cell);
    for (let x = gx - 1; x <= gx + 1; x++) {
      for (let y = gy - 1; y <= gy + 1; y++) {
        const arr = grid.get(`${x}:${y}`);
        if (!arr) continue;
        for (const j of arr) {
          if (j <= i) continue;
          if (fastKm(stops[i].pt, stops[j].pt) * 1000 <= CLUSTER_M) {
            const ri = find(i);
            const rj = find(j);
            if (ri !== rj) parent[ri] = rj;
          }
        }
      }
    }
  }

  // for each ordered line pair, one transfer point (cluster-aware)
  const sharedStop = new Map<number, { posA: number; posB: number; walkMin: number }>();
  const pairKey = (a: number, b: number) => a * 1024 + b;
  const linesAtCluster = new Map<number, { li: number; pos: number; stopIdx: number }[]>();
  linesAtStop.forEach((servers, si) => {
    const c = find(si);
    let arr = linesAtCluster.get(c);
    if (!arr) {
      arr = [];
      linesAtCluster.set(c, arr);
    }
    for (const sv of servers) arr.push({ li: sv.li, pos: sv.pos, stopIdx: si });
  });
  linesAtCluster.forEach((servers) => {
    for (const s1 of servers) {
      for (const s2 of servers) {
        if (s1.li === s2.li) continue;
        const k = pairKey(s1.li, s2.li);
        const walkMin = s1.stopIdx === s2.stopIdx ? 0 : 1.5;
        const prev = sharedStop.get(k);
        if (!prev || walkMin < prev.walkMin) {
          sharedStop.set(k, { posA: s1.pos, posB: s2.pos, walkMin });
        }
      }
    }
  });

  // best transit time between two block groups; returns lines used
  const LINES_LIMIT = 3; // consider up to N lines per stop
  function bestTransit(i: number, j: number): { min: number; l1: number; l2: number } | null {
    const A = near[i];
    const B = near[j];
    if (!A.length || !B.length) return null;
    let best = Infinity;
    let bl1 = -1;
    let bl2 = -1;
    for (const a of A) {
      const aLines = linesAtStop.get(a.stopIdx);
      if (!aLines) continue;
      for (const b of B) {
        if (a.stopIdx === b.stopIdx) continue;
        const bLines = linesAtStop.get(b.stopIdx);
        if (!bLines) continue;
        for (let x = 0; x < Math.min(aLines.length, LINES_LIMIT); x++) {
          const la = aLines[x];
          const waitA = Math.min(lineCalc[la.li].headwayEff / 2, MAX_WAIT_MIN);
          for (let y = 0; y < Math.min(bLines.length, LINES_LIMIT); y++) {
            const lb = bLines[y];
            if (la.li === lb.li) {
              // direct
              const t =
                a.walkMin + waitA + rideMin(la.li, la.pos, lb.pos) + b.walkMin;
              if (t < best) {
                best = t;
                bl1 = la.li;
                bl2 = -1;
              }
            } else {
              const sh = sharedStop.get(pairKey(la.li, lb.li));
              if (!sh) continue;
              const t =
                a.walkMin +
                waitA +
                rideMin(la.li, la.pos, sh.posA) +
                TRANSFER_PENALTY_MIN +
                sh.walkMin +
                Math.min(lineCalc[lb.li].headwayEff / 2, MAX_WAIT_MIN) +
                rideMin(lb.li, sh.posB, lb.pos) +
                b.walkMin;
              if (t < best) {
                best = t;
                bl1 = la.li;
                bl2 = lb.li;
              }
            }
          }
        }
      }
    }
    return isFinite(best) ? { min: best, l1: bl1, l2: bl2 } : null;
  }

  // main OD sweep
  const boardings = new Float64Array(lineCalc.length);
  let totalRiders = 0;
  let weightedWait = 0;
  if (T && distKm) {
    for (let i = 0; i < n; i++) {
      if (!near[i].length) continue;
      const row = i * n;
      for (let j = 0; j < n; j++) {
        const flow = T[row + j];
        if (flow < 0.5 || i === j) continue;
        const bt = bestTransit(i, j);
        if (!bt || bt.min > 75) continue;
        const dKm = distKm[row + j];
        const carMin = (dKm / calib.carSpeedKmh) * 60 * 1.3 + CAR_PARK_PENALTY_MIN;
        const walkOnlyMin = dKm * WALK_MIN_PER_KM;
        // when walking beats the bus, most (not all) of those trips walk
        let walkFactor = 1;
        if (walkOnlyMin < bt.min * 0.75) walkFactor = 0.15;
        else if (walkOnlyMin < bt.min) walkFactor = 0.45;
        const auto = 0.92 / (1 + Math.exp((bt.min - carMin) / MODE_TAU));
        const share = Math.min(
          0.9,
          (CAPTIVE_SHARE + (1 - CAPTIVE_SHARE) * auto) * walkFactor,
        );
        if (share < 0.01) continue;
        const riders = flow * share; // one-way commuters choosing the bus
        totalRiders += riders * 2; // round trips
        weightedWait += riders * 2 * Math.min(lineCalc[bt.l1].headwayEff / 2, MAX_WAIT_MIN);
        boardings[bt.l1] += riders * 2;
        if (bt.l2 >= 0) boardings[bt.l2] += riders * 2;
      }
    }
  }

  // service-window scaling + per-line stats
  const perLine = lineCalc.map((lc, li) => {
    const { l } = lc;
    const windowShare = HOURLY_PROFILE.slice(l.firstHour, l.lastHour).reduce(
      (s, v) => s + v,
      0,
    );
    let daily = boardings[li] * windowShare;

    // crowding: peak-hour demand vs offered capacity (both directions)
    const peakShare = Math.max(...HOURLY_PROFILE.slice(l.firstHour, l.lastHour), 0.01);
    const peakRiders = daily * peakShare;
    const tripsPerHour = 60 / lc.headwayEff;
    const offered = tripsPerHour * l.capacity * 2;
    const loadFactor = offered > 0 ? peakRiders / offered : 0;
    if (loadFactor > 1) daily *= Math.sqrt(1 / loadFactor); // riders give up

    const hourly = HOURLY_PROFILE.map((p, h) =>
      h >= l.firstHour && h < l.lastHour ? (daily * p) / windowShare : 0,
    );

    const serviceMin = (l.lastHour - l.firstHour) * 60;
    const cyclesPerDay = serviceMin / lc.headwayEff;
    const vkmPerDay = (cyclesPerDay * 2 * l.pathLenM) / 1000;
    const driverHours = Math.min(l.vehicles, lc.vehiclesNeeded) * (serviceMin / 60);
    const dailyCost =
      vkmPerDay * l.costPerKm * msg.costMult + driverHours * DRIVER_WAGE_PER_HOUR;

    return {
      lineId: l.id,
      dailyBoardings: Math.round(daily),
      hourly,
      peakLoadFactor: Math.min(loadFactor, 2),
      dailyRevenue: daily * (l.fare + SUBSIDY_PER_RIDER),
      dailyCost,
      vehiclesNeeded: lc.vehiclesNeeded,
      cycleMin: lc.cycleMin,
      headwayEffMin: lc.headwayEff,
      vehiclesUsed: Math.min(l.vehicles, lc.vehiclesNeeded),
    };
  });

  // coverage: residents within walk of any served stop
  let covered = 0;
  let totalPop = 0;
  for (let i = 0; i < n; i++) {
    totalPop += bgs[i].pop;
    if (near[i].length) covered += bgs[i].pop;
  }

  const totalDaily = perLine.reduce((s, p) => s + p.dailyBoardings, 0);
  const avgWait = totalRiders > 0 ? weightedWait / totalRiders : 10;
  const avgLoad =
    perLine.length > 0
      ? perLine.reduce((s, p) => s + Math.min(p.peakLoadFactor, 1.4), 0) / perLine.length
      : 0;
  const coveragePct = totalPop > 0 ? (covered / totalPop) * 100 : 0;
  const satisfaction = Math.max(
    0,
    Math.min(
      100,
      coveragePct * 0.45 +
        (1 - Math.min(avgWait, 20) / 20) * 35 +
        (1 - Math.min(avgLoad, 1.4) / 1.4) * 20,
    ),
  );

  return {
    coveragePct,
    totalDailyRiders: totalDaily,
    satisfaction,
    perLine,
  };
}
