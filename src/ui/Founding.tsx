import { useState } from 'react';
import { useGame } from '../game/store';
import { LINE_COLORS } from '../game/constants';
import { BusSide } from './icons';

/**
 * Shown once per city, before the map: name your company and pick its brand
 * color. The color paints your first bus line.
 */
export function Founding() {
  const pack = useGame((s) => s.pack);
  const foundCompany = useGame((s) => s.foundCompany);
  const backToMenu = useGame((s) => s.backToMenu);
  const [name, setName] = useState('');
  const [color, setColor] = useState(LINE_COLORS[0]);
  const [sandbox, setSandbox] = useState(false);

  const city = pack?.meta.name ?? 'the city';
  const submit = () =>
    foundCompany(name.trim() || `${city} Transit Co.`, color, sandbox);

  return (
    <div className="founding">
      <div className="founding-card">
        <div className="founding-bus" style={{ color }}>
          <BusSide length={1} />
        </div>
        <h1>Found your company</h1>
        <p className="hint">
          {city} needs buses. Give your transit company a name and pick the
          color it will paint on its first line.
        </p>
        <label className="founding-label" htmlFor="company-name">
          Company name
        </label>
        <input
          id="company-name"
          className="text-input founding-name"
          placeholder={`${city} Transit Co.`}
          maxLength={32}
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <label className="founding-label">Brand color</label>
        <div className="founding-swatches">
          {LINE_COLORS.map((c) => (
            <button
              key={c}
              className={`swatch ${color === c ? 'on' : ''}`}
              style={{ background: c }}
              title={c}
              aria-label={`Brand color ${c}`}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <label className="founding-sandbox">
          <input
            type="checkbox"
            checked={sandbox}
            onChange={(e) => setSandbox(e.target.checked)}
          />
          <span>
            <b>Sandbox mode</b> — infinite money. Build whatever you like;
            the report cards still come, but the bills never hurt.
          </span>
        </label>
        <div className="btn-row founding-actions">
          <button className="btn" onClick={backToMenu}>
            Back
          </button>
          <button className="btn primary" onClick={submit}>
            Found {name.trim() || `${city} Transit Co.`} →
          </button>
        </div>
      </div>
    </div>
  );
}
