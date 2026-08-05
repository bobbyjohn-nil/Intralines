import type { BlockGroup, LngLat, Poi, RoadEdge } from '../types';

export declare const ROAD_CLASSES: string[];
export declare function overpassPoiQuery(bbox: [number, number, number, number]): string;
export declare function parsePois(overpass: { elements: unknown[] }): Poi[];
export declare function applyPoiDemand(bgs: BlockGroup[], pois: Poi[]): void;
export declare function overpassQuery(bbox: [number, number, number, number]): string;
export declare function overpassScenicQuery(bbox: [number, number, number, number]): string;
export declare function parseScenic(overpass: { elements: unknown[] }): {
  water: LngLat[][];
  parks: LngLat[][];
};
export declare function stitchRings(segs: LngLat[][]): LngLat[][];
export declare function buildRoadGraph(
  overpass: { elements: unknown[] },
  bbox: [number, number, number, number],
): { nodes: LngLat[]; edges: RoadEdge[] };
export declare function parseAcs(rows: string[][]): Map<string, number>;
export declare function parseWac(csvText: string): {
  jobs: Map<string, number>;
  edu: Map<string, number>;
  tour: Map<string, number>;
};
export declare function parseRac(csvText: string): Map<string, number>;
export declare function buildBlockGroups(
  features: GeoJSON.Feature[],
  popByBg: Map<string, number>,
  jobsByBg: Map<string, number> | null,
  bbox: [number, number, number, number],
  center: LngLat,
  sectors?: { edu: Map<string, number>; tour: Map<string, number> },
): BlockGroup[];
export declare function estimateJobs(bgs: BlockGroup[], center: LngLat): void;
