import type { BlockGroup, LngLat, RoadEdge } from '../types';

export declare const ROAD_CLASSES: string[];
export declare function overpassQuery(bbox: [number, number, number, number]): string;
export declare function buildRoadGraph(
  overpass: { elements: unknown[] },
  bbox: [number, number, number, number],
): { nodes: LngLat[]; edges: RoadEdge[] };
export declare function parseAcs(rows: string[][]): Map<string, number>;
export declare function parseWac(csvText: string): Map<string, number>;
export declare function buildBlockGroups(
  features: GeoJSON.Feature[],
  popByBg: Map<string, number>,
  jobsByBg: Map<string, number> | null,
  bbox: [number, number, number, number],
  center: LngLat,
): BlockGroup[];
export declare function estimateJobs(bgs: BlockGroup[], center: LngLat): void;
