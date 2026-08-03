import type { LngLat } from './types';

const R = 6371000;

export function haversineM(a: LngLat, b: LngLat): number {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** fast planar approximation, fine at city scale */
export function fastDistM(a: LngLat, b: LngLat, cosLat: number): number {
  const dx = (b[0] - a[0]) * 111320 * cosLat;
  const dy = (b[1] - a[1]) * 110540;
  return Math.sqrt(dx * dx + dy * dy);
}

export function polygonAreaKm2(ring: LngLat[]): number {
  // shoelace on an equirectangular projection around the ring's mid latitude
  if (ring.length < 3) return 0;
  const midLat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const cos = Math.cos((midLat * Math.PI) / 180);
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const x1 = p[0] * 111.32 * cos;
    const y1 = p[1] * 110.54;
    const x2 = q[0] * 111.32 * cos;
    const y2 = q[1] * 110.54;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

export function centroidOfRing(ring: LngLat[]): LngLat {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

/** simple radial-distance polyline simplification in degrees */
export function simplifyRing(ring: LngLat[], tolDeg: number): LngLat[] {
  if (ring.length <= 8) return ring;
  const out: LngLat[] = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const last = out[out.length - 1];
    const p = ring[i];
    if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) > tolDeg) out.push(p);
  }
  if (out.length < 4) return ring;
  return out;
}

export function bearingDeg(a: LngLat, b: LngLat): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

/** Uniform spatial hash for nearest-point queries. */
export class SpatialGrid<T> {
  private cells = new Map<string, { pt: LngLat; item: T }[]>();
  constructor(private cellDeg: number) {}

  private key(lng: number, lat: number): string {
    return `${Math.floor(lng / this.cellDeg)}:${Math.floor(lat / this.cellDeg)}`;
  }

  add(pt: LngLat, item: T): void {
    const k = this.key(pt[0], pt[1]);
    let arr = this.cells.get(k);
    if (!arr) {
      arr = [];
      this.cells.set(k, arr);
    }
    arr.push({ pt, item });
  }

  /** all items within radiusM of pt (approximate ring search) */
  within(pt: LngLat, radiusM: number): { pt: LngLat; item: T; distM: number }[] {
    const cosLat = Math.cos((pt[1] * Math.PI) / 180);
    const radDegLng = radiusM / (111320 * Math.max(cosLat, 0.2));
    const radDegLat = radiusM / 110540;
    const span = Math.max(radDegLng, radDegLat);
    const out: { pt: LngLat; item: T; distM: number }[] = [];
    const x0 = Math.floor((pt[0] - span) / this.cellDeg);
    const x1 = Math.floor((pt[0] + span) / this.cellDeg);
    const y0 = Math.floor((pt[1] - span) / this.cellDeg);
    const y1 = Math.floor((pt[1] + span) / this.cellDeg);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const arr = this.cells.get(`${x}:${y}`);
        if (!arr) continue;
        for (const e of arr) {
          const d = fastDistM(pt, e.pt, cosLat);
          if (d <= radiusM) out.push({ ...e, distM: d });
        }
      }
    }
    out.sort((a, b) => a.distM - b.distM);
    return out;
  }

  nearest(pt: LngLat, maxM: number): { pt: LngLat; item: T; distM: number } | null {
    const hits = this.within(pt, maxM);
    return hits.length ? hits[0] : null;
  }
}
