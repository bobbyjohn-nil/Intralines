import { useGame } from '../game/store';

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
        <span>🏗 Click near a street to place your depot</span>
        <button className="btn" onClick={() => setTool('select')}>
          Cancel
        </button>
      </div>
    );
  }
  if (tool !== 'line-new' || !draft) return null;
  return (
    <div className="draftbar">
      <span>
        ✏️ {draft.stops.length === 0
          ? 'Click a street to place the first stop'
          : `${draft.stops.length} stops — keep clicking, or finish`}
      </span>
      <button className="btn" onClick={undo} disabled={!draft.stops.length}>
        ↶
      </button>
      <button className="btn" onClick={cancel}>
        ✕
      </button>
      <button className="btn primary" onClick={finish} disabled={draft.stops.length < 2}>
        ✓ Create
      </button>
    </div>
  );
}
