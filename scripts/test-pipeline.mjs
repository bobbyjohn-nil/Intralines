// Fixture tests for the data pipeline (run: node scripts/test-pipeline.mjs).
// These cover the transforms we can't integration-test without network:
// way splitting, shape-point ordering, ring stitching, and the CSV parsers.

import assert from 'node:assert/strict';
import {
  buildRoadGraph, buildBlockGroups, parseAcs, parseScenic, parseWac, stitchRings,
} from '../src/game/data/pipeline.js';

const BBOX = [-71.9, 42.2, -71.7, 42.36];

// --- road graph: split at intersections, keep shape point order -------------
{
  // way 1: A -(s1)- B -(s2)- C  crossing way 2: D - B - E
  // node ids: A=1 s1=2 B=3 s2=4 C=5 D=6 E=7
  const overpass = {
    elements: [
      { type: 'node', id: 1, lon: -71.80, lat: 42.30 },
      { type: 'node', id: 2, lon: -71.79, lat: 42.301 }, // shape point
      { type: 'node', id: 3, lon: -71.78, lat: 42.30 },
      { type: 'node', id: 4, lon: -71.77, lat: 42.299 }, // shape point
      { type: 'node', id: 5, lon: -71.76, lat: 42.30 },
      { type: 'node', id: 6, lon: -71.78, lat: 42.31 },
      { type: 'node', id: 7, lon: -71.78, lat: 42.29 },
      { type: 'way', id: 100, nodes: [1, 2, 3, 4, 5], tags: { highway: 'residential' } },
      { type: 'way', id: 101, nodes: [6, 3, 7], tags: { highway: 'primary', maxspeed: '35 mph' } },
    ],
  };
  const g = buildRoadGraph(overpass, BBOX);
  assert.equal(g.nodes.length, 5, 'A,B,C,D,E are graph nodes (shape pts are not)');
  assert.equal(g.edges.length, 4, 'two ways split at shared node B into 4 edges');
  // every edge's shape points must progress monotonically away from endpoint a
  for (const e of g.edges) {
    const chain = [g.nodes[e.a], ...e.pts, g.nodes[e.b]];
    for (let i = 1; i < chain.length; i++) {
      assert.ok(
        Math.abs(chain[i][0] - chain[i - 1][0]) + Math.abs(chain[i][1] - chain[i - 1][1]) > 0,
        'no duplicate consecutive coordinates',
      );
    }
  }
  const primary = g.edges.filter((e) => e.kmh === 56); // 35 mph ≈ 56 km/h
  assert.equal(primary.length, 2, 'maxspeed mph parsed');
  const withShape = g.edges.filter((e) => e.pts.length > 0);
  assert.equal(withShape.length, 2, 'A-B and B-C keep their shape points');
}

// --- road graph: drops ways referencing missing nodes -----------------------
{
  const overpass = {
    elements: [
      { type: 'node', id: 1, lon: -71.8, lat: 42.3 },
      { type: 'node', id: 2, lon: -71.79, lat: 42.3 },
      { type: 'node', id: 10, lon: -71.75, lat: 42.31 },
      { type: 'node', id: 11, lon: -71.74, lat: 42.31 },
      { type: 'way', id: 200, nodes: [1, 2], tags: { highway: 'residential' } },
      { type: 'way', id: 201, nodes: [1, 999], tags: { highway: 'residential' } }, // missing node
      { type: 'way', id: 202, nodes: [10, 11], tags: { highway: 'residential' } }, // disconnected
    ],
  };
  const g = buildRoadGraph(overpass, BBOX);
  assert.equal(g.edges.length, 1, 'missing-node way dropped; smaller component dropped');
}

// --- ring stitching (multipolygon lakes) -------------------------------------
{
  const a = [[0, 0], [1, 0], [1, 1]];
  const b = [[1, 1], [0, 1]]; // continues from a's end
  const c = [[0, 0], [0, 1]]; // reversed continuation closing the ring
  const rings = stitchRings([a, b, c]);
  assert.equal(rings.length, 1, 'three segments stitch into one ring');
  const r = rings[0];
  assert.deepEqual(r[0], r[r.length - 1], 'ring is closed');
  assert.ok(r.length >= 5, 'ring has all corners');

  const broken = stitchRings([[[0, 0], [1, 0]], [[5, 5], [6, 6]]]);
  assert.equal(broken.length, 0, 'unstitchable fragments are dropped, not corrupted');
}

// --- scenic parser ------------------------------------------------------------
{
  const overpass = {
    elements: [
      {
        type: 'way',
        id: 1,
        tags: { natural: 'water' },
        geometry: [
          { lon: -71.80, lat: 42.30 }, { lon: -71.77, lat: 42.30 },
          { lon: -71.77, lat: 42.33 }, { lon: -71.80, lat: 42.33 },
          { lon: -71.80, lat: 42.30 },
        ],
      },
      {
        type: 'way',
        id: 2,
        tags: { leisure: 'park' },
        geometry: [
          { lon: -71.75, lat: 42.30 }, { lon: -71.73, lat: 42.30 },
          { lon: -71.73, lat: 42.32 }, { lon: -71.75, lat: 42.32 },
          { lon: -71.75, lat: 42.30 },
        ],
      },
      {
        type: 'way',
        id: 3,
        tags: { natural: 'water' },
        geometry: [
          // tiny pond, below area threshold — dropped
          { lon: -71.71, lat: 42.30 }, { lon: -71.7099, lat: 42.30 },
          { lon: -71.7099, lat: 42.3001 }, { lon: -71.71, lat: 42.3001 },
          { lon: -71.71, lat: 42.30 },
        ],
      },
    ],
  };
  const { water, parks } = parseScenic(overpass);
  assert.equal(water.length, 1, 'big lake kept, tiny pond dropped');
  assert.equal(parks.length, 1, 'park kept');
}

// --- ACS + WAC parsers ----------------------------------------------------------
{
  const rows = [
    ['B01003_001E', 'state', 'county', 'tract', 'block group'],
    ['1234', '25', '027', '730100', '1'],
    ['567', '25', '027', '730100', '2'],
  ];
  const pop = parseAcs(rows);
  assert.equal(pop.get('250277301001'), 1234);
  assert.equal(pop.get('250277301002'), 567);

  const wac = parseWac(
    'w_geocode,C000,CA01\n250277301001001,10,5\n250277301001002,7,2\n250277301002001,3,1\n',
  );
  assert.equal(wac.get('250277301001'), 17, 'blocks aggregate to block group');
  assert.equal(wac.get('250277301002'), 3);
}

// --- block group assembly -------------------------------------------------------
{
  const sq = (lng, lat, d) => [
    [lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat],
  ];
  const features = [
    {
      type: 'Feature',
      properties: { GEOID: '250277301001', AREALAND: 500000 },
      geometry: { type: 'Polygon', coordinates: [sq(-71.80, 42.30, 0.008)] },
    },
    {
      type: 'Feature',
      properties: { GEOID: '250277301002' },
      geometry: { type: 'Polygon', coordinates: [sq(-71.60, 42.30, 0.008)] }, // outside bbox
    },
  ];
  const pop = new Map([['250277301001', 900], ['250277301002', 500]]);
  const jobs = new Map([['250277301001', 300]]);
  const bgs = buildBlockGroups(features, pop, jobs, BBOX, [-71.8, 42.26]);
  assert.equal(bgs.length, 1, 'out-of-bbox block group filtered');
  assert.equal(bgs[0].pop, 900);
  assert.equal(bgs[0].jobs, 300);
  assert.ok(Math.abs(bgs[0].areaKm2 - 0.5) < 0.01, 'AREALAND used for area');
}

console.log('✓ all pipeline fixture tests passed');
