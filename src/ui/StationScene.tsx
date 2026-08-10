import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { DOOR_Z, makeBusMesh } from '../map/busLayer3d';
import { lineRefModel, useGame } from '../game/store';

/** visit length in real ms per speed setting — faster game, snappier stop */
const VISIT_MS_BY_SPEED = [5200, 2600, 1300];

// The station diorama: a little 3D slice of curb with the stop's actual
// tier of furniture, a crowd that mirrors the live waiting count, and —
// when a bus serves this stop while you watch — a full pull-in: doors open,
// riders swap, doors close, bus pulls away.

const WALKER_COLORS = [0xc94f4f, 0x3d6fb3, 0x4a9455, 0xb3873d, 0x7a5cb3, 0x37858f];

interface BusVisit {
  mesh: THREE.Group;
  door: THREE.Mesh;
  /** 0..1 progress — advanced per-frame so pause freezes it mid-scene */
  t: number;
}

function makePerson(i: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: WALKER_COLORS[i % WALKER_COLORS.length] });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 1.05, 7), mat);
  body.position.y = 0.58;
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.21, 7, 7),
    new THREE.MeshLambertMaterial({ color: 0xe8c39e }),
  );
  head.position.y = 1.32;
  g.add(head);
  // nobody stands at attention at a bus stop: vary height a touch
  g.scale.setScalar(0.9 + Math.random() * 0.2);
  return g;
}

/** hub terminals get real signage: text painted onto a canvas texture */
function makeTextSign(text: string, w: number, h: number): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 80;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1d3f7a';
  ctx.fillRect(0, 0, 512, 80);
  ctx.strokeStyle = '#ffe9a8';
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, 500, 68);
  ctx.fillStyle = '#ffe9a8';
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 43);
  const tex = new THREE.CanvasTexture(c);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex }),
  );
}

/** where the buses stand at a hub: bay center x-offsets */
export function hubBays(tier: number): number[] {
  if (tier >= 5) return [0, -11, 11];
  if (tier >= 4) return [0, -10];
  return [0];
}

/** stop furniture by tier: pole → shelter → station → bus terminal */
function makeFurniture(tier: number): THREE.Group {
  const g = new THREE.Group();
  const steel = new THREE.MeshLambertMaterial({ color: 0x4a4d55 });
  const signMat = new THREE.MeshLambertMaterial({ color: 0xe8b23a });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 8), steel);
  pole.position.set(3.4, 1.5, -1.6);
  g.add(pole);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.6), signMat);
  sign.position.set(3.4, 2.7, -1.6);
  g.add(sign);
  if (tier >= 2) {
    const glass = new THREE.MeshLambertMaterial({
      color: 0xbcd6e0, transparent: true, opacity: 0.45,
    });
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(4.6, 0.16, 1.7),
      new THREE.MeshLambertMaterial({ color: 0x37403f }),
    );
    roof.position.set(0, 2.5, -2.2);
    g.add(roof);
    const back = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.1, 0.08), glass);
    back.position.set(0, 1.3, -2.9);
    g.add(back);
    for (const px of [-2.2, 2.2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.5, 8), steel);
      post.position.set(px, 1.25, -1.6);
      g.add(post);
    }
    const bench = new THREE.Mesh(
      new THREE.BoxGeometry(3.6, 0.12, 0.55),
      new THREE.MeshLambertMaterial({ color: 0x9a6b3f }),
    );
    bench.position.set(0, 0.55, -2.5);
    g.add(bench);
  }
  if (tier >= 3) {
    // proper station: longer canopy, second bay, reader board
    const canopy = new THREE.Mesh(
      new THREE.BoxGeometry(9.4, 0.2, 2.4),
      new THREE.MeshLambertMaterial({ color: 0x2c3a38 }),
    );
    canopy.position.set(0, 2.9, -2.1);
    g.add(canopy);
    for (const px of [-4.4, 4.4]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.9, 8), steel);
      post.position.set(px, 1.45, -1.5);
      g.add(post);
    }
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.8, 0.1),
      new THREE.MeshLambertMaterial({
        color: 0x101418, emissive: 0x2c5c33, emissiveIntensity: 0.8,
      }),
    );
    board.position.set(-3.2, 2.1, -2.6);
    g.add(board);
  }
  if (tier >= 4) {
    // interchange / transfer hub: a real terminal building with marked
    // pull-in bays the buses swing into
    const hub = tier >= 5;
    const bays = hubBays(tier);

    // apron: lighter concrete the bays are painted onto
    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(hub ? 36 : 25, 0.03, 3.6),
      new THREE.MeshLambertMaterial({ color: 0x7e838d }),
    );
    apron.position.set(0, 0.015, 1.9);
    g.add(apron);
    const paint = new THREE.MeshLambertMaterial({ color: 0xf2ecd8 });
    for (const bx of bays) {
      for (const ex of [-5.1, 5.1]) {
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 3.0), paint);
        edge.position.set(bx + ex, 0.035, 1.9);
        g.add(edge);
      }
      const outer = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.02, 0.16), paint);
      outer.position.set(bx, 0.035, 3.4);
      g.add(outer);
    }

    // terminal hall along the back of the platform
    const len = hub ? 21 : 14;
    const hall = new THREE.Mesh(
      new THREE.BoxGeometry(len, 3.2, 2.8),
      new THREE.MeshLambertMaterial({ color: 0xd8cfba }),
    );
    hall.position.set(0, 1.62, -4.6);
    g.add(hall);
    const front = new THREE.Mesh(
      new THREE.BoxGeometry(len - 1.2, 1.9, 0.08),
      new THREE.MeshLambertMaterial({
        color: 0x9fc2d4, transparent: true, opacity: 0.6,
      }),
    );
    front.position.set(0, 1.15, -3.14);
    g.add(front);
    const hallRoof = new THREE.Mesh(
      new THREE.BoxGeometry(len + 2, 0.22, 3.8),
      new THREE.MeshLambertMaterial({ color: 0x37403f }),
    );
    hallRoof.position.set(0, 3.32, -4.6);
    g.add(hallRoof);
    for (let cx = -len / 2 + 1.2; cx <= len / 2 - 1.1; cx += 3.4) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.2, 8), steel);
      col.position.set(cx, 1.6, -3.1);
      g.add(col);
    }
    const nameSign = makeTextSign(hub ? 'TRANSFER HUB' : 'INTERCHANGE', 6.6, 1.0);
    nameSign.position.set(0, 2.72, -3.05);
    g.add(nameSign);

    // the tall pylon moves out past the building's end
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.22, 5.2, 0.22), steel);
    pylon.position.set(len / 2 + 1.8, 2.6, -2.9);
    g.add(pylon);
    const topSign = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.9, 0.16),
      new THREE.MeshLambertMaterial({
        color: 0x2b4c8c, emissive: 0x1a3a6e, emissiveIntensity: 0.4,
      }),
    );
    topSign.position.set(len / 2 + 1.8, 5.0, -2.9);
    g.add(topSign);

    if (hub) {
      // transfer hub crown: a little clock tower over the entrance
      const tower = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 3.4, 1.4),
        new THREE.MeshLambertMaterial({ color: 0xcabfa8 }),
      );
      tower.position.set(0, 5.1, -4.6);
      g.add(tower);
      const face = new THREE.Mesh(
        new THREE.CircleGeometry(0.5, 20),
        new THREE.MeshLambertMaterial({
          color: 0xfffbe8, emissive: 0x777158, emissiveIntensity: 0.35,
        }),
      );
      face.position.set(0, 5.6, -3.88);
      g.add(face);
      const towerRoof = new THREE.Mesh(
        new THREE.ConeGeometry(1.15, 0.9, 4),
        new THREE.MeshLambertMaterial({ color: 0x37403f }),
      );
      towerRoof.rotation.y = Math.PI / 4;
      towerRoof.position.set(0, 7.25, -4.6);
      g.add(towerRoof);
    }
  }
  return g;
}

export function StationScene({ stopId, tier }: { stopId: string; tier: number }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const W = host.clientWidth || 340;
    const H = 215;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdfe9ee);
    scene.fog = new THREE.Fog(0xdfe9ee, 30, 60);
    const cam = new THREE.PerspectiveCamera(42, W / H, 0.1, 120);
    if (tier >= 4) {
      // hubs are whole buildings: pull back to frame the terminal + bays
      cam.position.set(-10, 6.8, 15.5);
      cam.lookAt(0, 1.2, -1);
    } else {
      cam.position.set(-7.5, 5.4, 11.5);
      cam.lookAt(0, 1, -0.5);
    }

    scene.add(new THREE.AmbientLight(0xffffff, 1.9));
    const sun = new THREE.DirectionalLight(0xfff2d9, 1.6);
    sun.position.set(-6, 12, 8);
    scene.add(sun);

    // street + sidewalk + curb
    const road = new THREE.Mesh(
      new THREE.BoxGeometry(46, 0.1, 7),
      new THREE.MeshLambertMaterial({ color: 0x6a6f78 }),
    );
    road.position.set(0, -0.05, 3.4);
    scene.add(road);
    const walk = new THREE.Mesh(
      new THREE.BoxGeometry(46, 0.24, 6),
      new THREE.MeshLambertMaterial({ color: 0xcfc6b2 }),
    );
    walk.position.set(0, 0.02, -2.9);
    scene.add(walk);
    const dash = new THREE.MeshLambertMaterial({ color: 0xf5efdc });
    for (let x = -22; x < 23; x += 3) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.02, 0.16), dash);
      d.position.set(x, 0.02, 6.4);
      scene.add(d);
    }

    scene.add(makeFurniture(tier));
    // test/debug hook, same spirit as window.__busLayer
    (window as unknown as { __stationScene?: THREE.Scene }).__stationScene = scene;

    // at a hub, other lines calling here idle in the side bays
    if (tier >= 4) {
      const st = useGame.getState();
      const calling = st.lines.filter((l) => l.stopIds.includes(stopId));
      const sideBays = hubBays(tier).slice(1);
      calling.slice(1, 1 + sideBays.length).forEach((l, i) => {
        const parked = makeBusMesh(l.color, lineRefModel(l), st.companyColor);
        parked.traverse((o) => {
          const mat = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
          if (mat && 'emissiveIntensity' in mat) mat.emissiveIntensity = 0.12;
        });
        parked.position.set(sideBays[i], 0.1, 0.9);
        scene.add(parked);
      });
    }

    // waiting crowd — grows and shrinks with the live estimate
    const people: THREE.Group[] = [];
    const crowd = new THREE.Group();
    scene.add(crowd);
    // pre-rolled jitter so each spot scatters naturally but stays put
    const jitter = Array.from({ length: 24 }, () => ({
      x: (Math.random() - 0.5) * 0.7,
      z: (Math.random() - 0.5) * 0.5,
    }));
    const seatOf = (i: number): [number, number] => {
      const j = jitter[i % jitter.length];
      // loose knot near the curb, then milling around under the shelter
      if (i < 6) return [-2.4 + i * 1.05 + j.x, -0.9 + j.z];
      const r = i - 6;
      return [
        -2.8 + (r % 5) * 1.3 + (Math.floor(r / 5) % 2) * 0.5 + j.x,
        -2.1 - Math.floor(r / 5) * 0.8 + j.z,
      ];
    };
    const setCrowd = (n: number) => {
      const want = Math.max(0, Math.min(n, 22));
      while (people.length < want) {
        const p = makePerson(people.length);
        const [x, z] = seatOf(people.length);
        p.position.set(x, 0.12, z);
        p.rotation.y = Math.random() * Math.PI * 2; // facing every which way
        crowd.add(p);
        people.push(p);
      }
      while (people.length > want) {
        const p = people.pop()!;
        crowd.remove(p);
      }
    };

    // bus visit animation state
    let visit: BusVisit | null = null;
    let lastServedSeen: number | null = null;
    const beginVisit = (lineId: string | null) => {
      if (visit) return;
      const st = useGame.getState();
      const line = st.lines.find((l) => l.id === lineId) ?? st.lines[0];
      const mesh = makeBusMesh(
        line?.color ?? '#e5484d',
        line ? lineRefModel(line) : 'citybus',
        st.companyColor,
      );
      // up close the map bus reads washed-out: kill the emissive glow and
      // let the scene's sun do the shading
      mesh.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
        if (mat && 'emissiveIntensity' in mat) mat.emissiveIntensity = 0.12;
      });
      mesh.position.set(-26, 0.1, tier >= 4 ? 2.6 : 2.2);
      mesh.rotation.y = 0; // +x facing
      // the bus already wears painted doors; slide the platform-side one open
      // rather than stacking a second panel on top of it
      let door = (mesh.userData as { curbDoor?: THREE.Mesh }).curbDoor;
      if (!door) {
        door = new THREE.Mesh(
          new THREE.BoxGeometry(1.5, 1.7, 0.08),
          new THREE.MeshLambertMaterial({ color: 0x1c2126 }),
        );
        door.position.set(1.6, 1.15, -DOOR_Z);
        mesh.add(door);
      }
      scene.add(mesh);
      visit = { mesh, door, t: 0 };
    };

    const stepVisit = (dtMs: number) => {
      if (!visit) return;
      const st = useGame.getState();
      if (!st.paused) {
        visit.t += dtMs / (VISIT_MS_BY_SPEED[st.speedIdx] ?? 5200);
      }
      const { mesh, door, t } = visit;
      if (t >= 1) {
        scene.remove(mesh);
        visit = null;
        // re-seat whoever is left after the exchange
        people.forEach((p, i) => {
          const [x, z] = seatOf(i);
          p.position.set(x, 0.12, z);
          p.visible = true;
        });
        return;
      }
      const ease = (v: number) => 1 - Math.pow(1 - v, 3);
      const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
      // hubs: swing off the through lane into the marked bay by the curb
      const isHub = tier >= 4;
      const roadZ = isHub ? 2.6 : 2.2;
      const bayZ = isHub ? 0.9 : 2.2;
      const walkSpan = isHub ? 0.85 : 1.6;
      const hideAt = isHub ? -0.25 : 0.55;
      if (t < 0.26) {
        // pull in — the last stretch curves into the bay, nose toward curb
        mesh.position.x = -26 + ease(t / 0.26) * 26;
        const swing = ease(clamp01((t - 0.13) / 0.13));
        mesh.position.z = roadZ - swing * (roadZ - bayZ);
        mesh.rotation.y = isHub ? 0.14 * Math.sin(Math.PI * swing) : 0;
      } else if (t < 0.36) {
        // doors open
        mesh.position.x = 0;
        mesh.position.z = bayZ;
        mesh.rotation.y = 0;
        door.position.z = -DOOR_Z + ease((t - 0.26) / 0.1) * 0.9;
      } else if (t < 0.64) {
        // exchange: the queue shuffles aboard
        const k = (t - 0.36) / 0.28;
        people.forEach((p, i) => {
          if (i < 6) {
            const [sx] = [p.position.x];
            p.position.z = -0.9 + clamp01(k * 2 - i * 0.15) * walkSpan;
            p.position.x = sx + (1.6 - sx) * clamp01(k * 2 - i * 0.15) * 0.4;
            p.visible = p.position.z < hideAt;
          }
        });
      } else if (t < 0.74) {
        // doors close
        door.position.z = -DOOR_Z + 0.9 - ease((t - 0.64) / 0.1) * 0.9;
      } else {
        // pull away — swing back out to the through lane
        const k = (t - 0.74) / 0.26;
        mesh.position.x = ease(k) * 27;
        const swing = ease(clamp01(k / 0.5));
        mesh.position.z = bayZ + swing * (roadZ - bayZ);
        mesh.rotation.y = isHub ? -0.14 * Math.sin(Math.PI * swing) : 0;
      }
    };

    let raf = 0;
    let lastPoll = 0;
    let prevFrame = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      // per-frame delta for the visit clock (clamped across tab-sleeps)
      const dtMs = prevFrame ? Math.min(now - prevFrame, 100) : 16;
      prevFrame = now;
      if (now - lastPoll > 400) {
        lastPoll = now;
        const layer = (window as unknown as { __busLayer?: { stationInfo?: (id: string) => { waiting: number; lastServedMin: number | null; lineId: string | null } } }).__busLayer;
        const info = layer?.stationInfo?.(stopId);
        if (info) {
          if (!visit) setCrowd(info.waiting);
          if (
            info.lastServedMin !== null &&
            lastServedSeen !== null &&
            info.lastServedMin > lastServedSeen
          ) {
            beginVisit(info.lineId);
          }
          if (lastServedSeen === null || info.lastServedMin !== null) {
            lastServedSeen = info.lastServedMin ?? lastServedSeen;
          }
          if (lastServedSeen === null) lastServedSeen = -1;
        }
      }
      // idle sway so the crowd feels alive
      const sway = Math.sin(now / 900) * 0.03;
      people.forEach((p, i) => {
        p.rotation.z = sway * (i % 2 === 0 ? 1 : -1);
      });
      stepVisit(dtMs);
      renderer.render(scene, cam);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, [stopId, tier]);

  return <div className="station-scene" ref={hostRef} />;
}
