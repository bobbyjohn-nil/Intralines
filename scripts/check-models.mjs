// Pre-flight for hand-made bus models: run before committing model files.
// Checks the manifest shape, that every listed file exists and is a real GLB,
// size budgets, and the naming conventions the game recolors by. Exits
// non-zero on any error so it can gate CI.
//
// Usage: node scripts/check-models.mjs

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models');
const KNOWN_IDS = ['minibus', 'citybus', 'artic', 'doubledeck', 'electric'];
const MAX_BYTES = 2_500_000; // keep the whole set streamable

let errors = 0;
let warnings = 0;
const err = (m) => { console.error('  ✗', m); errors++; };
const warn = (m) => { console.warn('  ⚠', m); warnings++; };

const manifestPath = join(dir, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.log('no public/models/manifest.json — the game uses its built-in meshes. OK.');
  process.exit(0);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (e) {
  console.error('✗ manifest.json is not valid JSON:', e.message);
  process.exit(1);
}
const models = manifest.models ?? {};
console.log(`manifest lists ${Object.keys(models).length} model(s)\n`);

for (const [id, entry] of Object.entries(models)) {
  console.log(`${id}:`);
  if (!KNOWN_IDS.includes(id)) {
    err(`"${id}" is not a bus model id (known: ${KNOWN_IDS.join(', ')})`);
    continue;
  }
  const file = entry.file ?? `${id}.glb`;
  const path = join(dir, file);
  if (!existsSync(path)) { err(`file missing: ${file}`); continue; }
  const size = statSync(path).size;
  if (size > MAX_BYTES) err(`${file} is ${(size / 1e6).toFixed(1)} MB — budget is ${MAX_BYTES / 1e6} MB`);
  else console.log(`  · ${file}: ${(size / 1024).toFixed(0)} KB`);

  const buf = readFileSync(path);
  if (buf.length < 20 || buf.toString('latin1', 0, 4) !== 'glTF') { err(`${file} is not a GLB (bad magic)`); continue; }
  if (buf.readUInt32LE(4) !== 2) err(`${file}: glTF version ${buf.readUInt32LE(4)} — export as glTF 2.0`);
  const jsonLen = buf.readUInt32LE(12);
  let doc;
  try {
    doc = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  } catch {
    err(`${file}: JSON chunk unreadable`); continue;
  }
  const matNames = (doc.materials ?? []).map((m) => m.name ?? '(unnamed)');
  const nodeNames = (doc.nodes ?? []).map((n) => n.name ?? '');
  if (!matNames.includes('Brand'))
    warn(`no material named "Brand" — the bus will not wear the company color`);
  if (!matNames.includes('Stripe'))
    warn(`no material named "Stripe" — the bus will not carry its line color`);
  if (!nodeNames.includes('DoorCurb'))
    warn(`no node named "DoorCurb" — the station viewer will draw its own door panel`);
  if ((doc.images ?? []).some((i) => i.uri && !i.uri.startsWith('data:')))
    err(`${file} references external textures — embed everything (export as binary glTF)`);
  console.log(`  · materials: ${matNames.join(', ') || '(none)'}`);
}

console.log(`\n${errors} error(s), ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
