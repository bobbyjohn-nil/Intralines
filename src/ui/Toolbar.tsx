import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGame } from '../game/store';
import type { Panel } from '../game/store';
import {
  IconBus, IconChart, IconDepot, IconHeat, IconHelp, IconMapFold,
  IconPeople, IconPlus, IconPointer, IconReport, IconRoute,
} from './icons';

/** dropdown for the extra demand layers (tourism, education) */
function HeatDropdown({
  heatmap,
  setHeatmap,
}: {
  heatmap: 'off' | 'pop' | 'jobs' | 'tour' | 'edu' | 'modes';
  setHeatmap: (h: 'off' | 'pop' | 'jobs' | 'tour' | 'edu' | 'modes') => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const active = heatmap === 'tour' || heatmap === 'edu' || heatmap === 'modes';

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!boxRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const pick = (h: 'tour' | 'edu' | 'modes') => {
    setHeatmap(heatmap === h ? 'off' : h);
    setOpen(false);
  };

  return (
    <div className="heat-more" ref={boxRef}>
      <button
        className={active ? 'on' : ''}
        onClick={() => setOpen((o) => !o)}
        title="More demand layers: tourism, education"
      >
        <IconHeat />
        <span>
          {heatmap === 'tour'
            ? 'Tourism'
            : heatmap === 'edu'
              ? 'Education'
              : heatmap === 'modes'
                ? 'Modes'
                : 'More'} ▾
        </span>
      </button>
      {open &&
        createPortal(
          // portal: the dock is a transformed overflow container, so the
          // popup must live outside it to escape clipping
          <div className="heat-menu" ref={menuRef}>
            <button
              className={heatmap === 'tour' ? 'on' : ''}
              onClick={() => pick('tour')}
            >
              Tourism demand
              <small>venues, hotels, restaurants</small>
            </button>
            <button
              className={heatmap === 'edu' ? 'on' : ''}
              onClick={() => pick('edu')}
            >
              Educational demand
              <small>schools and campuses</small>
            </button>
            <button
              className={heatmap === 'modes' ? 'on' : ''}
              onClick={() => pick('modes')}
            >
              Travel modes
              <small>who drives, walks, bikes or rides the bus</small>
            </button>
            <p className="heat-note">
              These layers can overlap the residents and work demand — campuses,
              hotels and venues are workplaces too.
            </p>
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
  const hasDepot = useGame((s) => s.depots.length > 0);
  const pack = useGame((s) => s.pack);

  const togglePanel = (p: Panel) => setPanel(panel === p ? 'none' : p);

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
      <div className="dock-split">
        <button
          className={heatmap === 'pop' ? 'on' : ''}
          onClick={() => setHeatmap(heatmap === 'pop' ? 'off' : 'pop')}
          title="Toggle the residents demand heatmap"
        >
          <IconPeople size={15} />
          <span>Residents</span>
        </button>
        <button
          className={heatmap === 'jobs' ? 'on' : ''}
          onClick={() => setHeatmap(heatmap === 'jobs' ? 'off' : 'jobs')}
          title="Toggle the work demand heatmap"
        >
          <IconChart size={15} />
          <span>Work</span>
        </button>
      </div>
      <HeatDropdown heatmap={heatmap} setHeatmap={setHeatmap} />
      <button
        className={panel === 'map-options' ? 'on' : ''}
        onClick={() => togglePanel('map-options')}
        title="Map options: station names, basemap"
      >
        <IconMapFold />
        <span>Map</span>
      </button>
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
      <button
        className={panel === 'depot' ? 'on' : ''}
        onClick={() => togglePanel('depot')}
        title="Depot upgrades"
      >
        <IconDepot />
        <span>Depot</span>
      </button>
      <button
        className={panel === 'finance' ? 'on' : ''}
        onClick={() => togglePanel('finance')}
        title="Cash flow, loan, save files"
      >
        <IconChart />
        <span>Finance</span>
      </button>
      <button
        className={panel === 'report' ? 'on' : ''}
        onClick={() => togglePanel('report')}
        title="Quarterly Transit Authority report cards"
      >
        <IconReport />
        <span>Report</span>
      </button>
      <button
        className={panel === 'help' ? 'on' : ''}
        onClick={() => togglePanel('help')}
        title="How to play"
      >
        <IconHelp />
        <span>Help</span>
      </button>
    </div>
  );
}
