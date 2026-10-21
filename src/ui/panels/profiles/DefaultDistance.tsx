import { useEffect, useState } from 'preact/hooks';
import {
  DISTANCE_PRESETS,
  MAX_VIEWING_DISTANCE_CM,
  MIN_VIEWING_DISTANCE_CM,
  distanceBand,
  formatDistance,
} from '../../../model/distance';
import { defaultDistanceCm, setDefaultDistance } from '../../../state/profiles';

/** A typed distance in cm, or null when it is not a number in the allowed range. */
export function parseDefaultDistance(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  const v = Number(t);
  if (!Number.isFinite(v) || v < MIN_VIEWING_DISTANCE_CM || v > MAX_VIEWING_DISTANCE_CM) return null;
  return Math.round(v * 10) / 10;
}

/** Part of the Profiles tab's "Settings" card: the viewing distance new profiles start with. */
export function DefaultDistanceSetting() {
  const current = defaultDistanceCm.value;
  const [draft, setDraft] = useState(String(current));

  // Follow the saved value (loaded after startup, or changed by a preset or the calibration guide).
  useEffect(() => {
    setDraft((d) => (parseDefaultDistance(d) === current ? d : String(current)));
  }, [current]);

  const invalid = parseDefaultDistance(draft) === null;

  const onInput = (e: Event) => {
    const text = (e.currentTarget as HTMLInputElement).value;
    setDraft(text);
    const cm = parseDefaultDistance(text);
    if (cm !== null) void setDefaultDistance(cm);
  };

  return (
    <div class="pf-setting">
      <p class="pf-label" id="pf-dd-label">
        Default viewing distance for new profiles
      </p>
      <div class="pf-row" role="group" aria-labelledby="pf-dd-label">
        {DISTANCE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            class="pf-btn pf-preset"
            aria-pressed={current === p.cm}
            onClick={() => void setDefaultDistance(p.cm)}
          >
            {p.label} {p.cm} cm
          </button>
        ))}
      </div>
      <label class="pf-label" for="pf-dd-custom">
        Custom (cm)
      </label>
      <input
        id="pf-dd-custom"
        class="pf-input"
        type="number"
        inputMode="decimal"
        min={MIN_VIEWING_DISTANCE_CM}
        max={MAX_VIEWING_DISTANCE_CM}
        step="1"
        value={draft}
        aria-invalid={invalid}
        aria-describedby="pf-dd-hint"
        onInput={onInput}
      />
      {invalid && (
        <p class="pf-msg pf-msg-error" role="alert">
          Enter a distance between {MIN_VIEWING_DISTANCE_CM} and {MAX_VIEWING_DISTANCE_CM} cm.
        </p>
      )}
      <p id="pf-dd-hint" class="pf-hint">
        New profiles start at {formatDistance(current)} ({distanceBand(current)}). Saved profiles keep the distance they were
        made at.
      </p>
    </div>
  );
}
