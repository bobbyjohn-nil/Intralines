import { create } from 'zustand';
import type {
  BusLine, CityPack, Depot, FleetEntry, LngLat, NetworkStats, ReportCard, ReportScore,
  SaveGame, Staff, Stop, Tool,
} from './types';
import {
  BUS_MODELS, DEPOT_CAPACITY, DEPOT_UPGRADE_COST, DEPOT_UPKEEP_PER_DAY,
  BUSES_PER_MECHANIC, CHARGERS_COST, FLEET_TIER_CAP, FLEET_TIER_COST, FLEET_TIER_NAMES,
  FLEET_UPGRADE_COST_SHARE, HEADWAY_CHOICES, LINE_COLORS, LOAN_AMOUNT, MAX_DEPOTS,
  LOAN_FEE, LOAN_PAYOFF, LOAN_WEEKLY_INTEREST, MECHANIC_WAGE_PER_DAY,
  nextDepotCost, OFFICE_OVERHEAD_PER_DAY, QUARTER_MIN, REFURB_COST_SHARE, REPORT_FINE,
  REPORT_GRANT_PER_POINT, SAVE_KEY_PREFIX,
  SAVE_VERSION, SPEEDS, START_CASH, STOP_COST, STOP_MAX_KMH, STOP_TIER_NAMES,
  STOP_UPGRADE_COST, SUBSIDY_PER_RIDER, WASH_BAY_COST, WEAR_COST_PENALTY, WEAR_PER_DAY,
  WORKSHOP_COST,
} from './constants';
import { RoadGraph, cumulativeDist } from './routing';
import { fastDistM } from './geo';

export interface DraftLeg {
  path: LngLat[];
  lenM: number;
}

export interface DraftLine {
  stops: Stop[]; // mix of existing and new stops
  legs: DraftLeg[]; // legs[i] connects stops[i] -> stops[i+1]
}

export type Panel =
  | 'none' | 'lines' | 'line-edit' | 'fleet' | 'staff' | 'depot' | 'finance' | 'help'
  | 'map-options' | 'report';

export interface Notice {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'bad';
}

interface ClockRef {
  min: number;
  realMs: number;
  rate: number; // game minutes per real second (0 when paused)
}

export interface GameState {
  phase: 'menu' | 'loading' | 'playing';
  loadingMsg: string;
  loadingDetail: string;
  pack: CityPack | null;
  graph: RoadGraph | null;

  cash: number;
  clockMin: number;
  clockRef: ClockRef;
  speedIdx: number;
  paused: boolean;

  stops: Stop[];
  lines: BusLine[];
  depots: Depot[];
  staff: Staff;
  fleet: FleetEntry[];
  totalRidersServed: number;
  loanTaken: boolean;
  reports: ReportCard[];
  /** hire a driver automatically with every bus purchase */
  autoHireDriver: boolean;

  stats: NetworkStats | null;
  tool: Tool;
  draft: DraftLine | null;
  selectedLineId: string | null;
  panel: Panel;
  heatmap: 'off' | 'pop' | 'jobs' | 'tour' | 'edu' | 'modes';
  notices: Notice[];
  mapEpoch: number; // bumped when overlays must refresh
  /** 'auto' = online basemap tiles when reachable; 'offline' = never phone home */
  basemapPref: 'auto' | 'offline';
  /** station name labels: only when zoomed right in, or always */
  stopLabels: 'zoom' | 'always';
  /** what the map actually used this session (for the toggle button icon) */
  basemapActive: 'online' | 'offline';
  /** city-load failure shown on the menu (survives the menu remounting) */
  menuError: string | null;
  /** stop waiting for a relocation click while the route editor is active */
  moveStopId: string | null;

  // actions
  openCity: (pack: CityPack) => void;
  backToMenu: () => void;
  setLoading: (msg: string, detail?: string) => void;
  tick: (realDtSec: number) => void;
  setSpeed: (idx: number) => void;
  togglePause: () => void;
  setTool: (t: Tool) => void;
  setPanel: (p: Panel) => void;
  setHeatmap: (h: 'off' | 'pop' | 'jobs' | 'tour' | 'edu' | 'modes') => void;
  toggleBasemap: () => void;
  setBasemapActive: (m: 'online' | 'offline') => void;
  setStopLabels: (mode: 'zoom' | 'always') => void;
  setMenuError: (e: string | null) => void;
  mapClick: (pt: LngLat) => void;
  undoDraftStop: () => void;
  cancelDraft: () => void;
  finishDraft: () => void;
  selectLine: (id: string | null) => void;
  updateLine: (id: string, patch: Partial<BusLine>) => void;
  deleteLine: (id: string) => void;
  buyBus: (modelId: string) => void;
  sellBus: (modelId: string) => void;
  refurbishFleet: (modelId: string) => void;
  upgradeFleetModel: (modelId: string) => void;
  setAutoHireDriver: (v: boolean) => void;
  hire: (role: keyof Staff) => void;
  fire: (role: keyof Staff) => void;
  buildDepot: (pt: LngLat) => void;
  upgradeDepot: (depotId: string) => void;
  renameDepot: (depotId: string, name: string) => void;
  upgradeStop: (stopId: string) => void;
  removeStopFromLine: (lineId: string, stopId: string) => void;
  requestMoveStop: (stopId: string | null) => void;
  buyDepotAddon: (depotId: string, addon: 'workshop' | 'washBay' | 'chargers') => void;
  takeLoan: () => void;
  repayLoan: () => void;
  notify: (text: string, kind?: Notice['kind']) => void;
  dismissNotice: (id: number) => void;
  saveGame: () => void;
  exportSave: () => string;
  importSave: (json: string) => boolean;
}

let worker: Worker | null = null;
let reqSeq = 0;
let recomputeTimer: ReturnType<typeof setTimeout> | null = null;
let noticeSeq = 0;
let lineSeq = 0;
let stopSeq = 0;
let depotSeq = 0;

function makeWorker(pack: CityPack, onStats: (stats: NetworkStats) => void): Worker {
  const w = new Worker(new URL('./sim/demand.worker.ts', import.meta.url), {
    type: 'module',
  });
  w.postMessage({
    type: 'init',
    blockGroups: pack.blockGroups.map((b) => ({
      centroid: b.centroid,
      pop: b.pop,
      jobs: b.jobs,
    })),
    calib: pack.meta.calib,
  });
  w.onmessage = (ev) => {
    if (ev.data.type === 'stats' && ev.data.reqId === reqSeq) onStats(ev.data.stats);
  };
  return w;
}

export function fleetOwned(fleet: FleetEntry[], modelId: string): number {
  return fleet.find((f) => f.modelId === modelId)?.count ?? 0;
}

export function fleetTotal(fleet: FleetEntry[]): number {
  return fleet.reduce((s, f) => s + f.count, 0);
}

export function fleetAssigned(lines: BusLine[], modelId?: string): number {
  return lines.reduce(
    (s, l) => s + (modelId === undefined || l.modelId === modelId ? l.vehicles : 0),
    0,
  );
}

export function driversNeeded(lines: BusLine[]): number {
  return lines.reduce((s, l) => s + (l.active ? l.vehicles : 0), 0);
}

export function busModel(id: string) {
  return BUS_MODELS.find((m) => m.id === id) ?? BUS_MODELS[0];
}

/** total bus parking across every depot the player owns */
export function depotCapacity(depots: Depot[]): number {
  return depots.reduce((sum, d) => sum + (DEPOT_CAPACITY[d.level] ?? 0), 0);
}

/** capacity / running-cost multipliers for a model group (tier + wear) */
export function fleetPerf(
  fleet: FleetEntry[],
  modelId: string,
): { capMult: number; costMult: number; wear: number; tier: number } {
  const e = fleet.find((f) => f.modelId === modelId);
  const tier = e?.tier ?? 1;
  const wear = e?.wear ?? 0;
  return {
    capMult: FLEET_TIER_CAP[tier] ?? 1,
    costMult: (FLEET_TIER_COST[tier] ?? 1) * (1 + (wear / 100) * WEAR_COST_PENALTY),
    wear,
    tier,
  };
}

/** letter grade for a 0..100 report score */
export function gradeOf(score: number): string {
  return score >= 93 ? 'A+' : score >= 85 ? 'A' : score >= 78 ? 'B+' : score >= 70 ? 'B'
    : score >= 62 ? 'C+' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
}

const clamp100 = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

/** the Transit Authority's quarterly grading rubric */
function buildReportCard(s: GameState, quarter: number): ReportCard {
  const activeLines = s.lines.filter((l) => l.active && l.vehicles > 0);

  // Coverage — how much of the city can reach a stop
  const coverage = clamp100(s.stats?.coveragePct ?? 0);

  // Connectivity — do the lines form one network you can transfer across?
  let connectivity = 0;
  if (s.lines.length) {
    const stopLines = new Map<string, string[]>();
    for (const l of s.lines) {
      for (const sid of l.stopIds) {
        (stopLines.get(sid) ?? stopLines.set(sid, []).get(sid)!).push(l.id);
      }
    }
    // union-find over lines that share a stop
    const parent = new Map<string, string>(s.lines.map((l) => [l.id, l.id]));
    const find = (x: string): string => {
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)!)!);
        x = parent.get(x)!;
      }
      return x;
    };
    for (const ids of stopLines.values()) {
      for (let i = 1; i < ids.length; i++) parent.set(find(ids[i]), find(ids[0]));
    }
    const compSize = new Map<string, number>();
    for (const l of s.lines) {
      const r = find(l.id);
      compSize.set(r, (compSize.get(r) ?? 0) + 1);
    }
    const largest = Math.max(...compSize.values());
    const transferStops = [...stopLines.values()].filter((ids) => ids.length >= 2).length;
    connectivity = clamp100(
      (largest / s.lines.length) * 60 * Math.min(1, s.lines.length / 3) +
        Math.min(1, (transferStops / Math.max(s.stops.length, 1)) * 4) * 40,
    );
  }

  // Passenger happiness — straight from the satisfaction model
  const passengers = clamp100(s.stats?.satisfaction ?? 0);

  // Staff happiness — shortages mean overworked crews
  const needD = driversNeeded(s.lines);
  const needM = Math.ceil(fleetTotal(s.fleet) / BUSES_PER_MECHANIC);
  let staff = 100;
  if (needD === 0 && needM === 0) staff = 60; // nobody works here yet
  if (needD > 0 && s.staff.drivers < needD) staff -= 55 * ((needD - s.staff.drivers) / needD);
  if (needM > 0 && s.staff.mechanics < needM) staff -= 45 * ((needM - s.staff.mechanics) / needM);
  staff = clamp100(staff);

  // Safety — worn buses and missing mechanics are how accidents happen
  const total = fleetTotal(s.fleet);
  let safety = 60; // no fleet: nothing on the road to be unsafe
  if (total > 0) {
    const avgWear = s.fleet.reduce((sum, f) => sum + f.wear * f.count, 0) / total;
    safety = 100 - avgWear * 0.65;
    if (needM > 0 && s.staff.mechanics < needM) {
      safety -= 25 * ((needM - s.staff.mechanics) / needM);
    }
  }
  safety = clamp100(safety);

  // Reliability — are scheduled headways actually being run?
  let reliability = 0;
  if (activeLines.length && s.stats) {
    let sum = 0;
    let n = 0;
    for (const pl of s.stats.perLine) {
      const l = activeLines.find((x) => x.id === pl.lineId);
      if (!l || pl.headwayEffMin <= 0) continue;
      sum += Math.min(1, l.headwayMin / pl.headwayEffMin);
      n++;
    }
    reliability = n ? clamp100((sum / n) * 100) : 0;
  }

  // Environment — bus mode share and electric buses
  let environment = 20;
  if (total > 0) {
    const elec = s.fleet
      .filter((f) => busModel(f.modelId).needsCharger)
      .reduce((sum, f) => sum + f.count, 0);
    let busShare = 0;
    if (s.stats?.bgModes?.length) {
      let bus = 0;
      let all = 0;
      for (const m of s.stats.bgModes) {
        bus += m.bus;
        all += m.bus + m.car + m.walk + m.bike;
      }
      busShare = all > 0 ? bus / all : 0;
    }
    environment = clamp100(45 * Math.min(1, busShare / 0.12) + 55 * (elec / total));
  }

  const scores: ReportScore[] = [
    { key: 'coverage', label: 'Network coverage', score: coverage },
    { key: 'connectivity', label: 'Connectability', score: connectivity },
    { key: 'passengers', label: 'Passenger happiness', score: passengers },
    { key: 'staff', label: 'Staff happiness', score: staff },
    { key: 'safety', label: 'Safety', score: safety },
    { key: 'reliability', label: 'Reliability', score: reliability },
    { key: 'environment', label: 'Environment', score: environment },
  ];
  const weights: Record<string, number> = {
    coverage: 0.2, connectivity: 0.15, passengers: 0.2, staff: 0.15,
    safety: 0.15, reliability: 0.1, environment: 0.05,
  };
  const overall = clamp100(
    scores.reduce((sum, sc) => sum + sc.score * (weights[sc.key] ?? 0), 0),
  );
  const payout =
    overall >= 55
      ? Math.round((overall - 55) * REPORT_GRANT_PER_POINT)
      : overall < 35
        ? -REPORT_FINE
        : 0;
  return { quarter, issuedAtMin: s.clockMin, scores, overall, payout };
}

/** street-following geometry for an ordered stop sequence (null = unroutable) */
function computeLinePath(
  graph: RoadGraph,
  stopsById: Map<string, Stop>,
  stopIds: string[],
  cosLat: number,
): Pick<BusLine, 'path' | 'cum' | 'stopDist' | 'pathLenM'> | null {
  if (stopIds.length < 2) return null;
  const path: LngLat[] = [];
  const stopDist = [0];
  let acc = 0;
  for (let i = 1; i < stopIds.length; i++) {
    const a = stopsById.get(stopIds[i - 1]);
    const b = stopsById.get(stopIds[i]);
    if (!a || !b) return null;
    const r = graph.route(a.node, b.node);
    if (!r || r.path.length < 2) return null;
    if (!path.length) path.push(...r.path);
    else for (let k = 1; k < r.path.length; k++) path.push(r.path[k]);
    acc += r.lenM;
    stopDist.push(acc);
  }
  return { path, cum: cumulativeDist(path, cosLat), stopDist, pathLenM: acc };
}

/** where a new stop fits best into an existing line (0..n insertion index) */
function bestInsertIndex(line: BusLine, pt: LngLat, cosLat: number): number {
  let bestLeg = 0;
  let bestD = Infinity;
  let leg = 0;
  for (let i = 0; i < line.path.length; i++) {
    while (leg < line.stopDist.length - 2 && line.cum[i] > line.stopDist[leg + 1] + 1) leg++;
    const d = fastDistM(line.path[i], pt, cosLat);
    if (d < bestD) {
      bestD = d;
      bestLeg = leg;
    }
  }
  // clicks out past a terminal extend the line instead of kinking the end leg
  const dStart = fastDistM(line.path[0], pt, cosLat);
  const dEnd = fastDistM(line.path[line.path.length - 1], pt, cosLat);
  if (dStart <= bestD + 1) return 0;
  if (dEnd <= bestD + 1) return line.stopIds.length;
  return bestLeg + 1;
}

export const useGame = create<GameState>((set, get) => {
  function scheduleRecompute(): void {
    if (recomputeTimer) clearTimeout(recomputeTimer);
    recomputeTimer = setTimeout(() => {
      const s = get();
      if (!worker || !s.pack) return;
      reqSeq++;
      const mechanicsNeeded = Math.ceil(fleetTotal(s.fleet) / BUSES_PER_MECHANIC);
      let costMult = 1;
      if (s.depots.some((d) => d.workshop)) costMult *= 0.75;
      if (s.staff.mechanics < mechanicsNeeded) costMult *= 1.4;

      // driver shortage degrades newest lines first
      let driversLeft = s.staff.drivers;
      const effectiveVehicles = new Map<string, number>();
      for (const l of s.lines) {
        if (!l.active || !s.depots.length) {
          effectiveVehicles.set(l.id, 0);
          continue;
        }
        const v = Math.min(l.vehicles, driversLeft);
        driversLeft -= v;
        effectiveVehicles.set(l.id, v);
      }

      worker.postMessage({
        type: 'network',
        reqId: reqSeq,
        costMult,
        stops: s.stops.map((st) => ({ id: st.id, pt: st.pt, tier: st.tier ?? 1 })),
        lines: s.lines.map((l) => {
          const m = busModel(l.modelId);
          const perf = fleetPerf(s.fleet, l.modelId);
          return {
            id: l.id,
            stopIds: l.stopIds,
            stopDist: l.stopDist,
            pathLenM: l.pathLenM,
            headwayMin: l.headwayMin,
            firstHour: l.firstHour,
            lastHour: l.lastHour,
            fare: l.fare,
            capacity: Math.round(m.capacity * perf.capMult),
            kmh: m.kmh,
            costPerKm: m.costPerKm * perf.costMult,
            vehicles: effectiveVehicles.get(l.id) ?? 0,
            active: l.active && s.depots.length > 0,
          };
        }),
      });
    }, 250);
  }

  function touchNetwork(): void {
    set((s) => ({ mapEpoch: s.mapEpoch + 1 }));
    scheduleRecompute();
  }

  return {
    phase: 'menu',
    loadingMsg: '',
    loadingDetail: '',
    pack: null,
    graph: null,

    cash: START_CASH,
    clockMin: 6 * 60, // Monday 06:00
    clockRef: { min: 6 * 60, realMs: 0, rate: 0 },
    speedIdx: 0,
    paused: false,

    stops: [],
    lines: [],
    depots: [],
    staff: { drivers: 0, mechanics: 0 },
    fleet: [],
    totalRidersServed: 0,
    loanTaken: false,
    reports: [],
    autoHireDriver:
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('intralines-auto-driver') === '1',

    stats: null,
    tool: 'select',
    draft: null,
    selectedLineId: null,
    panel: 'help',
    heatmap: 'off',
    notices: [],
    mapEpoch: 0,
    basemapPref:
      (typeof localStorage !== 'undefined' &&
        (localStorage.getItem('intralines-basemap') as 'auto' | 'offline')) ||
      'auto',
    stopLabels:
      (typeof localStorage !== 'undefined' &&
        (localStorage.getItem('intralines-stop-labels') as 'zoom' | 'always')) ||
      'zoom',
    basemapActive: 'offline',
    menuError: null,
    moveStopId: null,

    openCity: (pack) => {
      worker?.terminate();
      worker = makeWorker(pack, (stats) => {
        set({ stats });
      });
      const graph = new RoadGraph(pack);
      const saved = localStorage.getItem(SAVE_KEY_PREFIX + pack.meta.id);
      let base: Partial<GameState> = {};
      if (saved) {
        try {
          const sv = JSON.parse(saved) as SaveGame;
          if (sv.version === SAVE_VERSION && sv.cityId === pack.meta.id) {
            // node indexes don't survive across sessions (stops may split
            // streets); re-anchor each saved stop into the fresh graph
            for (const st of sv.stops) {
              const node = graph.insertStopNode(st.pt, 240, STOP_MAX_KMH);
              if (node !== null) {
                st.node = node;
                st.pt = graph.pack.nodes[node];
                if (/^Stop \d+$/.test(st.name)) {
                  st.name = graph.stopNameAt(node) ?? st.name;
                }
              }
              // saves from before stops cost money
              st.tier = st.tier ?? 1;
              st.invested = st.invested ?? STOP_COST;
            }
            // saves from before multi-depot support carry a single depot
            const depots = sv.depots ?? (sv.depot ? [sv.depot] : []);
            depots.forEach((d, i) => {
              const dn = graph.nearestNode(d.pt, 400);
              if (dn !== null) d.node = dn;
              d.id = d.id ?? `d${i + 1}`;
              d.name =
                d.name ??
                (graph.stopNameAt(d.node)
                  ? `${graph.stopNameAt(d.node)} Depot`
                  : `Depot ${i + 1}`);
            });
            base = {
              cash: sv.cash,
              clockMin: sv.clockMin,
              stops: sv.stops,
              lines: sv.lines,
              depots,
              staff: sv.staff,
              // saves from before wear ratings and report cards
              fleet: sv.fleet.map((f) => ({
                ...f,
                wear: f.wear ?? 0,
                tier: f.tier ?? 1,
              })),
              totalRidersServed: sv.totalRidersServed,
              loanTaken: sv.loanTaken,
              reports: sv.reports ?? [],
            };
            lineSeq = sv.lines.length + 1;
            stopSeq = sv.stops.length + 1;
            depotSeq = depots.reduce(
              (mx, d) => Math.max(mx, parseInt(d.id.slice(1), 10) || 0),
              0,
            );
          }
        } catch {
          // corrupt save — start fresh
        }
      }
      set({
        phase: 'playing',
        pack,
        graph,
        cash: START_CASH,
        clockMin: 6 * 60,
        speedIdx: 0,
        paused: false,
        stops: [],
        lines: [],
        depots: [],
        staff: { drivers: 0, mechanics: 0 },
        fleet: [],
        totalRidersServed: 0,
        loanTaken: false,
        reports: [],
        stats: null,
        tool: 'select',
        draft: null,
        selectedLineId: null,
        panel: saved ? 'none' : 'help',
        heatmap: 'off',
        mapEpoch: 0,
        ...base,
      });
      const st = get();
      set({ clockRef: { min: st.clockMin, realMs: performance.now(), rate: SPEEDS[0].gameMinPerSec } });
      scheduleRecompute();
    },

    backToMenu: () => {
      get().saveGame();
      worker?.terminate();
      worker = null;
      set({ phase: 'menu', pack: null, graph: null, stats: null, draft: null });
    },

    setLoading: (msg, detail = '') =>
      set({ phase: msg ? 'loading' : 'menu', loadingMsg: msg, loadingDetail: detail }),

    tick: (realDtSec) => {
      const s = get();
      if (s.phase !== 'playing' || s.paused) return;
      const rate = SPEEDS[s.speedIdx].gameMinPerSec;
      const dtMin = realDtSec * rate;
      const newClock = s.clockMin + dtMin;
      const hour = Math.floor(newClock / 60) % 24;

      let dCash = 0;
      let dRiders = 0;
      if (s.stats) {
        for (const pl of s.stats.perLine) {
          const line = s.lines.find((l) => l.id === pl.lineId);
          if (!line) continue;
          const perMinRiders = pl.hourly[hour] / 60;
          dRiders += perMinRiders * dtMin;
          dCash += perMinRiders * dtMin * (line.fare + SUBSIDY_PER_RIDER);
          const svcMin = (line.lastHour - line.firstHour) * 60;
          if (hour >= line.firstHour && hour < line.lastHour && svcMin > 0) {
            dCash -= (pl.dailyCost / svcMin) * dtMin;
          }
        }
      }
      // fixed daily costs, spread across all minutes
      let fixedPerDay = OFFICE_OVERHEAD_PER_DAY;
      for (const d of s.depots) fixedPerDay += DEPOT_UPKEEP_PER_DAY[d.level] ?? 0;
      fixedPerDay += s.staff.mechanics * MECHANIC_WAGE_PER_DAY;
      if (s.loanTaken) fixedPerDay += LOAN_WEEKLY_INTEREST / 7;
      dCash -= (fixedPerDay / 1440) * dtMin;

      const prevTotal = s.totalRidersServed;
      const newTotal = prevTotal + dRiders;
      for (const m of BUS_MODELS) {
        if (m.unlockRiders > 0 && prevTotal < m.unlockRiders && newTotal >= m.unlockRiders) {
          get().notify(`${m.name} unlocked — check the Fleet panel.`, 'good');
        }
      }

      // buses in service wear down; short mechanics speed it up, a workshop
      // slows it. Running costs re-derive when a group crosses a 10% band.
      let fleet = s.fleet;
      let wearBand = false;
      const wornOut: string[] = [];
      if (s.fleet.length) {
        const needM = Math.ceil(fleetTotal(s.fleet) / BUSES_PER_MECHANIC);
        const mechFactor = s.staff.mechanics < needM ? 1.5 : 1;
        const shopFactor = s.depots.some((d) => d.workshop) ? 0.75 : 1;
        let changed = false;
        fleet = s.fleet.map((f) => {
          const inService = s.lines.reduce(
            (sum, l) => sum + (l.active && l.modelId === f.modelId ? l.vehicles : 0),
            0,
          );
          const use = f.count ? Math.min(1, inService / f.count) : 0;
          if (use === 0 || f.wear >= 100) return f;
          const wear = Math.min(
            100,
            f.wear + (WEAR_PER_DAY * use * mechFactor * shopFactor * dtMin) / 1440,
          );
          if (wear === f.wear) return f;
          changed = true;
          if (Math.floor(f.wear / 10) !== Math.floor(wear / 10)) wearBand = true;
          if (f.wear < 70 && wear >= 70) wornOut.push(f.modelId);
          return { ...f, wear };
        });
        if (!changed) fleet = s.fleet;
      }

      set({
        clockMin: newClock,
        clockRef: { min: newClock, realMs: performance.now(), rate },
        cash: s.cash + dCash,
        totalRidersServed: newTotal,
        fleet,
      });
      if (wearBand) scheduleRecompute();
      for (const id of wornOut) {
        get().notify(
          `Your ${busModel(id).name}s are looking ragged — refurbish them in the Fleet panel.`,
          'bad',
        );
      }

      // the Transit Authority grades the network every 4 game weeks
      if (Math.floor(newClock / QUARTER_MIN) !== Math.floor(s.clockMin / QUARTER_MIN)) {
        const st = get();
        const card = buildReportCard(st, st.reports.length + 1);
        set({
          reports: [...st.reports, card],
          cash: st.cash + card.payout,
        });
        const g = gradeOf(card.overall);
        get().notify(
          card.payout > 0
            ? `Q${card.quarter} report card: ${g} overall — ` +
                `$${Math.round(card.payout / 1000)}k Transit Authority grant.`
            : card.payout < 0
              ? `Q${card.quarter} report card: ${g} overall — ` +
                  `$${Math.round(-card.payout / 1000)}k non-compliance fee.`
              : `Q${card.quarter} report card: ${g} overall.`,
          card.payout > 0 ? 'good' : card.payout < 0 ? 'bad' : 'info',
        );
        get().saveGame();
      }

      // autosave every ~2 game hours
      if (Math.floor(newClock / 120) !== Math.floor(s.clockMin / 120)) get().saveGame();
    },

    setSpeed: (idx) => {
      const s = get();
      set({
        speedIdx: idx,
        paused: false,
        clockRef: { min: s.clockMin, realMs: performance.now(), rate: SPEEDS[idx].gameMinPerSec },
      });
    },

    togglePause: () => {
      const s = get();
      const paused = !s.paused;
      set({
        paused,
        clockRef: {
          min: s.clockMin,
          realMs: performance.now(),
          rate: paused ? 0 : SPEEDS[s.speedIdx].gameMinPerSec,
        },
      });
    },

    setTool: (t) => {
      const s = get();
      if (t === 'line-new' && !s.depots.length) {
        get().notify('Build a depot first — your buses need a home.', 'bad');
        return;
      }
      set({
        tool: t,
        draft: t === 'line-new' ? { stops: [], legs: [] } : null,
        panel: t === 'line-new' ? 'line-edit' : s.panel,
        moveStopId: t === 'route-edit' ? s.moveStopId : null,
      });
    },

    setPanel: (p) => set({ panel: p }),
    setHeatmap: (h) => set({ heatmap: h }),

    toggleBasemap: () => {
      const pref = get().basemapPref === 'auto' ? 'offline' : 'auto';
      try {
        localStorage.setItem('intralines-basemap', pref);
      } catch {
        // fine
      }
      set({ basemapPref: pref });
    },

    setBasemapActive: (m) => set({ basemapActive: m }),

    setStopLabels: (mode) => {
      try {
        localStorage.setItem('intralines-stop-labels', mode);
      } catch {
        // fine
      }
      set({ stopLabels: mode });
    },

    setMenuError: (e) => set({ menuError: e }),

    mapClick: (pt) => {
      const s = get();
      if (!s.graph || !s.pack) return;

      if (s.tool === 'depot-place') {
        get().buildDepot(pt);
        return;
      }

      if (s.tool === 'route-edit') {
        const line = s.lines.find((l) => l.id === s.selectedLineId);
        if (!line) {
          set({ tool: 'select', moveStopId: null });
          return;
        }
        const cosLat = Math.cos((s.pack.meta.center[1] * Math.PI) / 180);

        if (s.moveStopId) {
          // relocate the chosen stop to the clicked street
          const stop = s.stops.find((x) => x.id === s.moveStopId);
          if (!stop) {
            set({ moveStopId: null });
            return;
          }
          const node = s.graph.insertStopNode(pt, 240, STOP_MAX_KMH);
          if (node === null) {
            const kmh = s.graph.speedNear(pt, 240);
            get().notify(
              kmh !== null && kmh > STOP_MAX_KMH
                ? "Buses can't stop on a highway — pick a regular street."
                : 'Too far from a road — click closer to a street.',
              'bad',
            );
            return;
          }
          if (s.stops.some((x) => x.id !== stop.id && x.node === node)) {
            get().notify('There is already a stop there.', 'bad');
            return;
          }
          const moved: Stop = {
            ...stop,
            node,
            pt: s.graph.pack.nodes[node],
            name: s.graph.stopNameAt(node) ?? stop.name,
          };
          const stops = s.stops.map((x) => (x.id === stop.id ? moved : x));
          const sm = new Map(stops.map((x) => [x.id, x]));
          const affected = s.lines.filter((l) => l.stopIds.includes(stop.id));
          const patches = new Map<string, ReturnType<typeof computeLinePath>>();
          for (const l of affected) {
            const geo = computeLinePath(s.graph, sm, l.stopIds, cosLat);
            if (!geo) {
              get().notify(`No street path for ${l.name} with the stop there.`, 'bad');
              return;
            }
            patches.set(l.id, geo);
          }
          set({
            stops,
            lines: s.lines.map((l) => {
              const geo = patches.get(l.id);
              return geo ? { ...l, ...geo } : l;
            }),
            moveStopId: null,
          });
          touchNetwork();
          get().notify(
            `${moved.name} moved` +
              (affected.length > 1 ? ` — ${affected.length} lines rerouted.` : '.'),
            'good',
          );
          get().saveGame();
          return;
        }

        // add a stop: reuse one nearby, otherwise build a new one ($4k)
        let stop: Stop | null = null;
        for (const ex of s.stops) {
          if (fastDistM(ex.pt, pt, cosLat) < 35) {
            stop = ex;
            break;
          }
        }
        let isNew = false;
        if (!stop) {
          if (s.cash < STOP_COST) {
            get().notify(
              `Building a stop costs $${(STOP_COST / 1000).toFixed(0)}k — not enough cash.`,
              'bad',
            );
            return;
          }
          const node = s.graph.insertStopNode(pt, 240, STOP_MAX_KMH);
          if (node === null) {
            const kmh = s.graph.speedNear(pt, 240);
            get().notify(
              kmh !== null && kmh > STOP_MAX_KMH
                ? "Buses can't stop on a highway — pick a regular street."
                : 'Too far from a road — click closer to a street.',
              'bad',
            );
            return;
          }
          stop = s.stops.find((x) => x.node === node) ?? null;
          if (!stop) {
            const streetName = s.graph.stopNameAt(node);
            stop = {
              id: `s${stopSeq++}`,
              name: streetName ?? `Stop ${stopSeq}`,
              node,
              pt: s.graph.pack.nodes[node],
              tier: 1,
              invested: STOP_COST,
            };
            isNew = true;
          }
        }
        if (line.stopIds.includes(stop.id)) {
          get().notify(`${stop.name} is already on ${line.name}.`, 'bad');
          return;
        }
        const idx = bestInsertIndex(line, stop.pt, cosLat);
        const stopIds = [...line.stopIds];
        stopIds.splice(idx, 0, stop.id);
        const allStops = isNew ? [...s.stops, stop] : s.stops;
        const sm = new Map(allStops.map((x) => [x.id, x]));
        const geo = computeLinePath(s.graph, sm, stopIds, cosLat);
        if (!geo) {
          get().notify('No street path found through that stop.', 'bad');
          return;
        }
        set({
          cash: isNew ? s.cash - STOP_COST : s.cash,
          stops: allStops,
          lines: s.lines.map((l) => (l.id === line.id ? { ...l, stopIds, ...geo } : l)),
        });
        touchNetwork();
        get().notify(
          `${stop.name} added to ${line.name}` +
            (isNew ? ` ($${(STOP_COST / 1000).toFixed(0)}k).` : '.'),
          'good',
        );
        get().saveGame();
        return;
      }

      if (s.tool === 'line-new' && s.draft) {
        const cosLat = Math.cos((s.pack.meta.center[1] * Math.PI) / 180);
        // reuse an existing stop if the click is basically on it
        let stop: Stop | null = null;
        for (const ex of [...s.stops, ...s.draft.stops]) {
          if (fastDistM(ex.pt, pt, cosLat) < 35) {
            stop = ex;
            break;
          }
        }
        if (!stop) {
          // project the click onto the street itself — stops land exactly
          // where you put them, mid-block included
          const node = s.graph.insertStopNode(pt, 240, STOP_MAX_KMH);
          if (node === null) {
            const kmh = s.graph.speedNear(pt, 240);
            get().notify(
              kmh !== null && kmh > STOP_MAX_KMH
                ? "Buses can't stop on a highway — pick a regular street."
                : 'Too far from a road — click closer to a street.',
              'bad',
            );
            return;
          }
          for (const ex of [...s.stops, ...s.draft.stops]) {
            if (ex.node === node) {
              stop = ex;
              break;
            }
          }
          if (!stop) {
            const streetName = s.graph.stopNameAt(node);
            stop = {
              id: `s${stopSeq++}`,
              name: streetName ?? `Stop ${stopSeq}`,
              node,
              pt: s.graph.pack.nodes[node],
              tier: 1,
              invested: STOP_COST,
            };
          }
        }
        const last = s.draft.stops[s.draft.stops.length - 1];
        if (last && last.id === stop.id) return;
        let legs = s.draft.legs;
        if (last) {
          const r = s.graph.route(last.node, stop.node);
          if (!r || r.path.length < 2) {
            get().notify('No street path found between those stops.', 'bad');
            return;
          }
          legs = [...legs, { path: r.path, lenM: r.lenM }];
        }
        set({ draft: { stops: [...s.draft.stops, stop], legs } });
        return;
      }

      // select tool: pick nearest line stop? handled by map layer click events
    },

    undoDraftStop: () => {
      const s = get();
      if (!s.draft || !s.draft.stops.length) return;
      set({
        draft: {
          stops: s.draft.stops.slice(0, -1),
          legs: s.draft.legs.slice(0, Math.max(0, s.draft.legs.length - 1)),
        },
      });
    },

    cancelDraft: () => set({ draft: null, tool: 'select' }),

    finishDraft: () => {
      const s = get();
      if (!s.draft || s.draft.stops.length < 2 || !s.pack) {
        get().notify('A line needs at least 2 stops.', 'bad');
        return;
      }
      const cosLat = Math.cos((s.pack.meta.center[1] * Math.PI) / 180);
      const path: LngLat[] = [];
      const stopDist: number[] = [0];
      let acc = 0;
      s.draft.legs.forEach((leg, i) => {
        const start = path.length ? 1 : 0;
        if (!path.length) path.push(...leg.path);
        else for (let k = start; k < leg.path.length; k++) path.push(leg.path[k]);
        acc += leg.lenM;
        stopDist.push(acc);
      });
      const cum = cumulativeDist(path, cosLat);
      const id = `L${++lineSeq}`;
      const color = LINE_COLORS[(lineSeq - 1) % LINE_COLORS.length];
      const defaultModel =
        fleetOwned(s.fleet, 'citybus') - fleetAssigned(s.lines, 'citybus') > 0
          ? 'citybus'
          : BUS_MODELS.find(
              (m) => fleetOwned(s.fleet, m.id) - fleetAssigned(s.lines, m.id) > 0,
            )?.id ?? 'minibus';
      const line: BusLine = {
        id,
        name: `Line ${lineSeq}`,
        color,
        stopIds: s.draft.stops.map((st) => st.id),
        path,
        cum,
        stopDist,
        pathLenM: acc,
        headwayMin: 12,
        firstHour: 6,
        lastHour: 22,
        fare: 2.25,
        modelId: defaultModel,
        vehicles: 0,
        active: true,
      };
      const existingIds = new Set(s.stops.map((st) => st.id));
      const newStops = s.draft.stops.filter((st) => !existingIds.has(st.id));
      const buildCost = newStops.length * STOP_COST;
      if (buildCost > s.cash) {
        get().notify(
          `Building ${newStops.length} new stops costs $${(buildCost / 1000).toFixed(0)}k — ` +
            'not enough cash.',
          'bad',
        );
        return;
      }
      set({
        cash: s.cash - buildCost,
        stops: [...s.stops, ...newStops],
        lines: [...s.lines, line],
        draft: null,
        tool: 'select',
        selectedLineId: id,
        panel: 'line-edit',
      });
      touchNetwork();
      get().notify(
        buildCost > 0
          ? `${line.name} created (${newStops.length} stops built for ` +
              `$${(buildCost / 1000).toFixed(0)}k) — assign buses to start service.`
          : `${line.name} created — assign buses to start service.`,
        'info',
      );
      get().saveGame();
    },

    selectLine: (id) =>
      set({ selectedLineId: id, panel: id ? 'line-edit' : 'none' }),

    updateLine: (id, patch) => {
      set((s) => ({ lines: s.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
      touchNetwork();
    },

    deleteLine: (id) => {
      const s = get();
      const lines = s.lines.filter((l) => l.id !== id);
      const usedStops = new Set(lines.flatMap((l) => l.stopIds));
      const orphans = s.stops.filter((st) => !usedStops.has(st.id));
      // demolished stops salvage half of what was sunk into them
      const refund = Math.round(
        orphans.reduce((sum, st) => sum + (st.invested ?? STOP_COST), 0) / 2,
      );
      set({
        cash: s.cash + refund,
        lines,
        stops: s.stops.filter((st) => usedStops.has(st.id)),
        selectedLineId: null,
        panel: 'lines',
      });
      touchNetwork();
      if (refund > 0) {
        get().notify(
          `${orphans.length} unused stop${orphans.length === 1 ? '' : 's'} demolished — ` +
            `$${(refund / 1000).toFixed(0)}k salvaged.`,
          'info',
        );
      }
      get().saveGame();
    },

    buyBus: (modelId) => {
      const s = get();
      const m = busModel(modelId);
      if (s.totalRidersServed < m.unlockRiders) return;
      if (m.needsCharger && !s.depots.some((d) => d.chargers)) {
        get().notify('Electric buses need depot chargers (Depot panel).', 'bad');
        return;
      }
      if (!s.depots.length) {
        get().notify('Build a depot first.', 'bad');
        return;
      }
      const cap = depotCapacity(s.depots);
      if (fleetTotal(s.fleet) >= cap) {
        get().notify(
          `All depots are full (${cap} buses). Upgrade one or build another.`,
          'bad',
        );
        return;
      }
      if (s.cash < m.price) {
        get().notify('Not enough cash.', 'bad');
        return;
      }
      // a factory-fresh bus dilutes the group's average wear
      let fleet = s.fleet.map((f) =>
        f.modelId === modelId
          ? { ...f, count: f.count + 1, wear: (f.wear * f.count) / (f.count + 1) }
          : f,
      );
      if (!fleet.some((f) => f.modelId === modelId)) {
        fleet = [...fleet, { modelId, count: 1, wear: 0, tier: 1 }];
      }
      const staff = s.autoHireDriver
        ? { ...s.staff, drivers: s.staff.drivers + 1 }
        : s.staff;
      set({ cash: s.cash - m.price, fleet, staff });
      if (s.autoHireDriver) {
        get().notify(`${m.name} delivered — a driver was hired with it.`, 'info');
      }
      touchNetwork();
    },

    sellBus: (modelId) => {
      const s = get();
      const owned = fleetOwned(s.fleet, modelId);
      const assigned = fleetAssigned(s.lines, modelId);
      if (owned <= 0) return;
      if (owned - assigned <= 0) {
        get().notify('All buses of this model are assigned to lines.', 'bad');
        return;
      }
      const m = busModel(modelId);
      const e = s.fleet.find((f) => f.modelId === modelId);
      // worn buses fetch less on the used market
      const refund = Math.round(m.price * 0.5 * (1 - (e?.wear ?? 0) / 250));
      set({
        cash: s.cash + refund,
        fleet: s.fleet
          .map((f) => (f.modelId === modelId ? { ...f, count: f.count - 1 } : f))
          .filter((f) => f.count > 0),
      });
      touchNetwork();
    },

    refurbishFleet: (modelId) => {
      const s = get();
      const e = s.fleet.find((f) => f.modelId === modelId);
      if (!e || e.wear < 5) return;
      const m = busModel(modelId);
      const cost = Math.max(
        1000,
        Math.round(e.count * m.price * REFURB_COST_SHARE * (e.wear / 100)),
      );
      if (s.cash < cost) {
        get().notify('Not enough cash.', 'bad');
        return;
      }
      set({
        cash: s.cash - cost,
        fleet: s.fleet.map((f) => (f.modelId === modelId ? { ...f, wear: 0 } : f)),
      });
      touchNetwork();
      get().notify(`${m.name} fleet refurbished — good as new.`, 'good');
      get().saveGame();
    },

    upgradeFleetModel: (modelId) => {
      const s = get();
      const e = s.fleet.find((f) => f.modelId === modelId);
      if (!e || e.tier >= 3) return;
      const m = busModel(modelId);
      const cost = Math.round(e.count * m.price * FLEET_UPGRADE_COST_SHARE[e.tier + 1]);
      if (s.cash < cost) {
        get().notify('Not enough cash.', 'bad');
        return;
      }
      set({
        cash: s.cash - cost,
        fleet: s.fleet.map((f) =>
          f.modelId === modelId ? { ...f, tier: f.tier + 1 } : f,
        ),
      });
      touchNetwork();
      get().notify(
        `${m.name} fleet upgraded to ${FLEET_TIER_NAMES[e.tier + 1]} — ` +
          'more seats, cheaper to run.',
        'good',
      );
      get().saveGame();
    },

    setAutoHireDriver: (v) => {
      try {
        localStorage.setItem('intralines-auto-driver', v ? '1' : '0');
      } catch {
        // fine
      }
      set({ autoHireDriver: v });
    },

    hire: (role) => {
      const s = get();
      set({ staff: { ...s.staff, [role]: s.staff[role] + 1 } });
      touchNetwork();
    },

    fire: (role) => {
      const s = get();
      if (s.staff[role] <= 0) return;
      set({ staff: { ...s.staff, [role]: s.staff[role] - 1 } });
      touchNetwork();
    },

    buildDepot: (pt) => {
      const s = get();
      if (!s.graph || !s.pack) return;
      if (s.depots.length >= MAX_DEPOTS) {
        get().notify(`City planning caps you at ${MAX_DEPOTS} depots.`, 'bad');
        set({ tool: 'select' });
        return;
      }
      const cost = nextDepotCost(s.depots.length);
      if (s.cash < cost) {
        get().notify(
          `Not enough cash — depot #${s.depots.length + 1} costs ` +
            `$${(cost / 1000).toFixed(0)}k (land keeps getting pricier).`,
          'bad',
        );
        return;
      }
      const node = s.graph.nearestNode(pt, 400);
      if (node === null) {
        get().notify('The depot needs street access — click near a road.', 'bad');
        return;
      }
      const at = s.graph.pack.nodes[node];
      const cosLat = Math.cos((s.pack.meta.center[1] * Math.PI) / 180);
      if (s.depots.some((d) => fastDistM(d.pt, at, cosLat) < 120)) {
        get().notify('There is already a depot on this block.', 'bad');
        return;
      }
      const street = s.graph.stopNameAt(node);
      const depot: Depot = {
        id: `d${++depotSeq}`,
        name: street ? `${street} Depot` : `Depot ${s.depots.length + 1}`,
        pt: at,
        node,
        level: 1,
        workshop: false,
        washBay: false,
        chargers: false,
      };
      set({
        depots: [...s.depots, depot],
        cash: s.cash - cost,
        tool: 'select',
        panel: 'depot',
      });
      touchNetwork();
      get().notify(
        s.depots.length === 0
          ? `${depot.name} built! Buy buses in the Fleet panel, then draw a line.`
          : `${depot.name} built — buses pull out from the closest depot with room.`,
        'good',
      );
      get().saveGame();
    },

    upgradeDepot: (depotId) => {
      const s = get();
      const d = s.depots.find((x) => x.id === depotId);
      if (!d || d.level >= 3) return;
      const cost = DEPOT_UPGRADE_COST[d.level + 1];
      if (s.cash < cost) {
        get().notify('Not enough cash.', 'bad');
        return;
      }
      set({
        depots: s.depots.map((x) =>
          x.id === depotId ? { ...x, level: x.level + 1 } : x,
        ),
        cash: s.cash - cost,
      });
      get().notify(`${d.name} upgraded to level ${d.level + 1}.`, 'good');
      get().saveGame();
    },

    renameDepot: (depotId, name) => {
      const clean = name.slice(0, 28);
      set((s) => ({
        depots: s.depots.map((x) => (x.id === depotId ? { ...x, name: clean } : x)),
      }));
    },

    upgradeStop: (stopId) => {
      const s = get();
      const st = s.stops.find((x) => x.id === stopId);
      if (!st) return;
      const next = (st.tier ?? 1) + 1;
      const cost = STOP_UPGRADE_COST[next];
      if (!cost) return; // already a full station
      if (s.cash < cost) {
        get().notify('Not enough cash.', 'bad');
        return;
      }
      set({
        cash: s.cash - cost,
        stops: s.stops.map((x) =>
          x.id === stopId
            ? { ...x, tier: next, invested: (x.invested ?? STOP_COST) + cost }
            : x,
        ),
      });
      touchNetwork();
      get().notify(`${st.name} upgraded to ${STOP_TIER_NAMES[next]}.`, 'good');
      get().saveGame();
    },

    removeStopFromLine: (lineId, stopId) => {
      const s = get();
      const line = s.lines.find((l) => l.id === lineId);
      if (!line || !s.graph || !s.pack) return;
      if (line.stopIds.length <= 2) {
        get().notify('A line needs at least 2 stops.', 'bad');
        return;
      }
      if (!line.stopIds.includes(stopId)) return;
      const cosLat = Math.cos((s.pack.meta.center[1] * Math.PI) / 180);
      const stopIds = line.stopIds.filter((id) => id !== stopId);
      const sm = new Map(s.stops.map((x) => [x.id, x]));
      const geo = computeLinePath(s.graph, sm, stopIds, cosLat);
      if (!geo) {
        get().notify('No street path found without that stop.', 'bad');
        return;
      }
      const lines = s.lines.map((l) => (l.id === lineId ? { ...l, stopIds, ...geo } : l));
      const used = new Set(lines.flatMap((l) => l.stopIds));
      const st = s.stops.find((x) => x.id === stopId);
      let stops = s.stops;
      let cash = s.cash;
      if (st && !used.has(stopId)) {
        const refund = Math.round((st.invested ?? STOP_COST) / 2);
        cash += refund;
        stops = s.stops.filter((x) => x.id !== stopId);
        get().notify(
          `${st.name} demolished — $${(refund / 1000).toFixed(0)}k salvaged.`,
          'info',
        );
      } else if (st) {
        get().notify(`${st.name} removed from ${line.name}.`, 'info');
      }
      set({
        lines,
        stops,
        cash,
        moveStopId: s.moveStopId === stopId ? null : s.moveStopId,
      });
      touchNetwork();
      get().saveGame();
    },

    requestMoveStop: (stopId) => {
      const s = get();
      set({
        moveStopId: stopId,
        tool: stopId ? 'route-edit' : s.tool,
      });
    },

    buyDepotAddon: (depotId, addon) => {
      const s = get();
      const d = s.depots.find((x) => x.id === depotId);
      if (!d || d[addon]) return;
      const cost =
        addon === 'workshop' ? WORKSHOP_COST : addon === 'washBay' ? WASH_BAY_COST : CHARGERS_COST;
      if (s.cash < cost) {
        get().notify('Not enough cash.', 'bad');
        return;
      }
      set({
        depots: s.depots.map((x) => (x.id === depotId ? { ...x, [addon]: true } : x)),
        cash: s.cash - cost,
      });
      touchNetwork();
      get().saveGame();
    },

    takeLoan: () => {
      const s = get();
      if (s.loanTaken) return;
      set({ cash: s.cash + LOAN_AMOUNT - LOAN_FEE, loanTaken: true });
      get().notify(
        `Talon & Grasp wires $${((LOAN_AMOUNT - LOAN_FEE) / 1000).toFixed(0)}k ` +
          `(after their $${(LOAN_FEE / 1000).toFixed(0)}k "arrangement fee"). ` +
          `$${(LOAN_WEEKLY_INTEREST / 1000).toFixed(0)}k/week interest, forever. ` +
          'They smile as you sign.',
        'bad',
      );
    },

    repayLoan: () => {
      const s = get();
      if (!s.loanTaken) return;
      if (s.cash < LOAN_PAYOFF) {
        get().notify(
          `Talon & Grasp want $${(LOAN_PAYOFF / 1000).toFixed(0)}k to close the account.`,
          'bad',
        );
        return;
      }
      set({ cash: s.cash - LOAN_PAYOFF, loanTaken: false });
      get().notify('Debt cleared. Somewhere, a vulture sheds a single tear.', 'good');
      get().saveGame();
    },

    notify: (text, kind = 'info') => {
      const id = ++noticeSeq;
      set((s) => ({ notices: [...s.notices.slice(-4), { id, text, kind }] }));
      setTimeout(() => get().dismissNotice(id), 6500);
    },

    dismissNotice: (id) =>
      set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),

    saveGame: () => {
      const s = get();
      if (!s.pack) return;
      const sv: SaveGame = {
        version: SAVE_VERSION,
        cityId: s.pack.meta.id,
        cash: s.cash,
        clockMin: s.clockMin,
        stops: s.stops,
        lines: s.lines,
        depots: s.depots,
        staff: s.staff,
        fleet: s.fleet,
        totalRidersServed: s.totalRidersServed,
        loanTaken: s.loanTaken,
        reports: s.reports,
        savedAt: Date.now(),
      };
      try {
        localStorage.setItem(SAVE_KEY_PREFIX + s.pack.meta.id, JSON.stringify(sv));
      } catch {
        // storage full — ignore
      }
    },

    exportSave: () => {
      const s = get();
      s.saveGame();
      return localStorage.getItem(SAVE_KEY_PREFIX + (s.pack?.meta.id ?? '')) ?? '{}';
    },

    importSave: (json) => {
      try {
        const sv = JSON.parse(json) as SaveGame;
        if (typeof sv.cityId !== 'string' || sv.version !== SAVE_VERSION) return false;
        localStorage.setItem(SAVE_KEY_PREFIX + sv.cityId, json);
        return true;
      } catch {
        return false;
      }
    },
  };
});

export const HEADWAYS = HEADWAY_CHOICES;
