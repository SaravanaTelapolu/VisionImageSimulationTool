import './controls.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
}

/** A small radio-group of buttons (for example Left / Right eye). */
export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div class="segmented" role="radiogroup" aria-label={label}>
      <span class="slider-label">{label}</span>
      <div class="segmented-options">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            class="segmented-btn"
            aria-checked={o.value === value}
            onClick={() => {
              if (o.value !== value) onChange(o.value);
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
