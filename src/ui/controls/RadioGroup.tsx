import './controls.css';

export interface RadioOption<T extends string> {
  value: T;
  label: string;
}

export interface RadioGroupProps<T extends string> {
  /** Shared `name` of the radio inputs; must be unique on the page so groups never merge. */
  name: string;
  /** Visible group label (a real <legend>). */
  legend: string;
  /** The selected option, or null when the user has not chosen yet. */
  value: T | null;
  options: readonly RadioOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}

/**
 * A group of real radio buttons in a fieldset: large (44 px) targets, high contrast, and the
 * browser's own keyboard behaviour (Tab to the group, arrow keys move and select).
 */
export function RadioGroup<T extends string>({ name, legend, value, options, onChange, disabled }: RadioGroupProps<T>) {
  return (
    <fieldset class="radio-group" disabled={disabled}>
      <legend class="radio-legend">{legend}</legend>
      <div class="radio-options">
        {options.map((o) => (
          <label key={o.value} class="radio-option" data-checked={o.value === value ? 'true' : undefined}>
            <input
              type="radio"
              class="radio-input"
              name={name}
              value={o.value}
              checked={o.value === value}
              onChange={() => {
                if (o.value !== value) onChange(o.value);
              }}
            />
            <span class="radio-text">{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
