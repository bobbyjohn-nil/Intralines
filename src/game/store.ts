import { create } from 'zustand';
import type {
  BusLine, CityPack, Depot, FleetEntry, LngLat, NetworkStats, SaveGame, Staff, Stop, Tool,
} from './types';
import {
  BUS_MODELS, DEPOT_CAPACITY, DEPOT_COST, DEPOT_UPGRADE_COST, DEPOT_UPKEEP_PER_DAY,
  BUSES_PER_MECHANIC, CHARGERS_COST, HEADWAY_CHOICES, LINE_COLORS, LOAN_AMOUNT,
  LOAN_WEEKLY_INTEREST, MECHANIC_WAGE_PER_DAY, OFFICE_OVERHEAD_PER_DAY, SAVE_KEY_PREFIX,
  SAVE_VERSION, SPEEDS, START_CASH, SUBSIDY_PER_RIDER, WASH_BAY_COST, WORKSHOP_COST,
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
  | 'none' | 'lines' | 'line-edit' | 'fleet' | 'staff' | 'depot' | 'finance' | 'help';

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
  depot: Depot | null;
  staff: Staff;
  fleet: FleetEntry[];
  totalRidersServed: number;
  loanTaken: boolean;

  stats: NetworkStats | null;
  tool: Tool;
  draft: DraftLine | null;
  selectedLineId: string | null;
  panel: Panel;
  heatmap: 'off' | 'pop' | 'jobs';
  notices: Notice[];
  mapEpoch: number; // bumped when overlays must refresh
  /** 'auto' = online basemap tiles when reachable; 'offline' = never phone home */
  basemapPref: 'auto' | 'offline';
  /** what the map actually used this session (for the toggle button icon) */
  basemapActive: 'online' | 'offline';
  /** city-load failure shown on the menu (survives the menu remounting) */
  menuError: string | null;

  // actions
  openCity: (pack: CityPack) => void;
  backToMenu: () => void;
  setLoading: (msg: string, detail?: string) => void;
  tick: (realDtSec: number) => void;
  setSpeed: (idx: number) => void;
  togglePause: () => void;
  setTool: (t: Tool) => void;
  setPanel: (p: Panel) => void;
  setHeatmap: (h: 'off' | 'pop' | 'jobs') => void;
  toggleBasemap: () => void;
  setBasemapActive: (m: 'online' | 'offline') => void;
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
  hire: (role: keyof Staff) => void;
  fire: (role: keyof Staff) => void;
  buildDepot: (pt: LngLat) => void;
  upgradeDepot: () => void;
  buyDepotAddon: (addon: 'workshop' | 'washBay' | 'chargers') => void;
  takeLoan: () => void;
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

export const useGame = create<GameState>((set, get) => {
  function scheduleRecompute(): void {
    if (recomputeTimer) clearTimeout(recomputeTimer);
    recomputeTimer = setTimeout(() => {
      const s = get();
      if (!worker || !s.pack) return;
      reqSeq++;
      const mechanicsNeeded = Math.ceil(fleetTotal(s.fleet) / BUSES_PER_MECHANIC);
      let costMult = 1;
      if (s.depot?.workshop) costMult *= 0.75;
      if (s.staff.mechanics < mechanicsNeeded) costMult *= 1.4;

      // driver shortage degrades newest lines first
      let driversLeft = s.staff.drivers;
      const effectiveVehicles = new Map<string, number>();
      for (const l of s.lines) {
        if (!l.active || !s.depot) {
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
        stops: s.stops.map((st) => ({ id: st.id, pt: st.pt })),
        lines: s.lines.map((l) => {
          const m = busModel(l.modelId);
          return {
            id: l.id,
            stopIds: l.stopIds,
            stopDist: l.stopDist,
            pathLenM: l.pathLenM,
            headwayMin: l.headwayMin,
            firstHour: l.firstHour,
            lastHour: l.lastHour,
            fare: l.fare,
            capacity: m.capacity,
            kmh: m.kmh,
            costPerKm: m.costPerKm,
            vehicles: effectiveVehicles.get(l.id) ?? 0,
            active: l.active && !!s.depot,
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
    depot: null,
    staff: { drivers: 0, mechanics: 0 },
    fleet: [],
    totalRidersServed: 0,
    loanTaken: false,

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
    basemapActive: 'offline',
    menuError: null,

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
              const node = graph.insertStopNode(st.pt, 240);
              if (node !== null) {
                st.node = node;
                st.pt = graph.pack.nodes[node];
              }
            }
            if (sv.depot) {
              const dn = graph.nearestNode(sv.depot.pt, 400);
              if (dn !== null) sv.depot.node = dn;
            }
            base = {
              cash: sv.cash,
              clockMin: sv.clockMin,
              stops: sv.stops,
              lines: sv.lines,
              depot: sv.depot,
              staff: sv.staff,
              fleet: sv.fleet,
              totalRidersServed: sv.totalRidersServed,
              loanTaken: sv.loanTaken,
            };
            lineSeq = sv.lines.length + 1;
            stopSeq = sv.stops.length + 1;
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
        depot: null,
        staff: { drivers: 0, mechanics: 0 },
        fleet: [],
        totalRidersServed: 0,
        loanTaken: false,
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
      if (s.depot) fixedPerDay += DEPOT_UPKEEP_PER_DAY[s.depot.level] ?? 0;
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

      set({
        clockMin: newClock,
        clockRef: { min: newClock, realMs: performance.now(), rate },
        cash: s.cash + dCash,
        totalRidersServed: newTotal,
      });

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
      if (t === 'line-new' && !s.depot) {
        get().notify('Build a depot first — your buses need a home.', 'bad');
        return;
      }
      set({ tool: t, draft: t === 'line-new' ? { stops: [], legs: [] } : null, panel: t === 'line-new' ? 'line-edit' : s.panel });
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

    setMenuError: (e) => set({ menuError: e }),

    mapClick: (pt) => {
      const s = get();
      if (!s.graph || !s.pack) return;

      if (s.tool === 'depot-place') {
        get().buildDepot(pt);
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
          const node = s.graph.insertStopNode(pt, 240);
          if (node === null) {
            get().notify('Too far from a road — click closer to a street.', 'bad');
            return;
          }
          for (const ex of [...s.stops, ...s.draft.stops]) {
            if (ex.node === node) {
              stop = ex;
              break;
            }
          }
          stop ??= {
            id: `s${stopSeq++}`,
            name: `Stop ${stopSeq}`,
            node,
            pt: s.graph.pack.nodes[node],
          };
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
      set({
        stops: [...s.stops, ...newStops],
        lines: [...s.lines, line],
        draft: null,
        tool: 'select',
        selectedLineId: id,
        panel: 'line-edit',
      });
      touchNetwork();
      get().notify(`${line.name} created — assign buses to start service.`, 'info');
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
      set({
        lines,
        stops: s.stops.filter((st) => usedStops.has(st.id)),
        selectedLineId: null,
        panel: 'lines',
      });
      touchNetwork();
      get().saveGame();
    },

    buyBus: (modelId) => {
      const s = get();
      const m = busModel(modelId);
      if (s.totalRidersServed < m.unlockRiders) return;
      if (m.needsCharger && !s.depot?.chargers) {
        get().notify('Electric buses need depot chargers (Depot panel).', 'bad');
        return;
      }
      if (!s.depot) {
        get().notify('Build a depot first.', 'bad');
        return;
      }
      const cap = DEPOT_CAPACITY[s.depot.level] ?? 6;
      if (fleetTotal(s.fleet) >= cap) {
        get().notify(`Depot is full (${cap} buses). Upgrade it for more space.`, 'bad');
        return;
      }
      if (s.cash < m.price) {
        get().notify('Not enough cash.', 'bad');
        return;
      }
      const fleet = [...s.fleet];
      const e = fleet.find((f) => f.modelId === modelId);
      if (e) e.count++;
      else fleet.push({ modelId, count: 1 });
      set({ cash: s.cash - m.price, fleet });
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
      set({
        cash: s.cash + Math.round(m.price * 0.5),
        fleet: s.fleet
          .map((f) => (f.modelId === modelId ? { ...f, count: f.count - 1 } : f))
          .filter((f) => f.count > 0),
      });
      touchNetwork();
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
      if (s.depot || !s.graph) return;
      if (s.cash < DEPOT_COST) {
        get().notify('Not enough cash for a depot.', 'bad');
        return;
      }
      const node = s.graph.nearestNode(pt, 400);
      if (node === null) {
        get().notify('The depot needs street access — click near a road.', 'bad');
        return;
      }
      set({
        depot: {
          pt: s.graph.pack.nodes[node],
          node,
          level: 1,
          workshop: false,
          washBay: false,
          chargers: false,
        },
        cash: s.cash - DEPOT_COST,
        tool: 'select',
        panel: 'depot',
      });
      touchNetwork();
      get().notify('Depot built! Buy buses in the Fleet panel, then draw a line.', 'good');
      get().saveGame();
    },

    upgradeDepot: () => {
      const s = get();
      if (!s.depot || s.depot.level >= 3) return;
      const cost = DEPOT_UPGRADE_COST[s.depot.level + 1];
      if (s.cash < cost) {
        get().notify('Not enough cash.', 'bad');
        return;
      }
      set({ depot: { ...s.depot, level: s.depot.level + 1 }, cash: s.cash - cost });
      get().notify(`Depot upgraded to level ${s.depot.level + 1}.`, 'good');
    },

    buyDepotAddon: (addon) => {
      const s = get();
      if (!s.depot || s.depot[addon]) return;
      const cost =
        addon === 'workshop' ? WORKSHOP_COST : addon === 'washBay' ? WASH_BAY_COST : CHARGERS_COST;
      if (s.cash < cost) {
        get().notify('Not enough cash.', 'bad');
        return;
      }
      set({ depot: { ...s.depot, [addon]: true }, cash: s.cash - cost });
      touchNetwork();
    },

    takeLoan: () => {
      const s = get();
      if (s.loanTaken) return;
      set({ cash: s.cash + LOAN_AMOUNT, loanTaken: true });
      get().notify(
        `Loan received: $${LOAN_AMOUNT.toLocaleString()} (interest $${LOAN_WEEKLY_INTEREST.toLocaleString()}/week).`,
        'info',
      );
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
        depot: s.depot,
        staff: s.staff,
        fleet: s.fleet,
        totalRidersServed: s.totalRidersServed,
        loanTaken: s.loanTaken,
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
