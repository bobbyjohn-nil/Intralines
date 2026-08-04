import { useGame } from '../game/store';
import { STOP_COST } from '../game/constants';
import { IconCheck, IconClose, IconUndo } from './icons';

/** floating helper bar while drawing a line or placing the depot */
export function DraftBar() {
  const tool = useGame((s) => s.tool);
  const draft = useGame((s) => s.draft);
  const undo = useGame((s) => s.undoDraftStop);
  const cancel = useGame((s) => s.cancelDraft);
  const finish = useGame((s) => s.finishDraft);
  const setTool = useGame((s) => s.setTool);

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
  return (
    <div className="draftbar">
      <span>
        {draft.stops.length === 0
          ? `Click a street to place the first stop ($${STOP_COST / 1000}k each)`
          : `${draft.stops.length} stops · $${(cost / 1000).toFixed(0)}k to build — ` +
            'keep clicking, or finish'}
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
