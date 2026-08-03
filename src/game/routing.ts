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
  private cosLat: number;

  constructor(public pack: CityPack) {
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
    this.cosLat = Math.cos((pack.meta.center[1] * Math.PI) / 180);
  }

  nearestNode(pt: LngLat, maxM = 220): number | null {
    const hit = this.grid.nearest(pt, maxM);
    return hit === null ? null : hit.item;
  }

  /** A* over edge lengths; returns full coordinate path including shape points */
  route(from: number, to: number): { path: LngLat[]; lenM: number } | null {
    if (from === to) return { path: [this.pack.nodes[from]], lenM: 0 };
    const n = this.pack.nodes.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const prevEdge = new Int32Array(n).fill(-1);
    const goal = this.pack.nodes[to];
    const h = (i: number) => fastDistM(this.pack.nodes[i], goal, this.cosLat);

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

    dist[from] = 0;
    push(h(from), from);
    const closed = new Uint8Array(n);
    while (heap.length) {
      const u = pop();
      if (u === to) break;
      if (closed[u]) continue;
      closed[u] = 1;
      for (const { to: v, edge, lenM } of this.adj[u]) {
        const nd = dist[u] + lenM;
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
    while (cur !== from) {
      const p = prev[cur];
      const e = this.pack.edges[prevEdge[cur]];
      const shape: LngLat[] = [this.pack.nodes[p], ...e.pts, this.pack.nodes[cur]];
      // edge shape points are stored a->b; reverse when traversing b->a
      if (e.a === cur) shape.reverse();
      segs.push(shape);
      cur = p;
    }
    segs.reverse();
    for (const s of segs) {
      const start = path.length ? 1 : 0;
      for (let i = start; i < s.length; i++) path.push(s[i]);
    }
    return { path, lenM: dist[to] };
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
  return (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
}
