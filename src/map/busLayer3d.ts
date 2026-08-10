import * as THREE from 'three';
import { MercatorCoordinate } from 'maplibre-gl';
import type { CustomLayerInterface, Map as MLMap } from 'maplibre-gl';
import type { BusLine, LineStats, LngLat, Stop } from '../game/types';
import { DWELL_SEC, isPeakHour, LAYOVER_MIN, trafficFactor } from '../game/constants';
import { busModel } from '../game/store';
import { pointAlong } from '../game/routing';

// The living-city layer. Buses move with real kinematics (constant
// acceleration up, braking down, cruise in between) and come to a full stop
// at lights and in traffic. Passengers are persistent little agents: they
// spawn from randomized origins at the rate the demand model predicts, walk
// to their stop, wait there — visibly lingering — and board when a bus
// actually pulls in. Bus schedules stay a pure function of the game clock.

const BUS_ACCEL = 1.1; // m/s²
const BUS_DECEL = 1.3; // m/s²
const KINE_K = 1 / (2 * BUS_ACCEL) + 1 / (2 * BUS_DECEL);

interface DriveSeg {
  t0: number;
  t1: number;
  d0: number;
  d1: number;
  drive: boolean;
}

interface BusUserData {
  glassMats: THREE.MeshLambertMaterial[];
  headlights: THREE.Mesh[];
  taillights: THREE.Mesh[];
}

/** per-line context computed by MapView from the road graph + census */
export interface LineExtras {
  /** distances along the path of real street intersections */
  intersections: number[];
  /** 0..1 — how dense the corridor's surroundings are */
  urban: number;
  /** 0..1 — share of the corridor on main roads (>= 42 km/h) */
  mainShare: number;
  /** class-aware rush-hour sensitivity averaged along the corridor */
  gain?: number;
  /** street route from the depot to the line's first stop (deadhead) */
  depotPath?: { path: LngLat[]; cum: number[]; lenM: number };
  /**
   * per-vehicle deadhead routes: vehicle k pulls out from the closest
   * depot that still had parking when it was allocated (null = none)
   */
  depotPaths?: ({ path: LngLat[]; cum: number[]; lenM: number } | null)[];
  /**
   * congestion relief from bus ridership along this corridor: 1 = no
   * effect, lower = riders who would have driven are off the road
   */
  relief?: number;
}

interface LineAnim {
  line: BusLine;
  vehicles: number;
  /** tightest (rush-hour) effective headway — sets the departure stagger */
  headwayEff: number;
  /** buses actually rolling at a given clock hour (off-peak thins out) */
  activeAt: (hour: number) => number;
  segs: DriveSeg[];
  outboundMin: number;
  cycleMin: number;
  meshes: THREE.Group[];
  seed: number;
  intersections: number[];
  urban: number;
  mainShare: number;
  depotPath?: { path: LngLat[]; cum: number[]; lenM: number };
  depotPaths?: ({ path: LngLat[]; cum: number[]; lenM: number } | null)[];
  modelKmh: number;
  /** congestion multiplier for this corridor at an hour of day */
  congAt: (hour: number) => number;
  /**
   * traffic-adjusted time: tau[i] = profile-minutes elapsed by wall-clock
   * minute i*TAU_STEP. Continuous and monotonic, so schedules never jump
   * when congestion ramps up or down — buses just slow down.
   */
  tau: Float64Array;
}

const TAU_STEP = 5; // minutes per tau table entry

function tauAt(a: LineAnim, dayMin: number): number {
  const m = Math.max(0, Math.min(dayMin, 1440));
  const i = Math.floor(m / TAU_STEP);
  const f = m / TAU_STEP - i;
  const hi = Math.min(i + 1, a.tau.length - 1);
  return a.tau[i] + (a.tau[hi] - a.tau[i]) * f;
}

interface StopSite {
  id: string;
  pt: LngLat;
  x: number;
  z: number;
  hourly: number[];
}

const AGENT_POOL = 130;
const PER_STOP_CAP = 12;
const GIVE_UP_MIN = 45;
const WALKER_COLORS = [0x8d6e63, 0x5c6bc0, 0x6d8b74, 0xb0716a, 0x7e7a9a, 0x936f4f];

interface Agent {
  state: 'free' | 'walking' | 'waiting';
  site: number;
  sx: number;
  sz: number;
  startClock: number;
  walkDur: number;
  waitDx: number;
  waitDz: number;
  waitSince: number;
}

function hash32(x: number): number {
  x |= 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

function rand01(...keys: number[]): number {
  let h = 0x9e3779b9;
  for (const k of keys) h = hash32(h ^ (k | 0));
  return h / 4294967296;
}

/**
 * Position after t seconds on a run of D meters lasting T seconds, starting
 * and ending at rest: accelerate at BUS_ACCEL, cruise, brake at BUS_DECEL.
 * Falls back to a triangular profile when the timetable is tighter than the
 * physics allows (very short hops).
 */
function kinematicDist(D: number, T: number, t: number): number {
  if (T <= 0.01 || D <= 0.01) return t >= T ? D : 0;
  t = Math.max(0, Math.min(t, T));
  const disc = T * T - 4 * KINE_K * D;
  if (disc >= 0) {
    const vc = (T - Math.sqrt(disc)) / (2 * KINE_K);
    const ta = vc / BUS_ACCEL;
    const td = vc / BUS_DECEL;
    if (t <= ta) return 0.5 * BUS_ACCEL * t * t;
    if (t >= T - td) {
      const r = T - t;
      return D - 0.5 * BUS_DECEL * r * r;
    }
    return 0.5 * BUS_ACCEL * ta * ta + vc * (t - ta);
  }
  const half = T / 2;
  const a2 = (2 * D) / T / half;
  if (t <= half) return 0.5 * a2 * t * t;
  const r = T - t;
  return D - 0.5 * a2 * r * r;
}

/** accelerate from rest, then hold cruise speed to cover D in T (no end stop) */
function accelCruise(D: number, T: number, t: number, a: number): number {
  t = Math.max(0, Math.min(t, T));
  const disc = a * a * T * T - 2 * a * D;
  if (disc < 0 || T <= 0.01) return (D * t) / Math.max(T, 0.01); // too tight: linear
  const vc = a * T - Math.sqrt(disc);
  const ta = Math.min(vc / a, T);
  if (t <= ta) return 0.5 * a * t * t;
  return 0.5 * a * ta * ta + vc * (t - ta);
}

/**
 * A sub-leg between full stops. Normally pure kinematics (rest -> cruise ->
 * rest). In congestion the middle third crawls at reduced speed — the bus
 * visibly slows and speeds back up, but never halts mid-block.
 */
function subLegDist(D: number, T: number, t: number, slow: boolean): number {
  if (!slow || D < 120 || T < 8) return kinematicDist(D, T, t);
  t = Math.max(0, Math.min(t, T));
  // distances 35/30/35, paces 1 / 0.45 / 1  =>  time weights .35/.667/.35
  const wSum = 0.35 + 0.3 / 0.45 + 0.35;
  const T0 = (T * 0.35) / wSum;
  const T1 = (T * (0.3 / 0.45)) / wSum;
  const T2 = T - T0 - T1;
  const D0 = 0.35 * D;
  const D1 = 0.3 * D;
  const D2 = D - D0 - D1;
  if (t <= T0) return accelCruise(D0, T0, t, BUS_ACCEL);
  if (t <= T0 + T1) return D0 + (D1 * (t - T0)) / T1; // crawling through the jam
  // mirror of accelCruise: cruise then brake to rest at the end
  return D - accelCruise(D2, T2, T - t, BUS_DECEL);
}

export class BusLayer3D implements CustomLayerInterface {
  id = 'buses-3d';
  type = 'custom' as const;
  renderingMode = '3d' as const;

  private map!: MLMap;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private anchor!: MercatorCoordinate;
  private meterScale = 1;
  private cosLat = 1;
  private center: LngLat = [0, 0];
  private anims: LineAnim[] = [];
  private ambient = new THREE.AmbientLight(0xffffff, 2.1);
  private sun = new THREE.DirectionalLight(0xffffff, 1.6);
  private pendingNetwork: {
    lines: BusLine[];
    stats: LineStats[];
    stops: Stop[];
    extras?: Map<string, LineExtras>;
  } | null = null;

  // passengers
  private sites: StopSite[] = [];
  private lastServed = new Map<string, number>(); // stopId -> game clock min
  private lastServedBy = new Map<string, string>(); // stopId -> lineId
  private agents: Agent[] = [];
  private agentMeshes: THREE.Group[] = [];
  private prevClock = -1;

  /** last-rendered vehicle states, for tests/debugging */
  lastFrame: { line: string; k: number; pt: LngLat | null; visible: boolean }[] = [];

  /** operator brand color — buses wear it with a line-color stripe */
  brandColor = '';

  constructor(private getClockMin: () => number) {}

  onAdd(map: MLMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.map = map;
    this.center = [map.getCenter().lng, map.getCenter().lat];
    this.cosLat = Math.cos((this.center[1] * Math.PI) / 180);
    this.anchor = MercatorCoordinate.fromLngLat(
      { lng: this.center[0], lat: this.center[1] },
      0,
    );
    this.meterScale = this.anchor.meterInMercatorCoordinateUnits();
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as WebGL2RenderingContext,
      antialias: true,
    });
    this.renderer.autoClear = false;
    this.sun.position.set(400, 900, 300);
    this.scene.add(this.ambient);
    this.scene.add(this.sun);
    for (let i = 0; i < AGENT_POOL; i++) {
      const w = makeWalkerMesh(WALKER_COLORS[i % WALKER_COLORS.length]);
      w.visible = false;
      this.scene.add(w);
      this.agentMeshes.push(w);
      this.agents.push({
        state: 'free', site: 0, sx: 0, sz: 0, startClock: 0, walkDur: 1,
        waitDx: 0, waitDz: 0, waitSince: 0,
      });
    }
    if (this.pendingNetwork) {
      const { lines, stats, stops, extras } = this.pendingNetwork;
      this.pendingNetwork = null;
      this.setNetwork(lines, stats, stops, extras);
    }
  }

  onRemove(): void {
    this.anims.forEach((a) => a.meshes.forEach((m) => this.scene.remove(m)));
    this.agentMeshes.forEach((m) => this.scene.remove(m));
    this.anims = [];
    this.agentMeshes = [];
    this.agents = [];
  }

  private dayFactor(hour: number): number {
    return hour < 5 || hour >= 21 ? 0 :
      hour < 7 ? (hour - 5) / 2 :
      hour < 19 ? 1 :
      1 - (hour - 19) / 2;
  }

  setDaylight(day: number): void {
    this.ambient.intensity = 1.7 + day * 1.1;
    this.sun.intensity = 0.5 + day * 1.6;
    const warm = new THREE.Color(0xfff4e0);
    const night = new THREE.Color(0x9fb4de);
    this.sun.color = night.clone().lerp(warm, day);
  }

  setNetwork(
    lines: BusLine[],
    stats: LineStats[],
    stops: Stop[],
    extras?: Map<string, LineExtras>,
  ): void {
    if (!this.renderer) {
      this.pendingNetwork = { lines, stats, stops, extras };
      return;
    }
    this.anims.forEach((a) => a.meshes.forEach((m) => this.scene.remove(m)));
    this.anims = [];

    // stop demand sites for passenger spawning + live counts
    const rate = new Map<string, number[]>();
    for (const line of lines) {
      const st = stats.find((s) => s.lineId === line.id);
      if (!st || !line.active || st.vehiclesUsed <= 0) continue;
      const perStop = st.hourly.map((h) => h / Math.max(line.stopIds.length, 1));
      for (const sid of line.stopIds) {
        const arr = rate.get(sid) ?? new Array(24).fill(0);
        for (let h = 0; h < 24; h++) arr[h] += perStop[h];
        rate.set(sid, arr);
      }
    }
    // capture which stop each live agent belongs to BEFORE replacing sites
    const oldIds = this.agentSiteIds;
    this.sites = stops
      .filter((s) => rate.has(s.id))
      .map((s) => {
        const { x, z } = this.toLocal(s.pt);
        return { id: s.id, pt: s.pt, x, z, hourly: rate.get(s.id)! };
      });
    // agents keep waiting across network edits when their stop survives
    const alive = new Set(this.sites.map((s) => s.id));
    const siteIdx = new Map(this.sites.map((s, i) => [s.id, i]));
    this.agents.forEach((a, i) => {
      if (a.state === 'free') return;
      const sid = oldIds[i];
      if (sid && alive.has(sid)) {
        a.site = siteIdx.get(sid)!;
      } else {
        a.state = 'free';
        this.agentMeshes[i].visible = false;
      }
    });

    for (const line of lines) {
      const st = stats.find((s) => s.lineId === line.id);
      if (!st || !line.active || st.vehiclesUsed <= 0 || line.path.length < 2) continue;
      const model = busModel(line.modelId);
      const segs: DriveSeg[] = [];
      let t = 0;
      for (let i = 1; i < line.stopIds.length; i++) {
        const d0 = line.stopDist[i - 1];
        const d1 = line.stopDist[i];
        const dur = ((d1 - d0) / 1000 / model.kmh) * 60;
        segs.push({ t0: t, t1: t + dur, d0, d1, drive: true });
        t += dur;
        if (i < line.stopIds.length - 1) {
          segs.push({ t0: t, t1: t + DWELL_SEC / 60, d0: d1, d1, drive: false });
          t += DWELL_SEC / 60;
        }
      }
      const outboundMin = t;
      const cycleMin = 2 * outboundMin + 2 * LAYOVER_MIN;
      const meshes: THREE.Group[] = [];
      for (let k = 0; k < st.vehiclesUsed; k++) {
        const g = makeBusMesh(line.color, model.id, this.brandColor);
        g.visible = false;
        this.scene.add(g);
        meshes.push(g);
      }
      const ex = extras?.get(line.id);
      const urban = ex?.urban ?? 0.5;
      const mainShare = ex?.mainShare ?? 0.5;
      // where the line runs decides how bad traffic gets: downtown arterials
      // grind to a near-standstill at rush hour, rural side streets barely
      // notice it. Class-aware gain from the corridor samples when
      // available: arterials feel rush hour, side streets shrug it off.
      const gain = ex?.gain ?? urban * (1.2 + 1.2 * mainShare) + 0.08;
      const relief = ex?.relief ?? 1;
      const congAt = (hour: number): number => {
        const base = trafficFactor(hour);
        // bus riders who would have driven are off the road: ridership
        // damps the rush-hour amplitude on this corridor
        const g = base >= 1 ? gain * relief : Math.min(gain, 1);
        return Math.max(0.55, 1 + (base - 1) * g);
      };
      const tau = new Float64Array(1440 / TAU_STEP + 1);
      for (let i = 1; i < tau.length; i++) {
        const midHour = ((i - 0.5) * TAU_STEP) / 60;
        tau[i] = tau[i - 1] + TAU_STEP / congAt(midHour);
      }
      const effPeak = st.headwayEffPeakMin ?? st.headwayEffMin;
      const activeAt = (hour: number): number =>
        Math.min(
          st.vehiclesUsed,
          Math.max(1, Math.ceil(st.cycleMin / (isPeakHour(hour) ? effPeak : st.headwayEffMin))),
        );
      this.anims.push({
        line,
        vehicles: st.vehiclesUsed,
        headwayEff: Math.min(effPeak, st.headwayEffMin),
        activeAt,
        segs,
        outboundMin,
        cycleMin,
        meshes,
        seed: hash32(line.id.split('').reduce((s, c) => s * 31 + c.charCodeAt(0), 7)),
        intersections: ex?.intersections ?? [],
        urban,
        mainShare,
        depotPath: ex?.depotPath,
        depotPaths: ex?.depotPaths,
        modelKmh: model.kmh,
        congAt,
        tau,
      });
    }
    this.map?.triggerRepaint();
  }

  private get agentSiteIds(): (string | null)[] {
    return this.agents.map((a) =>
      a.state === 'free' ? null : this.sites[a.site]?.id ?? null,
    );
  }

  /**
   * Distance along one outbound run at profile-time t. Drive segments use
   * real accelerate/cruise/brake physics. Full stops happen ONLY at real
   * street intersections (deterministic red lights, likelier in rush hour);
   * mid-block traffic shows up as a visible slowdown, never a dead stop.
   */
  private outboundDist(a: LineAnim, t: number, cycleIdx: number, veh: number, congestion: number): number {
    for (let i = 0; i < a.segs.length; i++) {
      const s = a.segs[i];
      if (t > s.t1) continue;
      if (!s.drive) return s.d0;
      const D = s.d1 - s.d0;
      const Tmin = s.t1 - s.t0;
      const tIn = t - s.t0;
      const jam = Math.max(0, congestion - 0.95);

      // red lights: pick up to 2 of the real intersections inside this block
      const candidates = a.intersections.filter(
        (d) => d > s.d0 + 25 && d < s.d1 - 25,
      );
      const holds: { p: number; frac: number }[] = [];
      let holdFrac = 0;
      for (let c = 0; c < candidates.length && holds.length < 2; c++) {
        const roll = rand01(a.seed, veh, cycleIdx, i, c);
        if (roll < 0.3 + jam * 0.45) {
          const frac =
            (0.05 + 0.09 * rand01(a.seed, veh, cycleIdx, i, c + 40)) * (1 + jam * 0.8);
          holds.push({ p: (candidates[c] - s.d0) / D, frac });
          holdFrac += frac;
        }
      }
      if (holdFrac > 0.4) {
        const f = 0.4 / holdFrac;
        holds.forEach((h) => (h.frac *= f));
        holdFrac = 0.4;
      }
      holds.sort((x, y) => x.p - y.p);

      // sub-legs between red lights; time ∝ distance
      const Tsec = Tmin * 60;
      const driveSec = Tsec * (1 - holdFrac);
      const cuts = [0, ...holds.map((h) => h.p), 1];
      let acc = s.d0;
      let cursorSec = 0;
      const tSec = Math.max(0, Math.min(tIn * 60, Tsec));
      for (let leg = 0; leg < cuts.length - 1; leg++) {
        const legD = (cuts[leg + 1] - cuts[leg]) * D;
        const legT = driveSec * ((cuts[leg + 1] - cuts[leg]) || 0);
        // mid-block congestion: crawl through the middle without stopping
        const slow = jam > 0.05 && rand01(a.seed, veh, cycleIdx, i, leg + 80) < jam * 0.9;
        if (tSec <= cursorSec + legT || leg === cuts.length - 2) {
          return acc + subLegDist(legD, legT, tSec - cursorSec, slow);
        }
        cursorSec += legT;
        acc += legD;
        if (leg < holds.length) {
          const holdSec = holds[leg].frac * Tsec;
          if (tSec <= cursorSec + holdSec) return acc; // waiting at the light
          cursorSec += holdSec;
        }
      }
      return s.d1;
    }
    return a.line.pathLenM;
  }

  private distAt(
    a: LineAnim, tMin: number, cycleIdx: number, veh: number, congestion: number,
  ): { d: number; forward: boolean } | null {
    const { outboundMin, cycleMin } = a;
    if (tMin < outboundMin) {
      return { d: this.outboundDist(a, tMin, cycleIdx * 2, veh, congestion), forward: true };
    }
    if (tMin < outboundMin + LAYOVER_MIN) return { d: a.line.pathLenM, forward: true };
    const tIn = tMin - outboundMin - LAYOVER_MIN;
    if (tIn < outboundMin) {
      return {
        d: a.line.pathLenM - this.outboundDist(a, tIn, cycleIdx * 2 + 1, veh, congestion),
        forward: false,
      };
    }
    if (tMin < cycleMin) return { d: 0, forward: false };
    return null;
  }

  private bearingAlong(
    path: LngLat[], cum: number[], lenM: number, d: number, forward: boolean,
  ): { pt: LngLat; bearing: number } {
    const { pt } = pointAlong(path, cum, d);
    const ahead = forward ? Math.min(d + 8, lenM) : Math.max(d - 8, 0);
    const { pt: pt2 } = pointAlong(path, cum, ahead);
    const dx = (pt2[0] - pt[0]) * this.cosLat;
    const dy = pt2[1] - pt[1];
    let bearing;
    if (Math.abs(dx) + Math.abs(dy) < 1e-9) {
      bearing = pointAlong(path, cum, d).bearing + (forward ? 0 : 180);
    } else {
      bearing = (Math.atan2(dx, dy) * 180) / Math.PI;
    }
    return { pt, bearing };
  }

  private smoothBearing(line: BusLine, d: number, forward: boolean): { pt: LngLat; bearing: number } {
    return this.bearingAlong(line.path, line.cum, line.pathLenM, d, forward);
  }

  private toLocal(pt: LngLat): { x: number; z: number } {
    // exact web-mercator, not a flat-earth approximation: keeps buses glued
    // to the rendered streets even far from the map anchor
    const m = MercatorCoordinate.fromLngLat({ lng: pt[0], lat: pt[1] }, 0);
    return {
      x: (m.x - this.anchor.x) / this.meterScale,
      z: (m.y - this.anchor.y) / this.meterScale,
    };
  }

  /** live waiting-passenger estimate per stop (drives both chips and agents) */
  private waitingCount(site: StopSite, clock: number, hourInt: number): number {
    const rate = site.hourly[hourInt] ?? 0;
    if (rate <= 0.2) return 0;
    const last = this.lastServed.get(site.id) ?? clock - 6;
    return Math.min((rate / 60) * Math.max(clock - last, 0), 60);
  }

  /** live station snapshot for the station viewer panel */
  stationInfo(stopId: string): {
    waiting: number;
    lastServedMin: number | null;
    lineId: string | null;
  } {
    const site = this.sites.find((s) => s.id === stopId) ?? null;
    const clock = this.getClockMin();
    const hourInt = Math.floor((((clock % 1440) + 1440) % 1440) / 60) % 24;
    return {
      waiting: site ? Math.round(this.waitingCount(site, clock, hourInt)) : 0,
      lastServedMin: this.lastServed.get(stopId) ?? null,
      lineId: this.lastServedBy.get(stopId) ?? null,
    };
  }

  getStopCounts(): { id: string; pt: LngLat; count: number }[] {
    const clock = this.getClockMin();
    const dayMin = ((clock % 1440) + 1440) % 1440;
    const hourInt = Math.floor(dayMin / 60) % 24;
    return this.sites
      .map((s) => ({ id: s.id, pt: s.pt, count: Math.round(this.waitingCount(s, clock, hourInt)) }))
      .filter((s) => s.count >= 1);
  }

  render(_gl: WebGLRenderingContext, matrix: unknown): void {
    const clock = this.getClockMin();
    const dayMin = ((clock % 1440) + 1440) % 1440;
    const hour = dayMin / 60;
    const hourInt = Math.floor(hour) % 24;
    const day = this.dayFactor(hour);
    const congestion = trafficFactor(hour);
    this.setDaylight(day);
    const zoom = this.map.getZoom();
    const mPerPx = (156543.03392 * this.cosLat) / Math.pow(2, zoom);
    const busScale = Math.min(Math.max((25 * mPerPx) / 11, 1.15), 29);

    const servedNow = new Map<string, string>(); // stopId -> serving lineId
    this.lastFrame = [];
    for (const a of this.anims) {
      const { line } = a;
      const svcStart = line.firstHour * 60;
      const svcEnd = line.lastHour * 60;
      // all scheduling below runs in traffic-adjusted "tau" minutes: the
      // clock integrates 1/congestion, so when rush hour ramps up buses
      // smoothly slow down instead of snapping to a rescaled timetable
      const cong = a.congAt(hour);
      const tauNow = tauAt(a, dayMin);
      for (let k = 0; k < a.vehicles; k++) {
        // each vehicle deadheads from its own home depot — the closest one
        // that still had parking when the fleet was garaged
        const dp = a.depotPaths ? a.depotPaths[k] ?? undefined : a.depotPath;
        const deadMin = dp ? (dp.lenM / 1000 / a.modelKmh) * 60 + 0.2 : 0;
        const mesh = a.meshes[k];
        const firstDep = svcStart + k * a.headwayEff;
        let visible = false;
        let seenPt: LngLat | null = null;
        let hit: { pt: LngLat; bearing: number; lineD: number | null } | null = null;

        // vehicles whose first departure falls outside the service window
        // never leave the depot — no ghost out-and-back
        if (firstDep > svcEnd) {
          mesh.visible = false;
          this.lastFrame.push({ line: line.id, k, pt: null, visible: false });
          continue;
        }
        const tauDep = tauAt(a, firstDep);
        if (dp && tauNow >= tauDep - deadMin && tauNow < tauDep) {
          // pull-out: rolls from the depot to the first stop before service —
          // but only if this bus is on the roster for the opening hour
          if (k < a.activeAt(firstDep / 60)) {
            const tSec = (tauNow - (tauDep - deadMin)) * 60;
            const d = kinematicDist(dp.lenM, deadMin * 60, tSec);
            const { pt, bearing } = this.bearingAlong(dp.path, dp.cum, dp.lenM, d, true);
            hit = { pt, bearing, lineD: null };
          }
        } else if (tauNow >= tauDep) {
          const since = tauNow - tauDep;
          const lastDepartureCutoff = tauAt(a, svcEnd) - tauDep;
          const cycleIdx = Math.floor(since / a.cycleMin);
          const cycleStart = cycleIdx * a.cycleMin;
          // off-peak the timetable thins out: buses beyond the hour's
          // roster sit this cycle out at the depot
          const hourAtDep = ((firstDep + cycleStart) / 60) % 24;
          if (cycleStart <= lastDepartureCutoff && k < a.activeAt(hourAtDep)) {
            const tProfile = since - cycleStart;
            const pos = this.distAt(a, tProfile, cycleIdx, k, cong);
            if (pos) {
              const { pt, bearing } = this.smoothBearing(line, pos.d, pos.forward);
              hit = { pt, bearing: pos.forward ? bearing : bearing + 180, lineD: pos.d };
            }
          } else if (dp && cycleStart > lastDepartureCutoff) {
            // service over: one last drive home to the depot (only for
            // buses that actually ran the closing cycle)
            const lastIdx = Math.floor(lastDepartureCutoff / a.cycleMin);
            const lastHour = ((firstDep + lastIdx * a.cycleMin) / 60) % 24;
            const tHome = since - (lastIdx + 1) * a.cycleMin;
            if (tHome >= 0 && tHome < deadMin && k < a.activeAt(lastHour)) {
              const tSec = tHome * 60;
              const d = kinematicDist(dp.lenM, deadMin * 60, tSec);
              const { pt, bearing } = this.bearingAlong(
                dp.path, dp.cum, dp.lenM, dp.lenM - d, false,
              );
              hit = { pt, bearing: bearing + 180, lineD: null };
            }
          }
        }

        if (hit) {
          const { x, z } = this.toLocal(hit.pt);
          // rules of the road: keep to the right-hand side of the centerline
          // in the direction of travel, so opposing buses pass each other
          // instead of colliding head-on. The offset scales with the bus's
          // rendered size — buses are drawn far larger than life at city
          // zooms, so a fixed real-world lane offset would vanish under them.
          const rb = ((hit.bearing + 90) * Math.PI) / 180;
          const rightM = Math.max(3.1, busScale * 1.6);
          mesh.position.set(x + Math.sin(rb) * rightM, 0, z - Math.cos(rb) * rightM);
          mesh.rotation.y = Math.PI / 2 - (hit.bearing * Math.PI) / 180;
          mesh.scale.setScalar(busScale);
          applyBusLighting(mesh, day);
          visible = true;
          seenPt = hit.pt;
          if (hit.lineD !== null) {
            // is this bus at (or basically at) one of its stops?
            for (let si = 0; si < line.stopDist.length; si++) {
              if (Math.abs(hit.lineD - line.stopDist[si]) < 25) {
                servedNow.set(line.stopIds[si], line.id);
                break;
              }
            }
          }
        }
        mesh.visible = visible;
        this.lastFrame.push({ line: line.id, k, pt: seenPt, visible });
      }
    }
    for (const [sid, lid] of servedNow) {
      this.lastServed.set(sid, clock);
      this.lastServedBy.set(sid, lid);
    }

    this.updatePassengers(clock, hourInt, servedNow, zoom, mPerPx);

    const m = new THREE.Matrix4().fromArray(Array.from(matrix as ArrayLike<number>));
    const l = new THREE.Matrix4()
      .makeTranslation(this.anchor.x, this.anchor.y, this.anchor.z)
      .scale(new THREE.Vector3(this.meterScale, -this.meterScale, this.meterScale))
      .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    this.camera.projectionMatrix = m.multiply(l);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    if (this.anims.length || this.sites.length) this.map.triggerRepaint();
  }

  /** persistent pedestrians: spawn → walk in → linger at the stop → board */
  private updatePassengers(
    clock: number, hourInt: number, servedNow: Map<string, string>, zoom: number,
    mPerPx: number,
  ): void {
    const dt = this.prevClock < 0 ? 0 : Math.max(0, Math.min(clock - this.prevClock, 30));
    this.prevClock = clock;
    const scale = Math.min(Math.max((7 * mPerPx) / 1.7, 1), 12);
    const show = zoom >= 13.6 && this.sites.length > 0;

    // how many agents are already headed to / waiting at each site
    const perSite = new Array<number>(this.sites.length).fill(0);
    for (const a of this.agents) {
      if (a.state !== 'free') perSite[a.site]++;
    }

    // spawn where the live waiting estimate outruns the visible crowd
    for (let si = 0; si < this.sites.length && dt > 0; si++) {
      const want = Math.min(
        Math.round(this.waitingCount(this.sites[si], clock, hourInt)),
        PER_STOP_CAP,
      );
      if (perSite[si] >= want) continue;
      const free = this.agents.findIndex((a) => a.state === 'free');
      if (free === -1) break;
      const a = this.agents[free];
      const site = this.sites[si];
      const ang = Math.random() * Math.PI * 2; // randomized origins
      const dist = 45 + Math.random() * 125;
      a.state = 'walking';
      a.site = si;
      a.sx = site.x + Math.cos(ang) * dist;
      a.sz = site.z + Math.sin(ang) * dist;
      a.startClock = clock;
      a.walkDur = dist / (66 + Math.random() * 30); // m/min, varied gait
      const waitAng = Math.random() * Math.PI * 2;
      const waitR = 2.5 + Math.random() * 4.5;
      a.waitDx = Math.cos(waitAng) * waitR;
      a.waitDz = Math.sin(waitAng) * waitR;
      perSite[si]++;
    }

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      const mesh = this.agentMeshes[i];
      if (a.state === 'free') {
        mesh.visible = false;
        continue;
      }
      const site = this.sites[a.site];
      if (!site) {
        a.state = 'free';
        mesh.visible = false;
        continue;
      }

      if (a.state === 'walking') {
        const f = Math.min((clock - a.startClock) / a.walkDur, 1);
        const tx = site.x + a.waitDx;
        const tz = site.z + a.waitDz;
        mesh.position.x = a.sx + (tx - a.sx) * f;
        mesh.position.z = a.sz + (tz - a.sz) * f;
        mesh.position.y = Math.abs(Math.sin((clock - a.startClock) * 220)) * 0.16 * scale;
        mesh.rotation.y = Math.atan2(tx - a.sx, tz - a.sz);
        if (f >= 1) {
          a.state = 'waiting';
          a.waitSince = clock;
        }
      } else {
        // waiting: linger beside the stop, occasionally shifting weight
        mesh.position.x = site.x + a.waitDx;
        mesh.position.z = site.z + a.waitDz;
        mesh.position.y = Math.abs(Math.sin(clock * 3 + i)) * 0.02 * scale;
        mesh.rotation.y = Math.atan2(site.x - mesh.position.x, site.z - mesh.position.z);
        if (servedNow.has(site.id) && clock - a.waitSince > 0.15) {
          a.state = 'free'; // boards the bus
          mesh.visible = false;
          continue;
        }
        if (clock - a.waitSince > GIVE_UP_MIN) {
          a.state = 'free'; // gave up on this line
          mesh.visible = false;
          continue;
        }
      }
      mesh.scale.setScalar(scale);
      mesh.visible = show;
    }
  }
}

function applyBusLighting(mesh: THREE.Group, day: number): void {
  const ud = mesh.userData as BusUserData;
  if (!ud.glassMats) return;
  const glow = 1 - day;
  for (const g of ud.glassMats) {
    g.emissive.setHex(0xffd98a);
    g.emissiveIntensity = glow * 0.85;
  }
  for (const h of ud.headlights) h.visible = glow > 0.35;
  for (const t of ud.taillights) t.visible = glow > 0.35;
}

const bodyGeoCache = new Map<string, THREE.BoxGeometry>();

/**
 * Company-liveried bus: the body wears the operator's brand color, a full-
 * length stripe wears the line's color, and each model keeps a recognizable
 * silhouette (stubby minibus, artic with a bellows joint, battery pack on
 * the electric's roof). Exported so the station viewer can render the same
 * buses up close.
 */
export function makeBusMesh(
  color: string,
  modelId: string,
  brandColor?: string,
): THREE.Group {
  const len = modelId === 'artic' ? 16 : modelId === 'minibus' ? 7 : 11;
  const g = new THREE.Group();
  const bodyColor = new THREE.Color(brandColor || color);
  const bodyMat = new THREE.MeshLambertMaterial({
    color: bodyColor,
    emissive: bodyColor.clone().multiplyScalar(0.28),
  });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x33404f });
  const glassMat2 = new THREE.MeshLambertMaterial({ color: 0x33404f });
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1d1d20 });
  const roofMat = new THREE.MeshLambertMaterial({
    color: modelId === 'minibus' ? 0xffffff : 0xf5f2ea,
  });

  const key = `body-${len}`;
  let bodyGeo = bodyGeoCache.get(key);
  if (!bodyGeo) {
    bodyGeo = new THREE.BoxGeometry(len, 2.1, 2.6);
    bodyGeoCache.set(key, bodyGeo);
  }
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 1.55;
  g.add(body);

  // the line's color rides on a full-length stripe so routes stay
  // tellable apart even though every bus wears the company paint
  const stripeColor = new THREE.Color(color);
  const stripeMat = new THREE.MeshLambertMaterial({
    color: stripeColor,
    emissive: stripeColor.clone().multiplyScalar(0.3),
  });
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(len - 0.2, 0.42, 2.68), stripeMat);
  stripe.position.y = 1.05;
  g.add(stripe);

  const windows = new THREE.Mesh(new THREE.BoxGeometry(len - 0.6, 0.9, 2.64), glassMat);
  windows.position.y = 2.35;
  g.add(windows);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(len - 0.4, 0.18, 2.4), roofMat);
  roof.position.y = 2.95;
  g.add(roof);

  if (modelId === 'artic') {
    // accordion joint between the two halves
    const bellows = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 2.3, 2.66),
      new THREE.MeshLambertMaterial({ color: 0x22242a }),
    );
    bellows.position.y = 1.7;
    g.add(bellows);
  } else if (modelId === 'electric') {
    // rooftop battery pack + a green energy flash on the nose
    const pack = new THREE.Mesh(
      new THREE.BoxGeometry(len * 0.55, 0.34, 1.7),
      new THREE.MeshLambertMaterial({ color: 0x2b2f36 }),
    );
    pack.position.y = 3.2;
    g.add(pack);
    const flash = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.5, 1.1),
      new THREE.MeshLambertMaterial({
        color: 0x37d67a, emissive: 0x1f8a4c, emissiveIntensity: 0.7,
      }),
    );
    flash.position.set(len / 2 + 0.03, 1.05, 0);
    g.add(flash);
  }

  const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.3, 2.3), glassMat2);
  windshield.position.set(len / 2 + 0.01, 1.9, 0);
  g.add(windshield);

  const headMat = new THREE.MeshLambertMaterial({
    color: 0xfff2c0, emissive: 0xfff2c0, emissiveIntensity: 1,
  });
  const tailMat = new THREE.MeshLambertMaterial({
    color: 0xff4444, emissive: 0xff2222, emissiveIntensity: 1,
  });
  const headlights: THREE.Mesh[] = [];
  const taillights: THREE.Mesh[] = [];
  for (const wz of [-0.9, 0.9]) {
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 6), headMat);
    hl.position.set(len / 2 + 0.05, 1.0, wz);
    hl.visible = false;
    g.add(hl);
    headlights.push(hl);
    const tl = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), tailMat);
    tl.position.set(-len / 2 - 0.05, 1.0, wz);
    tl.visible = false;
    g.add(tl);
    taillights.push(tl);
  }

  const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.35, 10);
  const wheelXs = modelId === 'artic' ? [-6.4, -2.2, 2.2, 6.4] : [-len / 2 + 1.4, len / 2 - 1.4];
  for (const wx of wheelXs) {
    for (const wz of [-1.15, 1.15]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.x = Math.PI / 2;
      w.position.set(wx, 0.55, wz);
      g.add(w);
    }
  }
  (g.userData as BusUserData).glassMats = [glassMat, glassMat2];
  (g.userData as BusUserData).headlights = headlights;
  (g.userData as BusUserData).taillights = taillights;
  return g;
}

function makeWalkerMesh(color: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 1.15, 6), mat);
  body.position.y = 0.62;
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 6, 6),
    new THREE.MeshLambertMaterial({ color: 0xe8c39e }),
  );
  head.position.y = 1.4;
  g.add(head);
  return g;
}
