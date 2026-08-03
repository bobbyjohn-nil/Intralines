import { useGame } from '../game/store';
import type { Panel } from '../game/store';

const HEAT_LABEL = { off: 'Heatmap off', pop: 'Residents', jobs: 'Jobs' } as const;

export function Toolbar() {
  const tool = useGame((s) => s.tool);
  const setTool = useGame((s) => s.setTool);
  const panel = useGame((s) => s.panel);
  const setPanel = useGame((s) => s.setPanel);
  const heatmap = useGame((s) => s.heatmap);
  const setHeatmap = useGame((s) => s.setHeatmap);
  const depot = useGame((s) => s.depot);
  const pack = useGame((s) => s.pack);
  const basemapPref = useGame((s) => s.basemapPref);
  const basemapActive = useGame((s) => s.basemapActive);
  const toggleBasemap = useGame((s) => s.toggleBasemap);

  const togglePanel = (p: Panel) => setPanel(panel === p ? 'none' : p);
  const cycleHeat = () =>
    setHeatmap(heatmap === 'off' ? 'pop' : heatmap === 'pop' ? 'jobs' : 'off');

  return (
    <div className="toolbar">
      <button
        className={tool === 'select' ? 'on' : ''}
        onClick={() => setTool('select')}
        title="Select / pan (Esc)"
      >
        🖐
      </button>
      <button
        className={tool === 'line-new' ? 'on' : ''}
        onClick={() => setTool('line-new')}
        title="Draw a new bus line"
      >
        ➕
      </button>
      {!depot && (
        <button
          className={`pulse ${tool === 'depot-place' ? 'on' : ''}`}
          onClick={() => setTool('depot-place')}
          title="Place your depot"
        >
          🏗
        </button>
      )}
      <button
        className={heatmap !== 'off' ? 'on' : ''}
        onClick={cycleHeat}
        title={`Demand heatmap: ${HEAT_LABEL[heatmap]} (click to cycle)`}
      >
        {heatmap === 'jobs' ? '💼' : '🌡'}
      </button>
      {pack?.meta.kind === 'real' && (
        <button
          onClick={toggleBasemap}
          title={
            basemapPref === 'offline'
              ? 'Basemap: offline (built-in map, no internet used) — click for online tiles'
              : `Basemap: auto (currently ${basemapActive}) — click to force offline`
          }
        >
          {basemapPref === 'offline' ? '🗺' : '🌐'}
        </button>
      )}
      <div className="toolbar-sep" />
      <button className={panel === 'lines' ? 'on' : ''} onClick={() => togglePanel('lines')} title="Lines">
        🚏
      </button>
      <button className={panel === 'fleet' ? 'on' : ''} onClick={() => togglePanel('fleet')} title="Fleet">
        🚌
      </button>
      <button className={panel === 'staff' ? 'on' : ''} onClick={() => togglePanel('staff')} title="Staff">
        👷
      </button>
      <button className={panel === 'depot' ? 'on' : ''} onClick={() => togglePanel('depot')} title="Depot">
        🏢
      </button>
      <button className={panel === 'finance' ? 'on' : ''} onClick={() => togglePanel('finance')} title="Finances">
        📈
      </button>
      <button className={panel === 'help' ? 'on' : ''} onClick={() => togglePanel('help')} title="How to play">
        ❓
      </button>
    </div>
  );
}
