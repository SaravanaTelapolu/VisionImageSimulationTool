import { useId } from 'preact/hooks';
import './controls.css';

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  help?: string;
  disabled?: boolean;
}

/** A labelled on/off switch (a checkbox with role="switch"), at least 44 px tall. */
export function Toggle({ label, checked, onChange, help, disabled }: ToggleProps) {
  const uid = useId();
  const helpId = `tgh-${uid}`;
  return (
    <div class="toggle" data-disabled={disabled ? 'true' : undefined}>
      <label class="toggle-row">
        <span class="toggle-label">{label}</span>
        <input
          class="toggle-input"
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          aria-describedby={help ? helpId : undefined}
          onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
        />
        <span class="toggle-track" aria-hidden="true" />
      </label>
      {help && (
        <p class="slider-help" id={helpId}>
          {help}
        </p>
      )}
    </div>
  );
}
