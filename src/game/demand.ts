// Turning census demand into something a player can act on.
//
// The raw data is one figure per census block group — several hundred of them
// for a real city. Drawn straight onto the map that is a fog of dots: it says
// "people live here", which is true everywhere, and answers no question you
// actually have. What you want to know is where the biggest pockets of demand
// are, and which of them your network is still missing.
//
// So the block groups are pooled into neighbourhood-sized cells, ranked, and
// cut to a handful — each one either already within a short walk of one of
// your stops, or not.

import type { CityPack, LngLat, Stop } from './types';
import { MAX_WALK_M } from './constants';
import { fastDistM } from './geo';

/**
 * Two questions worth asking of a city, not seven. Tourism and education were
 * always subsets of the jobs figure, and airport and rail trips are destinations
 * like any other — splitting them out made six layers that mostly redrew each
 * other.
 */
export type DemandMode = 'pop' | 'dest';

export interface DemandSpot {
  /** demand-weighted centre of the pocket */
  pt: LngLat;
  /** people (or trips) per day this pocket generates */
  value: number;
  /** already within a short walk of one of your stops */
  served: boolean;
  /** 1 = the city's biggest pocket of this kind */
  rank: number;
}

/** roughly a neighbourhood across, in degrees of longitude/latitude */
const CELL_DEG = 0.012;
/** how many pockets are worth showing at once */
export const MAX_SPOTS = 12;

export function demandValue(
  bg: CityPack['blockGroups'][number],
  mode: DemandMode,
): number {
  if (mode === 'pop') return bg.pop;
  // jobs already counts the campus and hotel work; the airport and the rail
  // station pull their own trips on top
  return bg.jobs + (bg.air ?? 0) + (bg.rail ?? 0);
}

/**
 * The biggest pockets of a given kind of demand, strongest first, each marked
 * with whether your stops already reach it.
 */
export function demandSpots(
  pack: CityPack,
  mode: DemandMode,
  stops: Stop[],
): DemandSpot[] {
  const cells = new Map<string, { sum: number; lng: number; lat: number }>();
  for (const bg of pack.blockGroups) {
    const v = demandValue(bg, mode);
    if (v <= 0) continue;
    const key = `${Math.floor(bg.centroid[0] / CELL_DEG)}:${Math.floor(bg.centroid[1] / CELL_DEG)}`;
    const cell = cells.get(key) ?? { sum: 0, lng: 0, lat: 0 };
    cell.sum += v;
    // weighted so the marker lands on the busy part of the cell, not its
    // geometric middle — which could easily be a river or a rail yard
    cell.lng += bg.centroid[0] * v;
    cell.lat += bg.centroid[1] * v;
    cells.set(key, cell);
  }

  const cosLat = Math.cos((pack.meta.center[1] * Math.PI) / 180);
  return [...cells.values()]
    .map((c) => ({ pt: [c.lng / c.sum, c.lat / c.sum] as LngLat, value: c.sum }))
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_SPOTS)
    .map((c, i) => ({
      ...c,
      rank: i + 1,
      served: stops.some((s) => fastDistM(s.pt, c.pt, cosLat) <= MAX_WALK_M),
    }));
}
