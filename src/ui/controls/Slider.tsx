import { useId } from 'preact/hooks';
import './controls.css';
import { clamp, formatValue, formatWithUnit, valueToPercent } from './format';

export interface SliderProps {
  label: string;
  /** Stored value (not the displayed one). */
  value: number;
  min: number;
  max: number;
  step: number;
  /** Unit shown after the readout, for example "px", "%", "°", "cm". */
  unit?: string;
  /** Multiplier from stored to displayed units (100 for a 0..1 value shown as %). */
  scale?: number;
  /** Prefix positive readouts with "+" (for ranges that include negatives). */
  signed?: boolean;
  /** One-line plain-language help. */
  help?: string;
  disabled?: boolean;
  /** Value the small reset button restores (default 0, clamped into the range). */
  resetValue?: number;
  /** Hide the reset button. */
  noReset?: boolean;
  /** Called continuously while dragging. */
  onInput: (value: number) => void;
  /** Called once on release / change. */
  onCommit?: () => void;
}

export function Slider(props: SliderProps) {
  const { label, value, min, max, step, unit, scale, signed, help, disabled, noReset, onInput, onCommit } = props;
  const uid = useId();
  const inputId = `sl-${uid}`;
  const helpId = `slh-${uid}`;
  const reset = clamp(props.resetValue ?? 0, min, max);
  const fmt = { scale, step, signed };
  const readout = formatValue(value, fmt);
  const text = formatWithUnit(value, unit, fmt);
  const pct = valueToPercent(value, min, max);

  const commit = () => onCommit?.();

  return (
    <div class="slider" data-disabled={disabled ? 'true' : undefined}>
      <div class="slider-head">
        <label class="slider-label" for={inputId}>
          {label}
        </label>
        <output class="slider-value" for={inputId}>
          {readout}
          {unit && <span class="slider-unit">{unit === '%' || unit === '°' ? unit : ` ${unit}`}</span>}
        </output>
      </div>
      <div class="slider-row">
        <input
          id={inputId}
          class="slider-input"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          style={{ '--pct': `${pct}%` }}
          aria-valuetext={text}
          aria-describedby={help ? helpId : undefined}
          onInput={(e) => onInput(clamp(parseFloat((e.currentTarget as HTMLInputElement).value), min, max))}
          onChange={commit}
          onPointerUp={commit}
          onPointerCancel={commit}
          onKeyUp={commit}
        />
        {!noReset && (
          <button
            type="button"
            class="slider-reset"
            disabled={disabled || value === reset}
            aria-label={`Reset ${label} to ${formatWithUnit(reset, unit, fmt)}`}
            title="Reset"
            onClick={() => {
              onInput(reset);
              commit();
            }}
          >
            {reset === 0 ? '0' : '↺'}
          </button>
        )}
      </div>
      {help && (
        <p class="slider-help" id={helpId}>
          {help}
        </p>
      )}
    </div>
  );
}
