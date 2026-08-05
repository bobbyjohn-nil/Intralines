import { useGame, busModel } from '../game/store';
import { STOP_COST } from '../game/constants';
import { IconCheck, IconClose, IconUndo } from './icons';
import { cyclePreview, reachPop } from './Panels';
import { fmtInt } from './format';

/** floating helper bar while drawing a line or placing the depot */
export function DraftBar() {
  const tool = useGame((s) => s.tool);
  const draft = useGame((s) => s.draft);
  const undo = useGame((s) => s.undoDraftStop);
  const cancel = useGame((s) => s.cancelDraft);
  const finish = useGame((s) => s.finishDraft);
  const setTool = useGame((s) => s.setTool);
  const moveStopId = useGame((s) => s.moveStopId);
  const stops = useGame((s) => s.stops);
  const requestMoveStop = useGame((s) => s.requestMoveStop);

  if (tool === 'route-edit') {
    const moving = moveStopId ? stops.find((x) => x.id === moveStopId) : null;
    return (
      <div className="draftbar">
        <span>
          {moving
            ? `Click a street to move ${moving.name}`
            : `Editing route — click a street to add a stop ($${STOP_COST / 1000}k each)`}
        </span>
        {moving && (
          <button className="btn with-icon" onClick={() => requestMoveStop(null)}>
            <IconClose size={14} /> Cancel move
          </button>
        )}
        <button className="btn primary with-icon" onClick={() => setTool('select')}>
          <IconCheck size={14} /> Done
        </button>
      </div>
    );
  }

  if (tool === 'depot-place') {
    return (
      <div className="draftbar">
        <span>Click near a street to place your depot</span>
        <button className="btn" onClick={() => setTool('select')}>
          Cancel
        </button>
      </div>
    );
  }
  if (tool !== 'line-new' || !draft) return null;
  const cost = draft.stops.length * STOP_COST;
  const lenM = draft.legs.reduce((s, l) => s + l.lenM, 0);
  const prev = cyclePreview(lenM, draft.stops.length, busModel('minibus'));
  const pack = useGame.getState().pack;
  const reach =
    draft.stops.length >= 2 ? reachPop(pack, draft.stops.map((s) => s.pt)) : 0;
  return (
    <div className="draftbar">
      <span>
        {draft.stops.length === 0
          ? `Click a street to place the first stop ($${STOP_COST / 1000}k each)`
          : draft.stops.length < 2
            ? `${draft.stops.length} stop · $${(cost / 1000).toFixed(0)}k — keep clicking`
            : `${draft.stops.length} stops · ${(lenM / 1000).toFixed(1)} km · ` +
              `round trip ~${Math.round(prev.cycleMin)} min · ` +
              `~${fmtInt(reach)} people in reach · $${(cost / 1000).toFixed(0)}k`}
      </span>
      <button className="btn with-icon" onClick={undo} disabled={!draft.stops.length}>
        <IconUndo size={14} /> Undo
      </button>
      <button className="btn with-icon" onClick={cancel}>
        <IconClose size={14} /> Cancel
      </button>
      <button className="btn primary with-icon" onClick={finish} disabled={draft.stops.length < 2}>
        <IconCheck size={14} /> Create line
      </button>
    </div>
  );
}
