import * as THREE from 'three';
import { MercatorCoordinate } from 'maplibre-gl';
import type { CustomLayerInterface, Map as MLMap } from 'maplibre-gl';
import type { BusLine, LineStats, LngLat, Stop } from '../game/types';
import { DWELL_SEC, LAYOVER_MIN, trafficFactor } from '../game/constants';
import { busModel } from '../game/store';
import { pointAlong } from '../game/routing';

// The living-city layer: low-poly 3D buses that ease in and out of stops,
// pause at lights, crawl through rush hour and light up at night — plus
// little pedestrians walking to busy stops. Everything is a deterministic
// function of the game clock, so no per-frame simulation messages are needed.

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

interface LineAnim {
  line: BusLine;
  vehicles: number;
  headwayEff: number;
  segs: DriveSeg[]; // one outbound run, dwells included
  outboundMin: number;
  cycleMin: number;
  meshes: THREE.Group[];
  seed: number;
}

interface StopDemand {
  pt: LngLat;
  hourly: number[]; // boardings/hour arriving at this stop
}

const WALKER_POOL = 110;
const WALK_SPEED_M_PER_MIN = 82;
const WALKER_COLORS = [0x8d6e63, 0x5c6bc0, 0x6d8b74, 0xb0716a, 0x7e7a9a, 0x936f4f];

function hash32(x: number): number {
  x |= 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** deterministic 0..1 from a list of ints */
function rand01(...keys: number[]): number {
  let h = 0x9e3779b9;
  for (const k of keys) h = hash32(h ^ (k | 0));
  return h / 4294967296;
}

const easeInOut = (u: number): number => u * u * (3 - 2 * u);

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
  private pendingNetwork: { lines: BusLine[]; stats: LineStats[]; stops: Stop[] } | null = null;

  // pedestrians
  private stopDemand: StopDemand[] = [];
  private walkerMeshes: THREE.Group[] = [];
  private walkerWeightsHour = -1;
  private walkerCum: number[] = [];
  private walkerTotal = 0;

  /** last-rendered vehicle states, for tests/debugging */
  lastFrame: { line: string; k: number; pt: LngLat | null; visible: boolean }[] = [];

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
    for (let i = 0; i < WALKER_POOL; i++) {
      const w = makeWalkerMesh(WALKER_COLORS[i % WALKER_COLORS.length]);
      w.visible = false;
      this.scene.add(w);
      this.walkerMeshes.push(w);
    }
    if (this.pendingNetwork) {
      const { lines, stats, stops } = this.pendingNetwork;
      this.pendingNetwork = null;
      this.setNetwork(lines, stats, stops);
    }
  }

  onRemove(): void {
    this.anims.forEach((a) => a.meshes.forEach((m) => this.scene.remove(m)));
    this.walkerMeshes.forEach((m) => this.scene.remove(m));
    this.anims = [];
    this.walkerMeshes = [];
  }

  /** hour 0..24 -> 0 = deep night, 1 = full day */
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

  setNetwork(lines: BusLine[], stats: LineStats[], stops: Stop[]): void {
    if (!this.renderer) {
      this.pendingNetwork = { lines, stats, stops };
      return;
    }
    this.anims.forEach((a) => a.meshes.forEach((m) => this.scene.remove(m)));
    this.anims = [];

    // per-stop demand for pedestrian spawning
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
    this.stopDemand = stops
      .filter((s) => rate.has(s.id))
      .map((s) => ({ pt: s.pt, hourly: rate.get(s.id)! }));
    this.walkerWeightsHour = -1; // force weight rebuild

    for (const line of lines) {
      const st = stats.find((s) => s.lineId === line.id);
      if (!st || !line.active || st.vehiclesUsed <= 0 || line.path.length < 2) continue;
      const model = busModel(line.modelId);

      // outbound time profile: drive segments (eased) + dwells at stops
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
        const g = makeBusMesh(line.color, model.id);
        g.visible = false;
        this.scene.add(g);
        meshes.push(g);
      }
      this.anims.push({
        line,
        vehicles: st.vehiclesUsed,
        headwayEff: st.headwayEffMin,
        segs,
        outboundMin,
        cycleMin,
        meshes,
        seed: hash32(line.id.split('').reduce((s, c) => s * 31 + c.charCodeAt(0), 7)),
      });
    }
    this.map?.triggerRepaint();
  }

  /**
   * Distance along one outbound run at profile-time t, with eased stop
   * approaches and deterministic "red light / traffic" holds inside drive
   * segments. Holds get longer as congestion rises.
   */
  private outboundDist(a: LineAnim, t: number, cycleIdx: number, veh: number, congestion: number): number {
    for (let i = 0; i < a.segs.length; i++) {
      const s = a.segs[i];
      if (t > s.t1) continue;
      if (!s.drive) return s.d0;
      let u = (t - s.t0) / Math.max(s.t1 - s.t0, 1e-6);

      // up to 2 holds per segment; probability and length scale with traffic
      const jam = Math.max(0, congestion - 0.95);
      let holdTotal = 0;
      const holds: { at: number; len: number }[] = [];
      for (let hIdx = 0; hIdx < 2; hIdx++) {
        const roll = rand01(a.seed, veh, cycleIdx, i, hIdx);
        if (roll < 0.18 + jam * 0.9) {
          const at = 0.15 + 0.7 * rand01(a.seed, veh, cycleIdx, i, hIdx + 10);
          const len = (0.04 + 0.1 * rand01(a.seed, veh, cycleIdx, i, hIdx + 20)) * (1 + jam);
          holds.push({ at, len });
          holdTotal += len;
        }
      }
      if (holdTotal > 0.45) {
        const f = 0.45 / holdTotal;
        holds.forEach((h) => (h.len *= f));
        holdTotal = 0.45;
      }
      // warp time-fraction u so the bus freezes during holds
      let moved = 0;
      let cursor = 0;
      holds.sort((x, y) => x.at - y.at);
      for (const h of holds) {
        const start = Math.max(h.at, cursor); // ignore overlap with prior hold
        if (u <= start) break;
        moved += Math.min(u, start) - cursor;
        cursor = start;
        const inHold = Math.min(u - start, h.len);
        cursor += inHold; // time passes, no movement
        if (u <= start + h.len) break;
      }
      if (u > cursor) moved += u - cursor;
      const uEff = Math.min(moved / Math.max(1 - holdTotal, 0.55), 1);
      return s.d0 + (s.d1 - s.d0) * easeInOut(uEff);
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

  /** heading that looks 8m ahead so corners are rounded, not snapped */
  private smoothBearing(line: BusLine, d: number, forward: boolean): { pt: LngLat; bearing: number } {
    const { pt } = pointAlong(line.path, line.cum, d);
    const ahead = forward ? Math.min(d + 8, line.pathLenM) : Math.max(d - 8, 0);
    const { pt: pt2 } = pointAlong(line.path, line.cum, ahead);
    const dx = (pt2[0] - pt[0]) * this.cosLat;
    const dy = pt2[1] - pt[1];
    let bearing;
    if (Math.abs(dx) + Math.abs(dy) < 1e-9) {
      bearing = pointAlong(line.path, line.cum, d).bearing + (forward ? 0 : 180);
    } else {
      bearing = (Math.atan2(dx, dy) * 180) / Math.PI;
    }
    return { pt, bearing };
  }

  private toLocal(pt: LngLat): { x: number; z: number } {
    return {
      x: (pt[0] - this.center[0]) * 111320 * this.cosLat,
      z: -(pt[1] - this.center[1]) * 110540,
    };
  }

  render(_gl: WebGLRenderingContext, matrix: unknown): void {
    const clock = this.getClockMin();
    const dayMin = ((clock % 1440) + 1440) % 1440;
    const hour = dayMin / 60;
    const day = this.dayFactor(hour);
    const congestion = trafficFactor(hour);
    this.setDaylight(day);
    const zoom = this.map.getZoom();
    const mPerPx = (156543.03392 * this.cosLat) / Math.pow(2, zoom);
    const busScale = Math.min(Math.max((22 * mPerPx) / 11, 1.15), 26);

    this.lastFrame = [];
    for (const a of this.anims) {
      const { line } = a;
      const svcStart = line.firstHour * 60;
      const svcEnd = line.lastHour * 60;
      const cycleEff = a.cycleMin * congestion; // rush hour stretches trips
      for (let k = 0; k < a.vehicles; k++) {
        const mesh = a.meshes[k];
        const firstDep = svcStart + k * a.headwayEff;
        let visible = false;
        let seenPt: LngLat | null = null;
        if (dayMin >= firstDep) {
          const since = dayMin - firstDep;
          const lastDepartureCutoff = svcEnd - firstDep;
          const cycleIdx = Math.floor(since / cycleEff);
          const cycleStart = cycleIdx * cycleEff;
          if (cycleStart <= lastDepartureCutoff) {
            const tProfile = (since - cycleStart) / congestion;
            const pos = this.distAt(a, tProfile, cycleIdx, k, congestion);
            if (pos) {
              const { pt, bearing } = this.smoothBearing(line, pos.d, pos.forward);
              const b = pos.forward ? bearing : bearing + 180;
              const { x, z } = this.toLocal(pt);
              mesh.position.set(x, 0, z);
              mesh.rotation.y = Math.PI / 2 - (b * Math.PI) / 180;
              mesh.scale.setScalar(busScale);
              applyBusLighting(mesh, day);
              visible = true;
              seenPt = pt;
            }
          }
        }
        mesh.visible = visible;
        this.lastFrame.push({ line: line.id, k, pt: seenPt, visible });
      }
    }

    this.renderWalkers(clock, dayMin, zoom, mPerPx);

    const m = new THREE.Matrix4().fromArray(Array.from(matrix as ArrayLike<number>));
    const l = new THREE.Matrix4()
      .makeTranslation(this.anchor.x, this.anchor.y, this.anchor.z)
      .scale(new THREE.Vector3(this.meterScale, -this.meterScale, this.meterScale))
      .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    this.camera.projectionMatrix = m.multiply(l);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    if (this.anims.length || this.stopDemand.length) this.map.triggerRepaint();
  }

  /** pedestrians streaming to stops, more of them where and when demand is high */
  private renderWalkers(clock: number, dayMin: number, zoom: number, mPerPx: number): void {
    const hourInt = Math.floor(dayMin / 60) % 24;
    if (!this.stopDemand.length || zoom < 13.8) {
      this.walkerMeshes.forEach((m) => (m.visible = false));
      return;
    }
    if (hourInt !== this.walkerWeightsHour) {
      this.walkerWeightsHour = hourInt;
      this.walkerCum = [];
      let acc = 0;
      for (const sd of this.stopDemand) {
        acc += sd.hourly[hourInt];
        this.walkerCum.push(acc);
      }
      this.walkerTotal = acc;
    }
    const active =
      this.walkerTotal <= 0.5
        ? 0
        : Math.min(WALKER_POOL, Math.max(8, Math.round(this.walkerTotal / 4)));
    const scale = Math.min(Math.max((7 * mPerPx) / 1.7, 1), 12);
    const epoch = hourInt; // re-seed hourly so crowds follow demand

    for (let i = 0; i < this.walkerMeshes.length; i++) {
      const mesh = this.walkerMeshes[i];
      if (i >= active) {
        mesh.visible = false;
        continue;
      }
      // pick a stop weighted by demand
      const pickR = rand01(i, epoch, 1) * this.walkerTotal;
      let si = 0;
      while (si < this.walkerCum.length - 1 && this.walkerCum[si] < pickR) si++;
      const stop = this.stopDemand[si];

      const ang = rand01(i, epoch, 2) * Math.PI * 2;
      const distM = 55 + rand01(i, epoch, 3) * 90;
      const walkMin = distM / WALK_SPEED_M_PER_MIN;
      const cycle = walkMin + 0.5; // walk, wait a moment at the stop, respawn
      const phase = rand01(i, epoch, 4) * cycle;
      const tW = (clock / 1 + phase) % cycle;

      const target = this.toLocal(stop.pt);
      const sx = target.x + Math.cos(ang) * distM;
      const sz = target.z + Math.sin(ang) * distM;
      let x: number;
      let z: number;
      if (tW < walkMin) {
        const f = tW / walkMin;
        x = sx + (target.x - sx) * f;
        z = sz + (target.z - sz) * f;
        mesh.rotation.y = Math.atan2(target.x - sx, target.z - sz);
        // a little bob while walking (scaled so it stays proportional)
        mesh.position.y = Math.abs(Math.sin(tW * 220)) * 0.16 * scale;
      } else {
        x = target.x + Math.cos(ang) * 3.5 * Math.min(scale, 3); // waiting beside the stop
        z = target.z + Math.sin(ang) * 3.5 * Math.min(scale, 3);
        mesh.position.y = 0;
      }
      mesh.position.x = x;
      mesh.position.z = z;
      mesh.scale.setScalar(scale);
      mesh.visible = true;
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

function makeBusMesh(color: string, modelId: string): THREE.Group {
  const len = modelId === 'artic' ? 16 : modelId === 'minibus' ? 7 : 11;
  const g = new THREE.Group();
  const bodyColor = new THREE.Color(color);
  const bodyMat = new THREE.MeshLambertMaterial({
    color: bodyColor,
    emissive: bodyColor.clone().multiplyScalar(0.28),
  });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x33404f });
  const glassMat2 = new THREE.MeshLambertMaterial({ color: 0x33404f });
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1d1d20 });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xf5f2ea });

  const key = `body-${len}`;
  let bodyGeo = bodyGeoCache.get(key);
  if (!bodyGeo) {
    bodyGeo = new THREE.BoxGeometry(len, 2.1, 2.6);
    bodyGeoCache.set(key, bodyGeo);
  }
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 1.55;
  g.add(body);

  const windows = new THREE.Mesh(new THREE.BoxGeometry(len - 0.6, 0.9, 2.64), glassMat);
  windows.position.y = 2.35;
  g.add(windows);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(len - 0.4, 0.18, 2.4), roofMat);
  roof.position.y = 2.95;
  g.add(roof);

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
