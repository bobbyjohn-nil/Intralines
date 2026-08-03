import { useEffect, useRef } from 'react';
import maplibregl, { Map as MLMap, MapMouseEvent, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { CityPack } from '../game/types';
import { useGame } from '../game/store';
import { buildPackStyle, buildRealStyle, PALETTE } from './basemapStyle';
import {
  ensureOverlays, updateDepot, updateDraft, updateDraftCursor, updateHeatmap, updateNetwork,
} from './overlays';
import { BusLayer3D } from './busLayer3d';

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
      (window as unknown as { __busLayer?: BusLayer3D; __map?: MLMap }).__busLayer = busLayer;
      (window as unknown as { __busLayer?: BusLayer3D; __map?: MLMap }).__map = map;

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
          } else if (st.selectedLineId) {
            st.selectLine(null);
          }
          return;
        }
        st.mapClick(pt);
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
          const label = String(c.count);
          if (el.textContent !== label) el.textContent = label;
          el.title = `${c.count} waiting`;
        }
        for (const [id, m] of chips) {
          if (!seen.has(id)) {
            m.remove();
            chips.delete(id);
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
          map.setPaintProperty(
            'building-3d', 'fill-extrusion-color', blend(PALETTE.building3d, '#3a3f4e'),
          );
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
      readyRef.current = false;
      depotMarkerRef.current?.remove();
      depotMarkerRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack.meta.id, basemapPref]);

  function syncAll(): void {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const st = useGame.getState();
    updateHeatmap(map, pack, st.heatmap);
    updateNetwork(map, st.stops, st.lines, st.selectedLineId);
    updateDraft(map, st.draft);
    syncDepot();
    busLayerRef.current?.setNetwork(st.lines, st.stats?.perLine ?? [], st.stops);
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
    if (map && readyRef.current) updateHeatmap(map, pack, heatmap);
  }, [heatmap, pack]);

  useEffect(() => {
    if (readyRef.current) syncDepot();
  }, [depot]);

  useEffect(() => {
    if (readyRef.current) {
      busLayerRef.current?.setNetwork(lines, stats?.perLine ?? [], stops);
    }
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
