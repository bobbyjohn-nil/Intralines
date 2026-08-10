import { useEffect, useRef } from 'react';
import maplibregl, { Map as MLMap, MapMouseEvent, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { CityPack, LngLat } from '../game/types';
import { industrialZones, useGame } from '../game/store';
import { reportError } from '../game/errors';
import { buildPackStyle, buildRealStyle, PALETTE } from './basemapStyle';
import {
  addBoundaryMask, ensureOverlays, MODE_COLORS, updateDepots, updateDraft, updateDraftCursor,
  updateHeatmap, updateNetwork, updateStopHover, updateTraffic, updateZoning,
} from './overlays';
import { BusLayer3D } from './busLayer3d';
import type { LineExtras } from './busLayer3d';
import { cumulativeDist } from '../game/routing';
import { fastDistM } from '../game/geo';
import { congestionGain, DEPOT_CAPACITY, measuredBusyness } from '../game/constants';

/** quick probe: can we actually reach the tile server? */
async function tilesReachable(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch('https://tiles.openfreemap.org/planet', {
      signal: ctrl.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export function MapView({ pack }: { pack: CityPack }) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const busLayerRef = useRef<BusLayer3D | null>(null);
  const readyRef = useRef(false);
  const depotMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const poiMarkersRef = useRef<maplibregl.Marker[]>([]);
  const chipsRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const labelsRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const popupRef = useRef<maplibregl.Popup | null>(null);

  const stops = useGame((s) => s.stops);
  const lines = useGame((s) => s.lines);
  const selectedLineId = useGame((s) => s.selectedLineId);
  const draft = useGame((s) => s.draft);
  const heatmap = useGame((s) => s.heatmap);
  const trafficView = useGame((s) => s.trafficView);
  const trafficHour = useGame((s) => s.trafficHour);
  const depots = useGame((s) => s.depots);
  const stats = useGame((s) => s.stats);
  const tool = useGame((s) => s.tool);
  const panel = useGame((s) => s.panel);
  const basemapPref = useGame((s) => s.basemapPref);

  // create the map once per city (and re-create when basemap mode changes)
  useEffect(() => {
    if (!divRef.current) return;
    let cancelled = false;
    let map: MLMap | null = null;
    let dayNight: ReturnType<typeof setInterval> | null = null;
    let stopChips: ReturnType<typeof setInterval> | null = null;

    const boot = async (): Promise<void> => {
      const online =
        pack.meta.kind === 'real' && basemapPref === 'auto' && (await tilesReachable());
      if (cancelled || !divRef.current) return;
      useGame.getState().setBasemapActive(online ? 'online' : 'offline');
      if (pack.meta.kind === 'real' && basemapPref === 'auto' && !online) {
        useGame
          .getState()
          .notify('No internet for map tiles — using the built-in offline map.', 'info');
      }
      const style: StyleSpecification = online ? buildRealStyle() : buildPackStyle(pack);

      const [w, s, e, n] = pack.meta.bbox;
      // small leash: enough to see the boundary and tilted horizon, not
      // enough to wander off into the unplayable world
      const pad = 0.08;
      map = new maplibregl.Map({
        container: divRef.current,
        style,
        center: pack.meta.center,
        zoom: pack.meta.zoom,
        pitch: 48,
        bearing: -14,
        maxBounds: [
          [w - pad, s - pad],
          [e + pad, n + pad],
        ],
        minZoom: 10,
        maxZoom: 18,
        attributionControl: false,
        antialias: true,
      });
      map.addControl(
        new maplibregl.AttributionControl({
          compact: true,
          customAttribution:
            pack.meta.kind === 'demo'
              ? 'Demo data'
              : online
                ? '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors · US Census Bureau'
                : '© OpenStreetMap contributors · US Census Bureau (offline mode)',
        }),
        'bottom-right',
      );
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
      map.touchZoomRotate.enableRotation();
      mapRef.current = map;

      // surface real map failures without letting per-tile noise flood the
      // log: report each distinct message once, cap at a handful per mount
      const mapErrSeen = new Set<string>();
      map.on('error', (ev) => {
        const msg = String(ev?.error?.message ?? ev?.error ?? 'map error')
          .replace(/https?:\/\/\S+/g, '<url>');
        if (mapErrSeen.has(msg) || mapErrSeen.size >= 5) return;
        mapErrSeen.add(msg);
        reportError('map', ev?.error ?? msg);
      });
      map.on('webglcontextlost', () => {
        reportError(
          'map',
          'WebGL context lost',
          'Graphics hiccup — the browser dropped the 3D map. Reload to bring it back.',
        );
      });

      const busLayer = new BusLayer3D(() => {
        const { clockRef } = useGame.getState();
        return clockRef.min + ((performance.now() - clockRef.realMs) / 1000) * clockRef.rate;
      });
      busLayerRef.current = busLayer;
      // debug/testing hooks
      const dbg = window as unknown as {
        __busLayer?: BusLayer3D; __map?: MLMap; __game?: typeof useGame;
      };
      dbg.__busLayer = busLayer;
      dbg.__map = map;
      dbg.__game = useGame;

      map.on('load', () => {
        if (!map) return;
        addBoundaryMask(map, pack.meta.bbox);
        ensureOverlays(map);
        map.addLayer(busLayer);
        // airports + rail stations: fixed landmarks with their own demand
        for (const poi of pack.pois ?? []) {
          const el = document.createElement('div');
          el.className = `poi-marker poi-${poi.kind}`;
          el.innerHTML =
            poi.kind === 'airport'
              ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">' +
                '<path d="M21 15.5v-2l-8-4.5V4a1.5 1.5 0 0 0-3 0v5L2 13.5v2l8-2.2v4.9l-2.2 1.6v1.7l3.7-1 3.7 1v-1.7L13 18.2v-4.9z"/></svg>'
              : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                '<rect x="5" y="3" width="14" height="13" rx="3"/>' +
                '<path d="M5 10h14M9 19l-2 2.5M15 19l2 2.5"/>' +
                '<circle cx="9" cy="13" r="0.6"/><circle cx="15" cy="13" r="0.6"/></svg>';
          el.title = poi.name;
          poiMarkersRef.current.push(
            new maplibregl.Marker({ element: el, anchor: 'center' })
              .setLngLat(poi.pt)
              .addTo(map),
          );
        }
        readyRef.current = true;
        syncAll();
      });

      map.on('error', (e) => {
        // eslint-disable-next-line no-console
        console.warn('map error', e?.error?.message ?? e);
      });

      map.on('click', (e: MapMouseEvent) => {
        if (!map) return;
        const st = useGame.getState();
        const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        if (st.tool === 'select') {
          // stops first: they sit on top of the line ribbons
          const stopHits = map.getLayer('stops-pt')
            ? map.queryRenderedFeatures(e.point, { layers: ['stops-pt'] })
            : [];
          if (stopHits.length && stopHits[0].properties?.id) {
            st.selectStop(String(stopHits[0].properties.id));
            return;
          }
          const feats = map.getLayer('lines-hit')
            ? map.queryRenderedFeatures(e.point, { layers: ['lines-hit'] })
            : [];
          if (feats.length) {
            st.selectLine(feats[0].properties?.id ?? null);
            return;
          }
          const dots =
            st.heatmap !== 'off' && map.getLayer('heatmap-blob')
              ? map.queryRenderedFeatures(e.point, { layers: ['heatmap-blob'] })
              : [];
          if (dots.length && dots[0].properties?.bg !== undefined) {
            openDemandPopup(map, Number(dots[0].properties.bg));
            return;
          }
          if (st.selectedLineId) st.selectLine(null);
          return;
        }
        st.mapClick(pt);
      });

      map.on('mousemove', (e: MapMouseEvent) => {
        if (!map) return;
        const st = useGame.getState();
        if (st.tool !== 'select' || st.heatmap === 'off' || !map.getLayer('heatmap-blob')) {
          return;
        }
        const dots = map.queryRenderedFeatures(e.point, { layers: ['heatmap-blob'] });
        map.getCanvas().style.cursor = dots.length ? 'pointer' : '';
      });

      let moveScheduled = false;
      map.on('mousemove', (e: MapMouseEvent) => {
        if (moveScheduled) return;
        moveScheduled = true;
        requestAnimationFrame(() => {
          moveScheduled = false;
          if (!readyRef.current || !map) return;
          const st = useGame.getState();
          if (st.tool === 'line-new' && st.draft && st.draft.stops.length) {
            const last = st.draft.stops[st.draft.stops.length - 1];
            updateDraftCursor(map, last.pt, [e.lngLat.lng, e.lngLat.lat]);
          } else {
            updateDraftCursor(map, null, null);
          }
        });
      });

      // live waiting-passenger chips above stops
      stopChips = setInterval(() => {
        if (!readyRef.current || !map || !busLayerRef.current) return;
        const chips = chipsRef.current;
        const zoomNow = map.getZoom();
        const counts =
          zoomNow >= 12.3 ? busLayerRef.current.getStopCounts() : [];
        const seen = new Set<string>();
        for (const c of counts) {
          seen.add(c.id);
          let m = chips.get(c.id);
          if (!m) {
            const el = document.createElement('div');
            el.className = 'stop-count';
            // the gauge is a donut wrapped around the stop's white dot
            m = new maplibregl.Marker({ element: el, anchor: 'center' })
              .setLngLat(c.pt)
              .addTo(map!);
            chips.set(c.id, m);
          }
          const el = m.getElement();
          if (el.dataset.count !== String(c.count)) {
            el.dataset.count = String(c.count);
            // ring gauge around the stop dot: fills as the crowd builds
            // (full at ~14 waiting); open center lets the dot show through
            const frac = Math.min(c.count / 14, 1);
            const R = 8.5;
            const circ = 2 * Math.PI * R;
            const color = frac < 0.55 ? '#74b06f' : frac < 0.85 ? '#e0a13c' : '#d16060';
            el.innerHTML =
              `<svg viewBox="0 0 24 24" width="22" height="22">` +
              `<circle cx="12" cy="12" r="${R}" fill="none" ` +
              `stroke="rgba(30,28,22,0.4)" stroke-width="3"/>` +
              `<circle cx="12" cy="12" r="${R}" fill="none" stroke="${color}" ` +
              `stroke-width="3" stroke-linecap="round" ` +
              `stroke-dasharray="${(frac * circ).toFixed(1)} ${circ.toFixed(1)}" ` +
              `transform="rotate(-90 12 12)"/></svg>`;
          }
          el.title = `${c.count} waiting`;
        }
        for (const [id, m] of chips) {
          if (!seen.has(id)) {
            m.remove();
            chips.delete(id);
          }
        }

        // station name labels: zoomed right in, forced on via Map options,
        // or — while a line's editor is open — that line's own stops
        const st = useGame.getState();
        const labelsOn =
          st.stopLabels === 'always' ? zoomNow >= 11.5 : zoomNow >= 15.5;
        const editedLine =
          st.panel === 'line-edit' || st.tool === 'route-edit'
            ? st.lines.find((l) => l.id === st.selectedLineId)
            : undefined;
        const lineStopIds = new Set(editedLine?.stopIds ?? []);
        const labels = labelsRef.current;
        const wanted = new Set<string>();
        for (const stop of st.stops) {
          if (!labelsOn && !lineStopIds.has(stop.id)) continue;
          wanted.add(stop.id);
          let m = labels.get(stop.id);
          if (!m) {
            const el = document.createElement('div');
            el.className = 'stop-label';
            m = new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, 8] })
              .setLngLat(stop.pt)
              .addTo(map!);
            labels.set(stop.id, m);
          }
          const el = m.getElement();
          if (el.textContent !== stop.name) el.textContent = stop.name;
        }
        for (const [id, m] of labels) {
          if (!wanted.has(id)) {
            m.remove();
            labels.delete(id);
          }
        }
      }, 600);

      // day/night tinting for the basemap
      dayNight = setInterval(() => {
        if (!readyRef.current || !map) return;
        const { clockMin } = useGame.getState();
        const hour = (clockMin / 60) % 24;
        const day =
          hour < 5 || hour >= 21
            ? 0
            : hour < 7
              ? (hour - 5) / 2
              : hour < 19
                ? 1
                : 1 - (hour - 19) / 2;
        const blend = (a: string, b: string) => mixColor(a, b, 1 - day);
        if (map.getLayer('bg')) {
          map.setPaintProperty('bg', 'background-color', blend(PALETTE.land, '#232733'));
        }
        if (map.getLayer('water')) {
          map.setPaintProperty('water', 'fill-color', blend(PALETTE.water, '#1d3050'));
        }
        if (map.getLayer('building-3d')) {
          // height-tinted so towers read differently from row houses; the
          // coalesce covers both the pack schema (h) and OpenMapTiles.
          map.setPaintProperty('building-3d', 'fill-extrusion-color', [
            'interpolate', ['linear'],
            ['coalesce', ['get', 'h'], ['get', 'render_height'], 8],
            6, blend('#eadfc8', '#383d4a'),
            24, blend(PALETTE.building3d, '#3a3f4e'),
            70, blend('#d3cbc0', '#414654'),
          ]);
        }
        if (map.getLayer('parks')) {
          map.setPaintProperty('parks', 'fill-color', blend(PALETTE.park, '#2f3b2c'));
        }
        // roads dim after dark — but only halfway to asphalt, so the street
        // grid stays readable at night (split the difference between the
        // original bright look and the fully-dark one)
        const roadBlend = (a: string, b: string) => mixColor(a, b, (1 - day) * 0.5);
        if (map.getLayer('road')) {
          // offline pack style: tiered by speed inside one layer
          map.setPaintProperty('road', 'line-color', [
            'case',
            ['>=', ['get', 'kmh'], 70], roadBlend(PALETTE.motorway, '#57503c'),
            ['>=', ['get', 'kmh'], 42], roadBlend(PALETTE.primary, '#514b3a'),
            ['>=', ['get', 'kmh'], 38], roadBlend(PALETTE.tertiary, '#484659'),
            roadBlend(PALETTE.street, '#434a5a'),
          ]);
          map.setPaintProperty('road-casing', 'line-color', [
            'case',
            ['>=', ['get', 'kmh'], 70], roadBlend(PALETTE.motorwayCasing, '#3a3527'),
            ['>=', ['get', 'kmh'], 42], roadBlend(PALETTE.primaryCasing, '#37332a'),
            ['>=', ['get', 'kmh'], 38], roadBlend(PALETTE.tertiaryCasing, '#2c3038'),
            roadBlend(PALETTE.streetCasing, '#272c37'),
          ]);
        }
        const ONLINE_NIGHT: [string, string, string][] = [
          ['road-minor', PALETTE.street, '#434a5a'],
          ['road-minor-casing', PALETTE.streetCasing, '#272c37'],
          ['road-tertiary', PALETTE.tertiary, '#484659'],
          ['road-tertiary-casing', PALETTE.tertiaryCasing, '#2c3038'],
          ['road-secondary', '#fff8ea', '#484659'],
          ['road-secondary-casing', PALETTE.streetCasing, '#272c37'],
          ['road-primary', PALETTE.primary, '#514b3a'],
          ['road-primary-casing', PALETTE.primaryCasing, '#37332a'],
          ['road-motorway', PALETTE.motorway, '#57503c'],
          ['road-motorway-casing', PALETTE.motorwayCasing, '#3a3527'],
        ];
        for (const [id, dayC, nightC] of ONLINE_NIGHT) {
          if (map.getLayer(id)) {
            map.setPaintProperty(id, 'line-color', roadBlend(dayC, nightC));
          }
        }
      }, 1500);
    };

    void boot();

    return () => {
      cancelled = true;
      if (dayNight) clearInterval(dayNight);
      if (stopChips) clearInterval(stopChips);
      chipsRef.current.forEach((m) => m.remove());
      chipsRef.current.clear();
      labelsRef.current.forEach((m) => m.remove());
      labelsRef.current.clear();
      popupRef.current?.remove();
      popupRef.current = null;
      readyRef.current = false;
      depotMarkersRef.current.forEach((m) => m.remove());
      depotMarkersRef.current.clear();
      poiMarkersRef.current.forEach((m) => m.remove());
      poiMarkersRef.current = [];
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack.meta.id, basemapPref]);

  function lineExtras(): Map<string, LineExtras> {
    const st = useGame.getState();
    const out = new Map<string, LineExtras>();
    const g = st.graph;
    const pk = st.pack;
    if (!g || !pk) return out;
    const keys = g.intersectionKeys();
    const cosLat = Math.cos((pk.meta.center[1] * Math.PI) / 180);

    // census density field: bucket block-group densities so corridor samples
    // can look up how urban their surroundings are
    const CELLD = 0.008;
    const dgrid = new Map<string, { d: number; i: number }[]>();
    const dens: number[] = [];
    pk.blockGroups.forEach((bg, i) => {
      const d = (bg.pop + bg.jobs) / Math.max(bg.areaKm2, 0.05);
      dens.push(d);
      const k = `${Math.floor(bg.centroid[0] / CELLD)}:${Math.floor(bg.centroid[1] / CELLD)}`;
      (dgrid.get(k) ?? dgrid.set(k, []).get(k)!).push({ d, i });
    });
    const sorted = [...dens].sort((a, b) => a - b);
    const densNorm = sorted[Math.floor(sorted.length * 0.85)] || 1;
    const bgModes = st.stats?.bgModes;
    // parking left per depot — buses claim spaces line by line below, so a
    // full depot pushes its overflow to the next-nearest garage
    const depotSpace = new Map(
      st.depots.map((d) => [d.id, DEPOT_CAPACITY[d.level] ?? 0]),
    );
    const cellScan = (pt: [number, number], into: Set<number>): number => {
      const gx = Math.floor(pt[0] / CELLD);
      const gy = Math.floor(pt[1] / CELLD);
      let best = 0;
      for (let x = gx - 1; x <= gx + 1; x++) {
        for (let y = gy - 1; y <= gy + 1; y++) {
          for (const e of dgrid.get(`${x}:${y}`) ?? []) {
            if (e.d > best) best = e.d;
            into.add(e.i);
          }
        }
      }
      return best;
    };

    for (const l of st.lines) {
      const ds: number[] = [];
      let urbanSum = 0;
      let mainCnt = 0;
      let gainSum = 0;
      let samples = 0;
      let lastSample = -1e9;
      const nearBg = new Set<number>();
      for (let i = 0; i < l.path.length; i++) {
        const pnt = l.path[i];
        if (keys.has(`${Math.round(pnt[0] * 1e5)}:${Math.round(pnt[1] * 1e5)}`)) {
          const d = l.cum[i];
          if (!ds.length || d - ds[ds.length - 1] > 30) ds.push(d);
        }
        // corridor character samples every ~250 m
        if (l.cum[i] - lastSample >= 250 || i === 0) {
          lastSample = l.cum[i];
          samples++;
          const urbanHere = Math.min(cellScan(pnt, nearBg) / densNorm, 1);
          urbanSum += urbanHere;
          const kmh = g.speedNear(pnt, 60);
          if (kmh !== null && kmh >= 42) mainCnt++;
          // rush hour lives on the arterials: class-dominant congestion
          gainSum += congestionGain(kmh ?? 30, urbanHere, measuredBusyness(pack.traffic, pnt));
        }
      }
      // riders along this corridor who would otherwise drive are off the
      // road: 87% of bus trips displace a car (the rest are captive riders)
      let relief = 1;
      if (bgModes) {
        let car = 0;
        let bus = 0;
        for (const bi of nearBg) {
          const m = bgModes[bi];
          if (m) {
            car += m.car;
            bus += m.bus;
          }
        }
        const baseline = car + bus * 0.87;
        if (baseline > 0) relief = Math.max(0.6, Math.min(1, car / baseline));
      }
      const extras: LineExtras = {
        intersections: ds,
        urban: samples ? urbanSum / samples : 0.5,
        mainShare: samples ? mainCnt / samples : 0.5,
        gain: samples ? gainSum / samples : 0.5,
        relief,
      };
      // deadheads: every vehicle is garaged at the closest depot to the
      // line's first stop that still has parking, spilling to the
      // next-nearest once a depot fills up
      const first = st.stops.find((x) => x.id === l.stopIds[0]);
      if (st.depots.length && first) {
        const byDist = [...st.depots].sort(
          (a, b) =>
            fastDistM(a.pt, first.pt, cosLat) - fastDistM(b.pt, first.pt, cosLat),
        );
        const routes = new Map<string, { path: LngLat[]; cum: number[]; lenM: number } | null>();
        const routeFrom = (depId: string, node: number) => {
          if (!routes.has(depId)) {
            const r = g.route(node, first.node);
            if (r && r.path.length >= 2) {
              const cum = cumulativeDist(r.path, cosLat);
              routes.set(depId, { path: r.path, cum, lenM: cum[cum.length - 1] });
            } else {
              routes.set(depId, null);
            }
          }
          return routes.get(depId) ?? null;
        };
        if (l.vehicles > 0) {
          const perVehicle: ({ path: LngLat[]; cum: number[]; lenM: number } | null)[] = [];
          for (let k = 0; k < l.vehicles; k++) {
            const home =
              byDist.find((d) => (depotSpace.get(d.id) ?? 0) > 0) ?? byDist[0];
            depotSpace.set(home.id, (depotSpace.get(home.id) ?? 0) - 1);
            perVehicle.push(routeFrom(home.id, home.node));
          }
          extras.depotPaths = perVehicle;
          extras.depotPath = perVehicle.find(Boolean) ?? undefined;
        } else {
          // idle line: no buses to garage, but keep a sensible pull-out
          extras.depotPath = routeFrom(byDist[0].id, byDist[0].node) ?? undefined;
        }
      }
      out.set(l.id, extras);
    }
    return out;
  }

  function openDemandPopup(map: MLMap, idx: number): void {
    const st = useGame.getState();
    const bg = st.pack?.blockGroups[idx];
    if (!bg) return;
    const fmtI = (v: number) => Math.round(v).toLocaleString();
    const kv = (label: string, val: string) =>
      `<div class="dp-kv"><span>${label}</span><b>${val}</b></div>`;
    const rows =
      kv('Residents', fmtI(bg.pop)) +
      kv('Jobs', fmtI(bg.jobs)) +
      ((bg.edu ?? 0) > 0 ? kv('· in education', fmtI(bg.edu ?? 0)) : '') +
      ((bg.tour ?? 0) > 0 ? kv('· in tourism', fmtI(bg.tour ?? 0)) : '') +
      ((bg.air ?? 0) > 0 ? kv('· air travellers', fmtI(bg.air ?? 0)) : '') +
      ((bg.rail ?? 0) > 0 ? kv('· rail connections', fmtI(bg.rail ?? 0)) : '') +
      kv('Density', `${fmtI((bg.pop + bg.jobs) / Math.max(bg.areaKm2, 0.02))} /km²`);
    let modeHtml = '';
    const m = st.stats?.bgModes?.[idx];
    if (m) {
      const total = m.bus + m.car + m.walk + m.bike;
      if (total > 0) {
        const bar = (key: 'car' | 'bus' | 'walk' | 'bike') => {
          const pct = (m[key] / total) * 100;
          return (
            `<div class="dp-mode"><span class="dp-swatch" style="background:${MODE_COLORS[key].fill}"></span>` +
            `<span class="dp-mlabel">${MODE_COLORS[key].label}</span>` +
            `<span class="dp-bar"><i style="width:${pct.toFixed(0)}%;background:${MODE_COLORS[key].fill}"></i></span>` +
            `<b>${pct.toFixed(0)}%</b></div>`
          );
        };
        modeHtml =
          `<div class="dp-modes"><small>${fmtI(total)} commuters start here each day</small>` +
          bar('car') + bar('bus') + bar('walk') + bar('bike') +
          '</div>';
      }
    }
    const streetName = st.graph
      ? (() => {
          const node = st.graph.nearestNode(bg.centroid, 400);
          return node !== null ? st.graph.stopNameAt(node) : null;
        })()
      : null;
    popupRef.current?.remove();
    popupRef.current = new maplibregl.Popup({ maxWidth: '280px', offset: 10 })
      .setLngLat(bg.centroid)
      .setHTML(
        `<div class="demand-popup"><b class="dp-title">${
          streetName ? `${streetName} area` : 'Neighborhood'
        }</b>${rows}${modeHtml}</div>`,
      )
      .addTo(map);
  }

  /** citywide congestion damping from bus ridership (same math as TopBar) */
  function reliefNow(): number {
    const bg = useGame.getState().stats?.bgModes;
    if (!bg) return 1;
    let car = 0;
    let bus = 0;
    for (const m of bg) {
      car += m.car;
      bus += m.bus;
    }
    const baseline = car + bus * 0.87;
    return baseline > 0 ? Math.max(0.6, Math.min(1, car / baseline)) : 1;
  }

  function syncAll(): void {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const st = useGame.getState();
    updateHeatmap(map, pack, st.heatmap, st.stats?.bgModes, st.stops);
    updateNetwork(map, st.stops, st.lines, st.selectedLineId);
    updateDraft(map, st.draft);
    updateTraffic(map, pack, st.trafficView, st.trafficHour, reliefNow());
    syncDepot();
    if (busLayerRef.current) {
      busLayerRef.current.brandColor = st.companyColor;
      busLayerRef.current.setNetwork(
        st.lines, st.stats?.perLine ?? [], st.stops, lineExtras(),
      );
    }
  }

  function syncDepot(): void {
    const map = mapRef.current;
    if (!map) return;
    const st = useGame.getState();
    updateDepots(map, st.depots.map((d) => d.pt));
    const markers = depotMarkersRef.current;
    const alive = new Set(st.depots.map((d) => d.id));
    markers.forEach((m, id) => {
      if (!alive.has(id)) {
        m.remove();
        markers.delete(id);
      }
    });
    for (const d of st.depots) {
      const existing = markers.get(d.id);
      if (existing) {
        existing.setLngLat(d.pt);
        const label = existing.getElement().querySelector('.depot-name');
        if (label && label.textContent !== d.name) label.textContent = d.name;
        continue;
      }
      const el = document.createElement('div');
      el.className = 'depot-marker';
      el.innerHTML =
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M3 10l9-6 9 6v10h-4v-7H7v7H3z"/><path d="M7 20v-3h10v3"/></svg>' +
        '<span class="depot-name"></span>';
      el.querySelector('.depot-name')!.textContent = d.name;
      markers.set(
        d.id,
        new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat(d.pt)
          .addTo(map),
      );
    }
  }

  useEffect(() => {
    const map = mapRef.current;
    if (map && readyRef.current) updateNetwork(map, stops, lines, selectedLineId);
  }, [stops, lines, selectedLineId]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && readyRef.current) updateDraft(map, draft);
    if (map && readyRef.current && !draft) updateDraftCursor(map, null, null);
  }, [draft]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && readyRef.current) {
      updateHeatmap(map, pack, heatmap, stats?.bgModes, useGame.getState().stops);
      if (heatmap === 'off') popupRef.current?.remove();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heatmap, pack, stats]);

  useEffect(() => {
    if (readyRef.current) syncDepot();
  }, [depots]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && readyRef.current) {
      updateTraffic(map, pack, trafficView, trafficHour, reliefNow());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trafficView, trafficHour, stats, pack]);

  useEffect(() => {
    if (readyRef.current && busLayerRef.current) {
      busLayerRef.current.brandColor = useGame.getState().companyColor;
      busLayerRef.current.setNetwork(
        lines, stats?.perLine ?? [], stops, lineExtras(),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, stats, stops]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cursor =
      tool === 'line-new' ? 'crosshair' : tool === 'depot-place' ? 'copy' : '';
    map.getCanvas().style.cursor = cursor;
  }, [tool]);

  // depot name chips only show while the Depot panel is open
  useEffect(() => {
    divRef.current?.classList.toggle(
      'show-depot-names',
      panel === 'depot' || tool === 'depot-place',
    );
  }, [panel, tool]);

  // depot placement: tint the industrial zones where zoning will approve
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    updateZoning(map, tool === 'depot-place' ? industrialZones(pack) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, pack]);

  // glow the stop whose row is hovered in the line editor
  const hoverStopId = useGame((s) => s.hoverStopId);
  useEffect(() => {
    const map = mapRef.current;
    if (map && readyRef.current) updateStopHover(map, hoverStopId);
  }, [hoverStopId]);

  return <div ref={divRef} className="map-root" />;
}

function mixColor(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const m = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${m[0]},${m[1]},${m[2]})`;
}

function parseHex(c: string): number[] {
  const h = c.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
