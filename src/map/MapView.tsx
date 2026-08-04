import { useEffect, useRef } from 'react';
import maplibregl, { Map as MLMap, MapMouseEvent, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { CityPack } from '../game/types';
import { useGame } from '../game/store';
import { buildPackStyle, buildRealStyle, PALETTE } from './basemapStyle';
import {
  ensureOverlays, MODE_COLORS, updateDepot, updateDraft, updateDraftCursor, updateHeatmap,
  updateNetwork,
} from './overlays';
import { BusLayer3D } from './busLayer3d';
import type { LineExtras } from './busLayer3d';
import { cumulativeDist } from '../game/routing';

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
  const depotMarkerRef = useRef<maplibregl.Marker | null>(null);
  const chipsRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const labelsRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const popupRef = useRef<maplibregl.Popup | null>(null);

  const stops = useGame((s) => s.stops);
  const lines = useGame((s) => s.lines);
  const selectedLineId = useGame((s) => s.selectedLineId);
  const draft = useGame((s) => s.draft);
  const heatmap = useGame((s) => s.heatmap);
  const depot = useGame((s) => s.depot);
  const stats = useGame((s) => s.stats);
  const tool = useGame((s) => s.tool);
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
      const pad = 0.35;
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
        ensureOverlays(map);
        map.addLayer(busLayer);
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
            m = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -10] })
              .setLngLat(c.pt)
              .addTo(map!);
            chips.set(c.id, m);
          }
          const el = m.getElement();
          if (el.dataset.count !== String(c.count)) {
            el.dataset.count = String(c.count);
            // circular gauge: fills as the crowd builds (full at ~14 waiting)
            const frac = Math.min(c.count / 14, 1);
            const R = 8.5;
            const circ = 2 * Math.PI * R;
            const color = frac < 0.55 ? '#74b06f' : frac < 0.85 ? '#e0a13c' : '#d16060';
            el.innerHTML =
              `<svg viewBox="0 0 24 24" width="22" height="22">` +
              `<circle cx="12" cy="12" r="${R}" fill="rgba(30,28,22,0.78)" ` +
              `stroke="rgba(255,252,240,0.35)" stroke-width="3.5"/>` +
              `<circle cx="12" cy="12" r="${R}" fill="none" stroke="${color}" ` +
              `stroke-width="3.5" stroke-linecap="round" ` +
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

        // station name labels: zoomed right in, or forced on via Map options
        const st = useGame.getState();
        const labelsOn =
          st.stopLabels === 'always' ? zoomNow >= 11.5 : zoomNow >= 15.5;
        const labels = labelsRef.current;
        const wanted = new Set<string>();
        if (labelsOn) {
          for (const stop of st.stops) {
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
        // roads dim to asphalt tones after dark
        if (map.getLayer('road')) {
          // offline pack style: tiered by speed inside one layer
          map.setPaintProperty('road', 'line-color', [
            'case',
            ['>=', ['get', 'kmh'], 70], blend(PALETTE.motorway, '#57503c'),
            ['>=', ['get', 'kmh'], 42], blend(PALETTE.primary, '#514b3a'),
            ['>=', ['get', 'kmh'], 38], blend(PALETTE.tertiary, '#484659'),
            blend(PALETTE.street, '#434a5a'),
          ]);
          map.setPaintProperty('road-casing', 'line-color', [
            'case',
            ['>=', ['get', 'kmh'], 70], blend(PALETTE.motorwayCasing, '#3a3527'),
            ['>=', ['get', 'kmh'], 42], blend(PALETTE.primaryCasing, '#37332a'),
            ['>=', ['get', 'kmh'], 38], blend(PALETTE.tertiaryCasing, '#2c3038'),
            blend(PALETTE.streetCasing, '#272c37'),
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
          if (map.getLayer(id)) map.setPaintProperty(id, 'line-color', blend(dayC, nightC));
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
      depotMarkerRef.current?.remove();
      depotMarkerRef.current = null;
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
    const dgrid = new Map<string, number[]>();
    const dens: number[] = [];
    for (const bg of pk.blockGroups) {
      const d = (bg.pop + bg.jobs) / Math.max(bg.areaKm2, 0.05);
      dens.push(d);
      const k = `${Math.floor(bg.centroid[0] / CELLD)}:${Math.floor(bg.centroid[1] / CELLD)}`;
      (dgrid.get(k) ?? dgrid.set(k, []).get(k)!).push(d);
    }
    const sorted = [...dens].sort((a, b) => a - b);
    const densNorm = sorted[Math.floor(sorted.length * 0.85)] || 1;
    const localDensity = (pt: [number, number]): number => {
      const gx = Math.floor(pt[0] / CELLD);
      const gy = Math.floor(pt[1] / CELLD);
      let best = 0;
      for (let x = gx - 1; x <= gx + 1; x++) {
        for (let y = gy - 1; y <= gy + 1; y++) {
          for (const d of dgrid.get(`${x}:${y}`) ?? []) if (d > best) best = d;
        }
      }
      return best;
    };

    for (const l of st.lines) {
      const ds: number[] = [];
      let urbanSum = 0;
      let mainCnt = 0;
      let samples = 0;
      let lastSample = -1e9;
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
          urbanSum += Math.min(localDensity(pnt) / densNorm, 1);
          const kmh = g.speedNear(pnt, 60);
          if (kmh !== null && kmh >= 42) mainCnt++;
        }
      }
      const extras: LineExtras = {
        intersections: ds,
        urban: samples ? urbanSum / samples : 0.5,
        mainShare: samples ? mainCnt / samples : 0.5,
      };
      // deadhead: real street route from the depot to the first stop
      const first = st.stops.find((x) => x.id === l.stopIds[0]);
      if (st.depot && first) {
        const r = g.route(st.depot.node, first.node);
        if (r && r.path.length >= 2) {
          const cum = cumulativeDist(r.path, cosLat);
          extras.depotPath = { path: r.path, cum, lenM: cum[cum.length - 1] };
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

  function syncAll(): void {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const st = useGame.getState();
    updateHeatmap(map, pack, st.heatmap, st.stats?.bgModes);
    updateNetwork(map, st.stops, st.lines, st.selectedLineId);
    updateDraft(map, st.draft);
    syncDepot();
    busLayerRef.current?.setNetwork(
      st.lines, st.stats?.perLine ?? [], st.stops, lineExtras(),
    );
  }

  function syncDepot(): void {
    const map = mapRef.current;
    if (!map) return;
    const st = useGame.getState();
    updateDepot(map, st.depot?.pt ?? null);
    if (st.depot && !depotMarkerRef.current) {
      const el = document.createElement('div');
      el.className = 'depot-marker';
      el.innerHTML =
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M3 10l9-6 9 6v10h-4v-7H7v7H3z"/><path d="M7 20v-3h10v3"/></svg>';
      el.title = 'Bus depot';
      depotMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat(st.depot.pt)
        .addTo(map);
    } else if (!st.depot && depotMarkerRef.current) {
      depotMarkerRef.current.remove();
      depotMarkerRef.current = null;
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
      updateHeatmap(map, pack, heatmap, stats?.bgModes);
      if (heatmap === 'off') popupRef.current?.remove();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heatmap, pack, stats]);

  useEffect(() => {
    if (readyRef.current) syncDepot();
  }, [depot]);

  useEffect(() => {
    if (readyRef.current) {
      busLayerRef.current?.setNetwork(
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
