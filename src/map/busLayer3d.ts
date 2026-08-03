import * as THREE from 'three';
import { MercatorCoordinate } from 'maplibre-gl';
import type { CustomLayerInterface, Map as MLMap } from 'maplibre-gl';
import type { BusLine, LineStats, LngLat } from '../game/types';
import { DWELL_SEC, LAYOVER_MIN } from '../game/constants';
import { busModel } from '../game/store';
import { pointAlong } from '../game/routing';

// Low-poly 3D buses that visibly drive their routes — the "watch them run"
// part of the brief. Rendered with Three.js inside a MapLibre custom layer,
// positions derived deterministically from the game clock and each line's
// timetable, so no per-frame simulation messages are needed.

interface LineAnim {
  line: BusLine;
  vehicles: number;
  headwayEff: number;
  /** piecewise (min -> distM) breakpoints for one outbound run */
  profT: number[];
  profD: number[];
  outboundMin: number;
  cycleMin: number;
  meshes: THREE.Group[];
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
  private pendingNetwork: { lines: BusLine[]; stats: LineStats[] } | null = null;
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
    if (this.pendingNetwork) {
      this.setNetwork(this.pendingNetwork.lines, this.pendingNetwork.stats);
      this.pendingNetwork = null;
    }
  }

  onRemove(): void {
    this.anims.forEach((a) => a.meshes.forEach((m) => this.scene.remove(m)));
    this.anims = [];
  }

  /** hour 0..24 -> tint lights for day/night */
  setDaylight(hour: number): void {
    // 0 = deep night, 1 = full day
    const day =
      hour < 5 || hour >= 21 ? 0 :
      hour < 7 ? (hour - 5) / 2 :
      hour < 19 ? 1 :
      1 - (hour - 19) / 2;
    this.ambient.intensity = 1.7 + day * 1.1;
    this.sun.intensity = 0.5 + day * 1.6;
    const warm = new THREE.Color(0xfff4e0);
    const night = new THREE.Color(0x9fb4de);
    this.sun.color = night.clone().lerp(warm, day);
  }

  setNetwork(lines: BusLine[], stats: LineStats[]): void {
    if (!this.renderer) {
      this.pendingNetwork = { lines, stats };
      return;
    }
    this.anims.forEach((a) => a.meshes.forEach((m) => this.scene.remove(m)));
    this.anims = [];
    for (const line of lines) {
      const st = stats.find((s) => s.lineId === line.id);
      if (!st || !line.active || st.vehiclesUsed <= 0 || line.path.length < 2) continue;
      const model = busModel(line.modelId);
      // outbound time profile with dwells
      const profT: number[] = [0];
      const profD: number[] = [0];
      let t = 0;
      for (let i = 1; i < line.stopIds.length; i++) {
        const d0 = line.stopDist[i - 1];
        const d1 = line.stopDist[i];
        t += ((d1 - d0) / 1000 / model.kmh) * 60;
        profT.push(t);
        profD.push(d1);
        if (i < line.stopIds.length - 1) {
          t += DWELL_SEC / 60;
          profT.push(t);
          profD.push(d1);
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
        profT,
        profD,
        outboundMin,
        cycleMin,
        meshes,
      });
    }
    this.map?.triggerRepaint();
  }

  private distAt(a: LineAnim, tMin: number): { d: number; forward: boolean } | null {
    const { outboundMin, cycleMin } = a;
    if (tMin < outboundMin) return { d: interp(a.profT, a.profD, tMin), forward: true };
    if (tMin < outboundMin + LAYOVER_MIN)
      return { d: a.line.pathLenM, forward: true };
    const tIn = tMin - outboundMin - LAYOVER_MIN;
    if (tIn < outboundMin)
      return { d: a.line.pathLenM - interp(a.profT, a.profD, tIn), forward: false };
    if (tMin < cycleMin) return { d: 0, forward: false };
    return null;
  }

  render(_gl: WebGLRenderingContext, matrix: unknown): void {
    const clock = this.getClockMin();
    const dayMin = ((clock % 1440) + 1440) % 1440;
    this.setDaylight(dayMin / 60);
    const zoom = this.map.getZoom();
    // scale buses toward a constant on-screen size (~22px long) so they read
    // like markers when zoomed out but stay bus-sized up close
    const mPerPx = (156543.03392 * this.cosLat) / Math.pow(2, zoom);
    const exaggerate = Math.min(Math.max((22 * mPerPx) / 11, 1.15), 26);

    this.lastFrame = [];
    for (const a of this.anims) {
      const { line } = a;
      const svcStart = line.firstHour * 60;
      const svcEnd = line.lastHour * 60;
      for (let k = 0; k < a.vehicles; k++) {
        const mesh = a.meshes[k];
        const firstDep = svcStart + k * a.headwayEff;
        // where is this vehicle in its repeating cycle today?
        let visible = false;
        let seenPt: LngLat | null = null;
        if (dayMin >= firstDep) {
          const since = dayMin - firstDep;
          const lastDepartureCutoff = svcEnd - firstDep;
          const cycleStart = Math.floor(since / a.cycleMin) * a.cycleMin;
          if (cycleStart <= lastDepartureCutoff) {
            const tInCycle = since - cycleStart;
            const pos = this.distAt(a, tInCycle);
            if (pos) {
              const { pt, bearing } = pointAlong(line.path, line.cum, pos.d);
              const b = pos.forward ? bearing : bearing + 180;
              const dx = (pt[0] - this.center[0]) * 111320 * this.cosLat;
              const dy = (pt[1] - this.center[1]) * 110540;
              mesh.position.set(dx, 0, -dy);
              mesh.rotation.y = Math.PI / 2 - (b * Math.PI) / 180;
              mesh.scale.setScalar(exaggerate);
              visible = true;
              seenPt = pt;
            }
          }
        }
        mesh.visible = visible;
        this.lastFrame.push({ line: line.id, k, pt: seenPt, visible });
      }
    }

    const m = new THREE.Matrix4().fromArray(Array.from(matrix as ArrayLike<number>));
    const l = new THREE.Matrix4()
      .makeTranslation(this.anchor.x, this.anchor.y, this.anchor.z)
      .scale(new THREE.Vector3(this.meterScale, -this.meterScale, this.meterScale))
      .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    this.camera.projectionMatrix = m.multiply(l);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    if (this.anims.length) this.map.triggerRepaint();
  }
}

function interp(ts: number[], ds: number[], t: number): number {
  if (t <= ts[0]) return ds[0];
  if (t >= ts[ts.length - 1]) return ds[ds.length - 1];
  let lo = 0;
  let hi = ts.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t) lo = mid;
    else hi = mid;
  }
  const span = ts[hi] - ts[lo];
  const f = span > 1e-9 ? (t - ts[lo]) / span : 0;
  return ds[lo] + (ds[hi] - ds[lo]) * f;
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
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1d1d20 });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xf5f2ea });

  const key = `body-${len}`;
  let bodyGeo = bodyGeoCache.get(key);
  if (!bodyGeo) {
    bodyGeo = new THREE.BoxGeometry(len, 2.1, 2.6);
    bodyGeoCache.set(key, bodyGeo);
  }
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 1.05 + 0.5;
  g.add(body);

  const windows = new THREE.Mesh(new THREE.BoxGeometry(len - 0.6, 0.9, 2.64), glassMat);
  windows.position.y = 2.35;
  g.add(windows);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(len - 0.4, 0.18, 2.4), roofMat);
  roof.position.y = 2.95;
  g.add(roof);

  const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.3, 2.3), glassMat);
  windshield.position.set(len / 2 + 0.01, 1.9, 0);
  g.add(windshield);

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
  return g;
}
