// Generates public/models/sample.glb — a deliberately crude box bus that
// exists to prove the custom-model pipeline end to end and to demonstrate
// the naming conventions (materials "Brand"/"Stripe", node "DoorCurb").
// Art teams: this is the contract, not the quality bar. See docs/MODELS.md.
//
// Usage: node scripts/make-sample-model.mjs [busModelId]
//   writes public/models/sample.glb and a manifest entry for busModelId
//   (default: citybus). Delete public/models/ to go back to built-ins.

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'models');
const target = process.argv[2] ?? 'citybus';

// --- geometry: three boxes (body, stripe, door), +X forward, y=0 ground ---
function box(cx, cy, cz, sx, sy, sz) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2;
  const y0 = cy - sy / 2, y1 = cy + sy / 2;
  const z0 = cz - sz / 2, z1 = cz + sz / 2;
  // 8 corners, 12 triangles, flat-ish shading is fine for a sample
  const v = [
    [x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],
    [x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],
  ];
  const idx = [
    0,1,2, 0,2,3,  4,6,5, 4,7,6,  0,4,5, 0,5,1,
    3,2,6, 3,6,7,  0,3,7, 0,7,4,  1,5,6, 1,6,2,
  ];
  return { v, idx };
}

const meshes = [
  { name: 'Body', mat: 'Brand', geo: box(0, 1.55, 0, 10, 2.4, 2.6) },
  { name: 'StripeMesh', mat: 'Stripe', geo: box(0, 0.9, 0, 9.8, 0.5, 2.7) },
  { name: 'DoorCurb', mat: 'Glass', geo: box(3.2, 1.4, -1.36, 1.4, 2.0, 0.08) },
];

// --- pack into a GLB ------------------------------------------------------
let bin = [];
let byteOffset = 0;
const accessors = [];
const bufferViews = [];
function pushData(f32OrU16, componentType, count, type, min, max) {
  const bytes = Buffer.from(f32OrU16.buffer);
  bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length });
  bin.push(bytes);
  // GLB buffer views must align to 4
  const pad = (4 - (bytes.length % 4)) % 4;
  if (pad) bin.push(Buffer.alloc(pad));
  byteOffset += bytes.length + pad;
  accessors.push({
    bufferView: bufferViews.length - 1, componentType, count, type,
    ...(min ? { min, max } : {}),
  });
  return accessors.length - 1;
}

const gltfMeshes = [];
const nodes = [];
for (const m of meshes) {
  const pos = new Float32Array(m.geo.v.flat());
  const xs = m.geo.v.map((p) => p[0]), ys = m.geo.v.map((p) => p[1]), zs = m.geo.v.map((p) => p[2]);
  const posAcc = pushData(pos, 5126, m.geo.v.length, 'VEC3',
    [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
    [Math.max(...xs), Math.max(...ys), Math.max(...zs)]);
  const idxAcc = pushData(new Uint16Array(m.geo.idx), 5123, m.geo.idx.length, 'SCALAR');
  gltfMeshes.push({
    name: m.name,
    primitives: [{
      attributes: { POSITION: posAcc },
      indices: idxAcc,
      material: ['Brand', 'Stripe', 'Glass'].indexOf(m.mat),
    }],
  });
  nodes.push({ name: m.name, mesh: gltfMeshes.length - 1 });
}

const json = {
  asset: { version: '2.0', generator: 'intralines sample' },
  scene: 0,
  scenes: [{ nodes: nodes.map((_n, i) => i) }],
  nodes,
  meshes: gltfMeshes,
  materials: [
    { name: 'Brand', pbrMetallicRoughness: { baseColorFactor: [0.6, 0.6, 0.6, 1], roughness: 0.8 } },
    { name: 'Stripe', pbrMetallicRoughness: { baseColorFactor: [0.9, 0.3, 0.2, 1] } },
    { name: 'Glass', pbrMetallicRoughness: { baseColorFactor: [0.15, 0.18, 0.22, 1] } },
  ].map((m) => ({ ...m, pbrMetallicRoughness: { ...m.pbrMetallicRoughness, metallicFactor: 0 } })),
  buffers: [{ byteLength: byteOffset }],
  bufferViews,
  accessors,
};

const jsonBuf = Buffer.from(JSON.stringify(json));
const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
const binChunk = Buffer.concat(bin);
const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
const glb = Buffer.concat([
  Buffer.from([0x67, 0x6c, 0x54, 0x46]), // magic "glTF"
  u32(2), u32(total),
  u32(jsonChunk.length), Buffer.from('JSON'), jsonChunk,
  u32(binChunk.length), Buffer.from('BIN\0'), binChunk,
]);
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'sample.glb'), glb);

// manifest: merge, don't clobber the team's entries
const manifestPath = join(outDir, 'manifest.json');
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : { models: {} };
manifest.models[target] = { file: 'sample.glb' };
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${join(outDir, 'sample.glb')} (${glb.length} bytes) for "${target}"`);
