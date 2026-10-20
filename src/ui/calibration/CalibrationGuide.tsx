import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import type { Eye } from '../../model/types';
import {
  calibrationReducer,
  initialCalibrationState,
  isFirstStep,
  isLastStep,
  stepId,
  type TestImage,
} from './calibrationSteps';
import {
  APPROXIMATION_NOTE,
  DISTANCE_TIP,
  MAX_DISTANCE_CM,
  MIN_DISTANCE_CM,
  SYMPTOMS,
  eyeName,
  eyeNameCapitalised,
  goodEyeName,
  parseDistanceCm,
  stepIndicator,
} from './calibrationText';
import './calibration.css';

export interface CalibrationGuideProps {
  /** The affected eye. */
  eye: Eye;
  viewingDistanceCm: number;
  onDistanceChange: (cm: number) => void;
  /** Toggle between original and simulated views. */
  onFlip: () => void;
  /** Called with the user's notes about what looks wrong. */
  onNote: (text: string) => void;
  /** User is ready to adjust regions and effects. */
  onFinish: () => void;
  onClose: () => void;
}

const TITLES = [
  'Set up',
  'Look with the affected eye',
  'Switch eyes and match',
  'Check with Flip',
  'Tips for next time',
] as const;

function Crosshair({ grid }: { grid: boolean }) {
  const lines = [];
  if (grid) {
    for (let i = 0; i <= 10; i++) {
      const p = 10 + i * 18;
      lines.push(<line key={`h${i}`} x1={10} y1={p} x2={190} y2={p} />);
      lines.push(<line key={`v${i}`} x1={p} y1={10} x2={p} y2={190} />);
    }
  }
  return (
    <svg
      class="cal-figure"
      viewBox="0 0 200 200"
      role="img"
      aria-label={grid ? 'Amsler grid with a centre dot' : 'Centre crosshair'}
    >
      <rect x="0" y="0" width="200" height="200" fill="#fff" />
      <g stroke="#000" stroke-width="1">
        {lines}
      </g>
      {!grid && (
        <g stroke="#000" stroke-width="3">
          <line x1="100" y1="70" x2="100" y2="130" />
          <line x1="70" y1="100" x2="130" y2="100" />
        </g>
      )}
      {grid && <circle cx="100" cy="100" r="5" fill="#000" />}
    </svg>
  );
}

export function CalibrationGuide(props: CalibrationGuideProps) {
  const { eye, viewingDistanceCm, onDistanceChange, onFlip, onNote, onFinish, onClose } = props;
  const [state, dispatch] = useReducer(calibrationReducer, initialCalibrationState);
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState(String(viewingDistanceCm));
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Keep the typed draft in sync when the prop changes from outside.
  useEffect(() => {
    setDraft((d) => (parseDistanceCm(d) === viewingDistanceCm ? d : String(viewingDistanceCm)));
  }, [viewingDistanceCm]);

  // Move focus to the step heading on every step change.
  useEffect(() => {
    headingRef.current?.focus();
  }, [state.step]);

  // Escape closes; Tab is kept inside the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = rootRef.current;
      if (!root) return;
      const items = Array.from(
        root.querySelectorAll<HTMLElement>('button, input, textarea'),
      ).filter((el) => !(el as HTMLButtonElement).disabled);
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (!firstEl || !lastEl) return;
      const active = document.activeElement;
      const outside = !root.contains(active);
      if (e.shiftKey && (active === firstEl || active === headingRef.current || outside)) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && (active === lastEl || outside)) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const id = stepId(state);
  const affected = eyeName(eye);
  const good = goodEyeName(eye);
  const first = isFirstStep(state);
  const last = isLastStep(state);
  const distanceInvalid = parseDistanceCm(draft) === null;

  const onDistanceInput = (e: Event) => {
    const text = (e.currentTarget as HTMLInputElement).value;
    setDraft(text);
    const cm = parseDistanceCm(text);
    if (cm !== null) onDistanceChange(cm);
  };

  const onNoteInput = (e: Event) => {
    const text = (e.currentTarget as HTMLTextAreaElement).value;
    setNote(text);
    onNote(text);
  };

  const setImage = (image: TestImage) => dispatch({ type: 'setImage', image });

  let body;
  switch (id) {
    case 'setup':
      body = (
        <>
          <p>Use the same test image every time so later snapshots can be compared.</p>
          <fieldset class="cal-fieldset">
            <legend>Test image</legend>
            <label class="cal-choice">
              <input
                type="radio"
                name="cal-image"
                checked={state.image === 'amsler'}
                onChange={() => setImage('amsler')}
              />
              <span>Amsler grid (best for gaps and waviness)</span>
            </label>
            <label class="cal-choice">
              <input
                type="radio"
                name="cal-image"
                checked={state.image === 'photo'}
                onChange={() => setImage('photo')}
              />
              <span>A familiar photo you know well</span>
            </label>
          </fieldset>
          <ul class="cal-list">
            <li>Sit in good, even light with no glare on the screen.</li>
            <li>Hold the phone steady, or prop it up.</li>
          </ul>
          <label class="cal-field" for="cal-distance">
            Viewing distance (cm)
          </label>
          <input
            id="cal-distance"
            class="cal-input"
            type="number"
            inputMode="decimal"
            min={MIN_DISTANCE_CM}
            max={MAX_DISTANCE_CM}
            step="1"
            value={draft}
            aria-invalid={distanceInvalid}
            aria-describedby="cal-distance-tip"
            onInput={onDistanceInput}
          />
          {distanceInvalid && (
            <p class="cal-error" role="alert">
              Enter a distance between {MIN_DISTANCE_CM} and {MAX_DISTANCE_CM} cm.
            </p>
          )}
          <p id="cal-distance-tip" class="cal-muted">
            {DISTANCE_TIP}
          </p>
        </>
      );
      break;
    case 'look':
      body = (
        <>
          <ol class="cal-list">
            <li>
              Cover your <strong>{good}</strong> with your hand or a card. Do not press on it.
            </li>
            <li>
              Look at the centre {state.image === 'amsler' ? 'dot' : 'crosshair'} with your{' '}
              <strong>{affected}</strong> and keep staring at it.
            </li>
            <li>Without moving your gaze, notice what looks wrong: {SYMPTOMS.join(', ')}.</li>
          </ol>
          <Crosshair grid={state.image === 'amsler'} />
          <label class="cal-field" for="cal-note">
            What did you notice? (optional)
          </label>
          <textarea
            id="cal-note"
            class="cal-input cal-textarea"
            rows={4}
            value={note}
            placeholder="For example: a dark patch just left of centre, lines look wavy"
            onInput={onNoteInput}
          />
        </>
      );
      break;
    case 'switch':
      body = (
        <>
          <ol class="cal-list">
            <li>
              Uncover your <strong>{good}</strong>.
            </li>
            <li>
              Now cover your <strong>{affected}</strong> and look at the simulated image with the
              good eye.
            </li>
            <li>
              Adjust regions and effects until the simulation matches what you noted for your{' '}
              {affected}.
            </li>
          </ol>
          <p class="cal-muted">
            The brain can fill in gaps, so a missing area may be easy to overlook. If in doubt,
            check the Amsler grid again.
          </p>
          <button type="button" class="cal-btn cal-btn-primary cal-wide" onClick={onFinish}>
            Start adjusting
          </button>
        </>
      );
      break;
    case 'check':
      body = (
        <>
          <ol class="cal-list">
            <li>
              Press <strong>Flip</strong> to switch quickly between the original and the simulated
              view.
            </li>
            <li>
              Look again with your <strong>{affected}</strong> (cover your {good}) and compare it
              with the simulation.
            </li>
            <li>Keep adjusting until the two feel alike.</li>
          </ol>
          <button type="button" class="cal-btn cal-btn-primary cal-wide" onClick={onFlip}>
            Flip original / simulated
          </button>
        </>
      );
      break;
    case 'tips':
      body = (
        <>
          <ul class="cal-list">
            <li>Keep sessions short. Judging with one eye covered is tiring.</li>
            <li>
              Use the same distance ({viewingDistanceCm} cm) and the same test image each time, so
              later snapshots compare fairly.
            </li>
            <li>Rest your eyes between checks, and look again another day if unsure.</li>
          </ul>
          <p class="cal-note">{APPROXIMATION_NOTE}</p>
        </>
      );
      break;
  }

  return (
    <div
      ref={rootRef}
      class="cal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cal-title"
    >
      <header class="cal-header">
        <p class="cal-indicator" aria-live="polite">
          {stepIndicator(state.step)}
        </p>
        <button
          type="button"
          class="cal-btn cal-btn-ghost"
          onClick={onClose}
          aria-label="Close calibration guide"
        >
          Close
        </button>
      </header>
      <main class="cal-body">
        <h2 id="cal-title" class="cal-title" tabIndex={-1} ref={headingRef}>
          {id === 'look' ? `Look with your ${affected}` : TITLES[state.step]}
        </h2>
        <p class="cal-eyes">
          Affected eye: <strong>{eyeNameCapitalised(eye)}</strong>
        </p>
        {body}
      </main>
      <footer class="cal-footer">
        <button
          type="button"
          class="cal-btn cal-btn-secondary"
          disabled={first}
          onClick={() => dispatch({ type: 'back' })}
        >
          Back
        </button>
        <button
          type="button"
          class="cal-btn cal-btn-primary"
          onClick={() => (last ? onClose() : dispatch({ type: 'next' }))}
        >
          {last ? 'Done' : 'Next'}
        </button>
      </footer>
    </div>
  );
}
