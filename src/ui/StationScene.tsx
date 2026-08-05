import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { makeBusMesh } from '../map/busLayer3d';
import { useGame } from '../game/store';

// The station diorama: a little 3D slice of curb with the stop's actual
// tier of furniture, a crowd that mirrors the live waiting count, and —
// when a bus serves this stop while you watch — a full pull-in: doors open,
// riders swap, doors close, bus pulls away.

const WALKER_COLORS = [0xc94f4f, 0x3d6fb3, 0x4a9455, 0xb3873d, 0x7a5cb3, 0x37858f];

interface BusVisit {
  mesh: THREE.Group;
  door: THREE.Mesh;
  start: number; // performance.now() ms
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
  return g;
}

/** stop furniture by tier: pole sign → glass shelter → canopied station */
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
    cam.position.set(-7.5, 5.4, 11.5);
    cam.lookAt(0, 1, -0.5);

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

    // waiting crowd — grows and shrinks with the live estimate
    const people: THREE.Group[] = [];
    const crowd = new THREE.Group();
    scene.add(crowd);
    const seatOf = (i: number): [number, number] => {
      // queue along the curb, then cluster back under the shelter
      if (i < 6) return [-2.4 + i * 1.05, -0.9];
      const r = i - 6;
      return [-2.8 + (r % 5) * 1.3 + (Math.floor(r / 5) % 2) * 0.5, -2.1 - Math.floor(r / 5) * 0.8];
    };
    const setCrowd = (n: number) => {
      const want = Math.max(0, Math.min(n, 22));
      while (people.length < want) {
        const p = makePerson(people.length);
        const [x, z] = seatOf(people.length);
        p.position.set(x, 0.12, z);
        p.rotation.y = Math.random() * 0.9 - 0.45;
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
    const VISIT_MS = 5200;
    const beginVisit = (lineId: string | null) => {
      if (visit) return;
      const st = useGame.getState();
      const line = st.lines.find((l) => l.id === lineId) ?? st.lines[0];
      const mesh = makeBusMesh(
        line?.color ?? '#e5484d',
        line?.modelId ?? 'citybus',
        st.companyColor,
      );
      mesh.position.set(-26, 0.1, 2.2);
      mesh.rotation.y = 0; // +x facing
      // curb-side door: a dark panel that slides open
      const door = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 1.7, 0.08),
        new THREE.MeshLambertMaterial({ color: 0x1c2126 }),
      );
      door.position.set(1.6, 1.15, -1.36);
      mesh.add(door);
      scene.add(mesh);
      visit = { mesh, door, start: performance.now() };
    };

    const stepVisit = (now: number) => {
      if (!visit) return;
      const t = (now - visit.start) / VISIT_MS;
      const { mesh, door } = visit;
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
      if (t < 0.26) {
        // pull in
        mesh.position.x = -26 + ease(t / 0.26) * 26;
      } else if (t < 0.36) {
        // doors open
        mesh.position.x = 0;
        door.position.z = -1.36 + ease((t - 0.26) / 0.1) * 0.9;
      } else if (t < 0.64) {
        // exchange: the queue shuffles aboard
        const k = (t - 0.36) / 0.28;
        people.forEach((p, i) => {
          if (i < 6) {
            const [sx] = [p.position.x];
            p.position.z = -0.9 + Math.min(1, Math.max(0, k * 2 - i * 0.15)) * 1.6;
            p.position.x = sx + (1.6 - sx) * Math.min(1, Math.max(0, k * 2 - i * 0.15)) * 0.4;
            p.visible = p.position.z < 0.55;
          }
        });
      } else if (t < 0.74) {
        // doors close
        door.position.z = -0.46 - ease((t - 0.64) / 0.1) * 0.9;
      } else {
        // pull away
        mesh.position.x = ease((t - 0.74) / 0.26) * 27;
      }
    };

    let raf = 0;
    let lastPoll = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
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
      stepVisit(now);
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
