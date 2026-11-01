import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../icons';
import { heightUnit, toHeight, type Units } from '../format';
import type { ElevationSource } from '../location';

interface Props {
  /** Elevation the forecast is for, m. */
  forecast: number | null;
  source: ElevationSource;
  /** Terrain under the point, m, for comparison. */
  terrain: number | null;
  placeName: string;
  units: Units;
  onChange: (meters: number | null) => void;
}

const show = (m: number, u: Units) => `${Math.round(toHeight(m, u)).toLocaleString('en-US')} ${heightUnit(u)}`;

/** The forecast elevation, where it came from, and a way to change it. */
export function Elevation({ forecast, source, terrain, placeName, units, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  useEffect(() => setEditing(false), [forecast, source]);

  const sourceText =
    source === 'custom' ? 'set by you' : source === 'listed' ? `listed elevation of ${placeName}` : 'terrain at this point';
  const gap = forecast != null && terrain != null ? terrain - forecast : 0;
  const showTerrain = terrain != null && Math.abs(gap) >= 30;

  const save = () => {
    const v = Number(value);
    if (value.trim() === '' || !Number.isFinite(v)) return;
    onChange(units === 'imperial' ? v / 3.28084 : v);
  };

  return (
    <div class="elev" aria-live="polite">
      <div class="elev-label">Forecast elevation</div>
      {editing ? (
        <form
          class="elev-edit"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input type="number" inputMode="numeric" value={value} onInput={(e) => setValue((e.target as HTMLInputElement).value)} autoFocus aria-label="Forecast elevation" />
          <span class="muted">{heightUnit(units)}</span>
          <button class="pill active" type="submit">Set</button>
          {terrain != null && source !== 'terrain' && (
            <button class="pill" type="button" onClick={() => onChange(null)}>Use terrain</button>
          )}
          <button class="pill" type="button" onClick={() => setEditing(false)}>Cancel</button>
        </form>
      ) : (
        <div class="elev-value">
          <span class="elev-num">{forecast != null ? show(forecast, units) : '–'}</span>
          <button
            class="linkbtn elev-change"
            onClick={() => {
              setValue(forecast != null ? String(Math.round(toHeight(forecast, units))) : '');
              setEditing(true);
            }}
            title="Change the forecast elevation"
          >
            Change
          </button>
        </div>
      )}
      <div class={`elev-src${showTerrain && Math.abs(gap) >= 300 ? ' warn' : ''}`}>
        {sourceText}
        {showTerrain && (
          <>
            {' · '}
            <Icon name="info" size={12} /> terrain under the pin is {show(terrain!, units)} ({gap > 0 ? '+' : '−'}
            {show(Math.abs(gap), units)})
          </>
        )}
      </div>
    </div>
  );
}
