import { useGame } from '../game/store';
import type { Panel } from '../game/store';
import {
  IconBus, IconChart, IconDepot, IconHelp, IconMapFold,
  IconPeople, IconPlus, IconPointer, IconRoute,
} from './icons';

/** the horizontal command dock along the bottom of the screen */
export function Toolbar() {
  const tool = useGame((s) => s.tool);
  const setTool = useGame((s) => s.setTool);
  const panel = useGame((s) => s.panel);
  const setPanel = useGame((s) => s.setPanel);
  const heatmap = useGame((s) => s.heatmap);
  const setHeatmap = useGame((s) => s.setHeatmap);
  const depot = useGame((s) => s.depot);
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
      {!depot && (
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
          <IconPeople size={13} />
          <span>People</span>
        </button>
        <button
          className={heatmap === 'jobs' ? 'on' : ''}
          onClick={() => setHeatmap(heatmap === 'jobs' ? 'off' : 'jobs')}
          title="Toggle the jobs demand heatmap"
        >
          <IconChart size={13} />
          <span>Jobs</span>
        </button>
      </div>
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
