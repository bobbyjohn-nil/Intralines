import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useGame } from '../game/store';
import type { Panel } from '../game/store';
import {
  IconBus, IconChart, IconDepot, IconHeat, IconHelp, IconMapFold,
  IconPeople, IconPlus, IconPointer, IconReport, IconRoute,
} from './icons';

type Heatmap = 'off' | 'pop' | 'dest' | 'modes';

/**
 * A dock button that opens a menu. The menu is portaled to the body: the dock
 * is a transformed overflow container, so a popup inside it gets clipped.
 */
function DockMenu({
  label,
  icon,
  active,
  children,
  title,
}: {
  label: string;
  icon: ReactNode;
  active?: boolean;
  title?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!boxRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="dock-menu" ref={boxRef}>
      <button
        className={active ? 'on' : ''}
        onClick={() => setOpen((o) => !o)}
        title={title}
      >
        {icon}
        <span>{label} ▾</span>
      </button>
      {open &&
        createPortal(
          <div className="heat-menu" ref={menuRef}>
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** the horizontal command dock along the bottom of the screen */
export function Toolbar() {
  const tool = useGame((s) => s.tool);
  const setTool = useGame((s) => s.setTool);
  const panel = useGame((s) => s.panel);
  const setPanel = useGame((s) => s.setPanel);
  const heatmap = useGame((s) => s.heatmap);
  const setHeatmap = useGame((s) => s.setHeatmap);
  const trafficView = useGame((s) => s.trafficView);
  const setTrafficView = useGame((s) => s.setTrafficView);
  const hasDepot = useGame((s) => s.depots.length > 0);

  const togglePanel = (p: Panel) => setPanel(panel === p ? 'none' : p);
  const pickLayer = (h: Heatmap, close: () => void) => {
    setHeatmap(heatmap === h ? 'off' : h);
    close();
  };

  const LAYERS: [Heatmap, string, string][] = [
    ['pop', 'Residents', 'where the trips start'],
    ['dest', 'Destinations', 'jobs, campuses, hotels, airport and rail'],
    ['modes', 'Travel modes', 'who drives, walks, bikes or rides the bus'],
  ];
  const layerName = LAYERS.find(([h]) => h === heatmap)?.[1];

  return (
    <div className="dock">
      <button
        className={tool === 'select' ? 'on' : ''}
        onClick={() => setTool('select')}
        title="Select and pan the map (Esc)"
      >
        <IconPointer />
        <span>Select</span>
      </button>
      <button
        className={tool === 'line-new' ? 'on' : ''}
        onClick={() => setTool('line-new')}
        title="Draw a new bus line along streets"
      >
        <IconPlus />
        <span>New line</span>
      </button>
      {!hasDepot && (
        <button
          className={`pulse ${tool === 'depot-place' ? 'on' : ''}`}
          onClick={() => setTool('depot-place')}
          title="Place your depot — every bus needs a home"
        >
          <IconDepot />
          <span>Place depot</span>
        </button>
      )}

      <div className="dock-sep" />

      {/* everything that changes what the map shows, in one place */}
      <DockMenu
        label={layerName ?? (trafficView ? 'Traffic' : 'Map')}
        icon={<IconHeat />}
        active={heatmap !== 'off' || trafficView || panel === 'map-options'}
        title="Demand layers, traffic and map options"
      >
        {(close) => (
          <>
            {LAYERS.map(([h, name, blurb]) => (
              <button
                key={h}
                className={heatmap === h ? 'on' : ''}
                onClick={() => pickLayer(h, close)}
              >
                {name}
                <small>{blurb}</small>
              </button>
            ))}
            <div className="menu-sep" />
            <button
              className={trafficView ? 'on' : ''}
              onClick={() => {
                setTrafficView(!trafficView);
                close();
              }}
            >
              Traffic forecast
              <small>tint main roads by how jammed they get</small>
            </button>
            <button
              className={panel === 'map-options' ? 'on' : ''}
              onClick={() => {
                setPanel('map-options');
                close();
              }}
            >
              Map options…
              <small>station names, basemap, forecast hour</small>
            </button>
          </>
        )}
      </DockMenu>

      <div className="dock-sep" />

      <button
        className={panel === 'lines' || panel === 'line-edit' ? 'on' : ''}
        onClick={() => togglePanel('lines')}
        title="Your bus lines"
      >
        <IconRoute />
        <span>Lines</span>
      </button>
      <button
        className={panel === 'fleet' ? 'on' : ''}
        onClick={() => togglePanel('fleet')}
        title="Buy and sell buses"
      >
        <IconBus />
        <span>Fleet</span>
      </button>
      <button
        className={panel === 'staff' ? 'on' : ''}
        onClick={() => togglePanel('staff')}
        title="Drivers and mechanics"
      >
        <IconPeople />
        <span>Staff</span>
      </button>

      {/* the panels you open once in a while rather than once a minute */}
      <DockMenu
        label="Company"
        icon={<IconChart />}
        active={panel === 'depot' || panel === 'finance' || panel === 'report' || panel === 'help'}
        title="Depot, finance, report cards and help"
      >
        {(close) => (
          <>
            <button
              className={panel === 'depot' ? 'on' : ''}
              onClick={() => {
                setPanel('depot');
                close();
              }}
            >
              Depot
              <small>capacity, workshop, chargers</small>
            </button>
            <button
              className={panel === 'finance' ? 'on' : ''}
              onClick={() => {
                setPanel('finance');
                close();
              }}
            >
              Finance
              <small>cash flow, loans, save files</small>
            </button>
            <button
              className={panel === 'report' ? 'on' : ''}
              onClick={() => {
                setPanel('report');
                close();
              }}
            >
              Report cards
              <small>how the Transit Authority rates you</small>
            </button>
            <div className="menu-sep" />
            <button
              className={panel === 'help' ? 'on' : ''}
              onClick={() => {
                setPanel('help');
                close();
              }}
            >
              How to play
              <small>the whole loop, start to finish</small>
            </button>
          </>
        )}
      </DockMenu>
    </div>
  );
}

/** kept for the help panel's cross-reference to the old Map button */
export const MAP_PANEL: Panel = 'map-options';
