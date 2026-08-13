// Hand-made 3D models, dropped in by the art team.
//
// The buses on the map are built in code (makeBusMesh) — recognisable, but
// programmer art. This module lets real models replace them without touching
// code: put a glTF binary at public/models/<busModelId>.glb, list it in
// public/models/manifest.json, and every bus of that model on the map and in
// the station viewer uses it. Anything not listed (or that fails to load)
// falls back to the built-in mesh, so a missing or broken file can never
// break the game. Authoring conventions live in docs/MODELS.md.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface ManifestEntry {
  /** file under public/models/; defaults to "<id>.glb" */
  file?: string;
  /**
   * Fit the model to the game's expected length for this bus id (default
   * true). Teams exporting at exact world scale can turn it off.
   */
  autofit?: boolean;
  /** extra yaw in degrees if the model was not exported facing +X */
  rotateDeg?: number;
}

/** in-game length (m) each bus id is drawn at — what autofit targets */
const TARGET_LEN: Record<string, number> = {
  minibus: 7, citybus: 11, artic: 16, doubledeck: 11, electric: 11,
};

const prototypes = new Map<string, THREE.Group>();
let loadPromise: Promise<number> | null = null;
const onLoaded: (() => void)[] = [];

/** run after the models arrive — the map uses it to reskin live buses */
export function onCustomModelsLoaded(cb: () => void): void {
  if (prototypes.size) cb();
  else onLoaded.push(cb);
}

/**
 * Kick off loading. Called once at map start; safe to call again. Resolves
 * with the number of models loaded (0 when there is no manifest at all —
 * the silent, normal case for a build with no team models yet).
 */
export function loadCustomModels(): Promise<number> {
  loadPromise ??= (async () => {
    let manifest: Record<string, ManifestEntry>;
    try {
      const res = await fetch(new URL('models/manifest.json', document.baseURI).href, {
        cache: 'no-cache',
      });
      if (!res.ok) return 0;
      manifest = (await res.json()).models ?? {};
    } catch {
      return 0; // offline or absent — the built-in meshes carry on
    }
    const loader = new GLTFLoader();
    const jobs = Object.entries(manifest).map(async ([id, entry]) => {
      try {
        const url = new URL(`models/${entry.file ?? `${id}.glb`}`, document.baseURI).href;
        const gltf = await loader.loadAsync(url);
        prototypes.set(id, normalize(gltf.scene, id, entry));
      } catch (e) {
        // a broken file is the artist's bug, not the player's problem
        console.warn(`custom model "${id}" failed to load:`, e);
      }
    });
    await Promise.all(jobs);
    if (prototypes.size) {
      console.info(`custom bus models loaded: ${[...prototypes.keys()].join(', ')}`);
      for (const cb of onLoaded.splice(0)) cb();
    }
    return prototypes.size;
  })();
  return loadPromise;
}

/**
 * Put an arbitrary export into the game's frame: +X forward, resting on
 * y = 0, centred on the origin, at the length the game draws this bus.
 */
function normalize(scene: THREE.Group, id: string, entry: ManifestEntry): THREE.Group {
  const g = new THREE.Group();
  g.add(scene);
  if (entry.rotateDeg) scene.rotation.y = (entry.rotateDeg * Math.PI) / 180;
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  if (entry.autofit !== false && size.x > 0) {
    const s = (TARGET_LEN[id] ?? 11) / size.x;
    scene.scale.setScalar(s);
    scene.updateMatrixWorld(true);
    box.setFromObject(scene);
  }
  const c = box.getCenter(new THREE.Vector3());
  scene.position.x -= c.x;
  scene.position.z -= c.z;
  scene.position.y -= box.min.y; // wheels on the ground
  return g;
}

/**
 * A ready-to-use instance wearing the company's livery, or null when the
 * team has not supplied this model. Cloned per bus; materials named by the
 * conventions in docs/MODELS.md are recolored:
 *   "Brand"  -> the company color     "Stripe" -> the line color
 * A node named "DoorCurb" becomes the door the station viewer slides open.
 */
export function customBusMesh(
  modelId: string,
  lineColor: string,
  brandColor?: string,
): THREE.Group | null {
  const proto = prototypes.get(modelId);
  if (!proto) return null;
  const g = proto.clone(true);
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mesh.material = mats.map((m) => {
      const name = (m as THREE.Material).name;
      if (name !== 'Brand' && name !== 'Stripe') return m;
      const clone = (m as THREE.MeshStandardMaterial).clone();
      clone.color = new THREE.Color(name === 'Brand' ? (brandColor ?? lineColor) : lineColor);
      return clone;
    }) as unknown as THREE.Material;
    if (mats.length === 1) mesh.material = (mesh.material as unknown as THREE.Material[])[0];
  });
  const door = g.getObjectByName('DoorCurb');
  if (door) (g.userData as { curbDoor?: THREE.Object3D }).curbDoor = door;
  return g;
}
