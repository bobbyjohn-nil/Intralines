import type { CityPack, DemoBuilding, LngLat } from '../types';

// Stylized 3D building footprints for the offline basemap, generated
// deterministically from census density: dense job-heavy block groups get
// tall clusters, quiet residential ones get low houses. Not real footprints —
// the online OpenFreeMap basemap shows those — but it keeps the tilt-into-3D
// feel with zero network.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pointInRing(pt: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1]) {
      const x = ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
      if (pt[0] < x) inside = !inside;
    }
  }
  return inside;
}

export function generateBuildings(pack: CityPack): DemoBuilding[] {
  const out: DemoBuilding[] = [];
  const cosLat = Math.cos((pack.meta.center[1] * Math.PI) / 180);
  const mLng = 1 / (111320 * cosLat); // meters -> deg lng
  const mLat = 1 / 110540;

  // city-wide density scale so "tall" is relative to this city
  const densities = pack.blockGroups.map(
    (bg) => (bg.pop + bg.jobs * 1.5) / Math.max(bg.areaKm2, 0.02),
  );
  const sorted = [...densities].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;

  for (let bi = 0; bi < pack.blockGroups.length; bi++) {
    const bg = pack.blockGroups[bi];
    const ring = bg.rings[0];
    if (!ring || ring.length < 4) continue;
    const rnd = mulberry32(hashStr(bg.id));
    const rel = Math.min(densities[bi] / p95, 1.4);
    if (rel < 0.02) continue;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of ring) {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
    }

    const count = Math.min(2 + Math.round(rel * 16), 18);
    const jobsShare = bg.jobs / Math.max(bg.pop + bg.jobs, 1);
    let placed = 0;
    for (let attempt = 0; attempt < count * 4 && placed < count; attempt++) {
      const cx = minX + rnd() * (maxX - minX);
      const cy = minY + rnd() * (maxY - minY);
      if (!pointInRing([cx, cy], ring)) continue;
      const w = (14 + rnd() * 34) * mLng;
      const d = (14 + rnd() * 34) * mLat;
      let h = 4 + rnd() * 6 + rel * 10;
      if (jobsShare > 0.55 && rel > 0.5) h = 14 + rnd() * (20 + rel * 45); // office core
      out.push({
        ring: [
          [cx - w / 2, cy - d / 2],
          [cx + w / 2, cy - d / 2],
          [cx + w / 2, cy + d / 2],
          [cx - w / 2, cy + d / 2],
        ],
        h: Math.round(h),
      });
      placed++;
    }
  }
  return out;
}
