import type { CityPack, LngLat } from './types';
import { SpatialGrid, fastDistM } from './geo';

interface Adj {
  to: number;
  edge: number;
  lenM: number;
}

/**
 * Road graph wrapper: nearest-node snapping and A* shortest paths, used by the
 * line editor to make routes follow real streets.
 */
export class RoadGraph {
  private adj: Adj[][];
  private grid: SpatialGrid<number>;
  private edgeGrid: SpatialGrid<number>;
  private cosLat: number;

  constructor(public pack: CityPack) {
    this.cosLat = Math.cos((pack.meta.center[1] * Math.PI) / 180);
    this.adj = [];
    this.grid = new SpatialGrid<number>(0.004);
    this.edgeGrid = new SpatialGrid<number>(0.004);
    this.rebuildIndexes();
  }

  private rebuildIndexes(): void {
    const { pack } = this;
    const n = pack.nodes.length;
    this.adj = Array.from({ length: n }, () => []);
    pack.edges.forEach((e, i) => {
      this.adj[e.a].push({ to: e.b, edge: i, lenM: e.lenM });
      this.adj[e.b].push({ to: e.a, edge: i, lenM: e.lenM });
    });
    this.grid = new SpatialGrid<number>(0.004);
    pack.nodes.forEach((pt, i) => {
      if (this.adj[i].length > 0) this.grid.add(pt, i);
    });
    // index edges by sample points along their shape so clicks can find the
    // nearest street, not just the nearest intersection
    this.edgeGrid = new SpatialGrid<number>(0.004);
    pack.edges.forEach((e, i) => this.indexEdge(i));
  }

  private indexEdge(i: number): void {
    const e = this.pack.edges[i];
    const chain: LngLat[] = [this.pack.nodes[e.a], ...e.pts, this.pack.nodes[e.b]];
    for (let s = 0; s < chain.length - 1; s++) {
      const a = chain[s];
      const b = chain[s + 1];
      const len = fastDistM(a, b, this.cosLat);
      const steps = Math.max(1, Math.ceil(len / 90));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        this.edgeGrid.add([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], i);
      }
    }
  }

  nearestNode(pt: LngLat, maxM = 220): number | null {
    const hit = this.grid.nearest(pt, maxM);
    return hit === null ? null : hit.item;
  }

  /** name a stop after the street(s) meeting at its node */
  stopNameAt(node: number): string | null {
    const names: string[] = [];
    for (const { edge } of this.adj[node] ?? []) {
      const n = this.pack.edges[edge]?.name;
      if (n && !names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
      if (names.length === 2) break;
    }
    if (!names.length) return null;
    return names.length === 2 ? `${names[0]} & ${names[1]}` : names[0];
  }

  /** quantized coordinate keys of every real street intersection (degree >= 3) */
  intersectionKeys(): Set<string> {
    const out = new Set<string>();
    for (let i = 0; i < this.adj.length; i++) {
      if (this.adj[i].length >= 3) {
        const p = this.pack.nodes[i];
        out.add(`${Math.round(p[0] * 1e5)}:${Math.round(p[1] * 1e5)}`);
      }
    }
    return out;
  }

  /**
   * Precise stop placement: project the click onto the nearest street and
   * split that street there, creating a routable node exactly at the curb —
   * mid-block stops included. Falls back to an existing node when the
   * projection lands on one.
   */
  insertStopNode(pt: LngLat, maxM = 220): number | null {
    const candidates = new Set<number>();
    for (const hit of this.edgeGrid.within(pt, maxM)) candidates.add(hit.item);
    if (!candidates.size) return null;

    let best: { edge: number; distM: number; proj: LngLat; alongM: number } | null = null;
    for (const ei of candidates) {
      const e = this.pack.edges[ei];
      const chain: LngLat[] = [this.pack.nodes[e.a], ...e.pts, this.pack.nodes[e.b]];
      let along = 0;
      for (let s = 0; s < chain.length - 1; s++) {
        const a = chain[s];
        const b = chain[s + 1];
        const segLen = fastDistM(a, b, this.cosLat);
        if (segLen < 0.5) continue;
        // project pt onto segment ab in local meters
        const ax = 0;
        const ay = 0;
        const bx = (b[0] - a[0]) * 111320 * this.cosLat;
        const by = (b[1] - a[1]) * 110540;
        const px = (pt[0] - a[0]) * 111320 * this.cosLat;
        const py = (pt[1] - a[1]) * 110540;
        const t = Math.max(0, Math.min(1, (px * bx + py * by) / (bx * bx + by * by)));
        const qx = ax + bx * t;
        const qy = ay + by * t;
        const d = Math.hypot(px - qx, py - qy);
        if (d <= maxM && (!best || d < best.distM)) {
          best = {
            edge: ei,
            distM: d,
            proj: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
            alongM: along + segLen * t,
          };
        }
        along += segLen;
      }
    }
    if (!best) return null;

    const e = this.pack.edges[best.edge];
    // snap to an endpoint if the projection is basically on it
    if (best.alongM < 12) return e.a;
    if (e.lenM - best.alongM < 12) return e.b;

    // split the edge at the projection
    const chain: LngLat[] = [this.pack.nodes[e.a], ...e.pts, this.pack.nodes[e.b]];
    const ptsA: LngLat[] = [];
    const ptsB: LngLat[] = [];
    let along = 0;
    let placed = false;
    for (let s = 0; s < chain.length - 1; s++) {
      const a = chain[s];
      const b = chain[s + 1];
      const segLen = fastDistM(a, b, this.cosLat);
      if (!placed && along + segLen >= best.alongM - 0.01) {
        placed = true;
      } else if (!placed) {
        ptsA.push(b);
      } else {
        ptsB.push(a);
      }
      along += segLen;
    }
    // ptsA: interior points before the split; ptsB: interior points after
    // (the loop above collects b's before the split segment and a's after it)
    const newNode = this.pack.nodes.length;
    this.pack.nodes.push([best.proj[0], best.proj[1]]);
    const lenA = Math.max(1, Math.round(best.alongM));
    const lenB = Math.max(1, Math.round(e.lenM - best.alongM));
    const oldB = e.b;
    const edgeIdx = best.edge;
    // reuse the original edge slot for the first half (keeps other indexes valid)
    e.b = newNode;
    e.pts = ptsA;
    e.lenM = lenA;
    const newEdgeIdx = this.pack.edges.length;
    this.pack.edges.push({ a: newNode, b: oldB, lenM: lenB, kmh: e.kmh, pts: ptsB, name: e.name });

    // incremental index update (full rebuilds are too slow on real cities)
    this.adj.push([]);
    const adjA = this.adj[e.a];
    const entA = adjA.find((x) => x.edge === edgeIdx);
    if (entA) {
      entA.to = newNode;
      entA.lenM = lenA;
    }
    this.adj[oldB] = this.adj[oldB].filter((x) => x.edge !== edgeIdx);
    this.adj[oldB].push({ to: newNode, edge: newEdgeIdx, lenM: lenB });
    this.adj[newNode].push({ to: e.a, edge: edgeIdx, lenM: lenA });
    this.adj[newNode].push({ to: oldB, edge: newEdgeIdx, lenM: lenB });
    this.grid.add(this.pack.nodes[newNode], newNode);
    this.indexEdge(newEdgeIdx);
    // stale samples for the shortened edge still resolve correctly: they
    // project onto its (clamped) remaining extent while the new edge has
    // fresh samples of its own.
    return newNode;
  }

  /** A* over edge lengths; returns full coordinate path including shape points */
  route(from: number, to: number): { path: LngLat[]; lenM: number } | null {
    if (from === to) return { path: [this.pack.nodes[from]], lenM: 0 };
    const n = this.pack.nodes.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const prevEdge = new Int32Array(n).fill(-1);
    const goal = this.pack.nodes[to];
    const h = (i: number) =>
      (fastDistM(this.pack.nodes[i], goal, this.cosLat) / (MAX_COST_KMH / 3.6));

    // binary heap of [f, node]
    const heap: number[] = [];
    const heapNodes: number[] = [];
    const push = (f: number, node: number) => {
      let i = heap.length;
      heap.push(f);
      heapNodes.push(node);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p] <= heap[i]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        [heapNodes[p], heapNodes[i]] = [heapNodes[i], heapNodes[p]];
        i = p;
      }
    };
    const pop = (): number => {
      const top = heapNodes[0];
      const lf = heap.pop()!;
      const ln = heapNodes.pop()!;
      if (heap.length) {
        heap[0] = lf;
        heapNodes[0] = ln;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l] < heap[m]) m = l;
          if (r < heap.length && heap[r] < heap[m]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          [heapNodes[m], heapNodes[i]] = [heapNodes[i], heapNodes[m]];
          i = m;
        }
      }
      return top;
    };

    // travel-time routing: buses prefer faster arterials over shortcut
    // side streets, like real bus lines. Costs are seconds. Speeds are
    // compressed toward 30 km/h so an arterial is worth a modest detour,
    // never a lap around the block (52 vs 30 km/h ≈ 1.7x raw but only
    // ~1.3x compressed).
    const costKmh = (kmh: number) => 30 + (kmh - 30) * 0.5;
    const MAX_COST_KMH = 66; // costKmh(100), pipeline clamps kmh to <= 100
    const turnPenaltySec = (w: number, u: number, v: number): number => {
      if (w < 0) return 0;
      const A = this.pack.nodes[w];
      const B = this.pack.nodes[u];
      const C = this.pack.nodes[v];
      const d1 = Math.atan2((B[0] - A[0]) * this.cosLat, B[1] - A[1]);
      const d2 = Math.atan2((C[0] - B[0]) * this.cosLat, C[1] - B[1]);
      let deg = Math.abs(((d2 - d1) * 180) / Math.PI);
      if (deg > 180) deg = 360 - deg;
      if (deg < 30) return 0;
      if (deg < 70) return 4;
      if (deg < 120) return 10;
      return 14; // sharp turns / U-turns
    };

    dist[from] = 0;
    push(h(from), from);
    const closed = new Uint8Array(n);
    while (heap.length) {
      const u = pop();
      if (u === to) break;
      if (closed[u]) continue;
      closed[u] = 1;
      for (const { to: v, edge, lenM } of this.adj[u]) {
        const kmh = this.pack.edges[edge].kmh || 30;
        const travelSec = lenM / (costKmh(kmh) / 3.6);
        const nd = dist[u] + travelSec + turnPenaltySec(prev[u], u, v);
        if (nd < dist[v]) {
          dist[v] = nd;
          prev[v] = u;
          prevEdge[v] = edge;
          push(nd + h(v), v);
        }
      }
    }
    if (!isFinite(dist[to])) return null;

    const path: LngLat[] = [];
    let cur = to;
    const segs: LngLat[][] = [];
    let trueLenM = 0;
    while (cur !== from) {
      const p = prev[cur];
      const e = this.pack.edges[prevEdge[cur]];
      trueLenM += e.lenM;
      // edge shape points are stored a->b; flip them when traversing b->a so
      // the drawn route never zigzags back on itself
      const mid = e.a === p ? e.pts : [...e.pts].reverse();
      segs.push([this.pack.nodes[p], ...mid, this.pack.nodes[cur]]);
      cur = p;
    }
    segs.reverse();
    for (const s of segs) {
      const start = path.length ? 1 : 0;
      for (let i = start; i < s.length; i++) path.push(s[i]);
    }
    return { path, lenM: trueLenM };
  }
}

export function cumulativeDist(path: LngLat[], cosLat: number): number[] {
  const cum = new Array<number>(path.length);
  cum[0] = 0;
  for (let i = 1; i < path.length; i++) {
    cum[i] = cum[i - 1] + fastDistM(path[i - 1], path[i], cosLat);
  }
  return cum;
}

/** point + heading at distance d along a path with precomputed cumulative dist */
export function pointAlong(
  path: LngLat[],
  cum: number[],
  d: number,
): { pt: LngLat; bearing: number } {
  if (d <= 0) return { pt: path[0], bearing: segBearing(path, 0) };
  const total = cum[cum.length - 1];
  if (d >= total) return { pt: path[path.length - 1], bearing: segBearing(path, path.length - 2) };
  // binary search
  let lo = 0;
  let hi = cum.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const t = (d - cum[lo]) / Math.max(cum[hi] - cum[lo], 1e-6);
  const a = path[lo];
  const b = path[hi];
  return {
    pt: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    bearing: segBearing(path, lo),
  };
}

function segBearing(path: LngLat[], i: number): number {
  const a = path[Math.max(0, Math.min(i, path.length - 2))];
  const b = path[Math.max(1, Math.min(i + 1, path.length - 1))];
  // scale Δlng by cos(lat) so buses align with streets at any latitude
  const cos = Math.cos((a[1] * Math.PI) / 180);
  return (Math.atan2((b[0] - a[0]) * cos, b[1] - a[1]) * 180) / Math.PI;
}
