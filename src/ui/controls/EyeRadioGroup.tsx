import type { Eye } from '../../model/types';
import { RadioGroup } from './RadioGroup';

const EYE_OPTIONS = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
] as const;

export interface EyeRadioGroupProps {
  /** Unique radio `name` for this place on the page. */
  name: string;
  /** Group label; "Affected eye" by default. */
  legend?: string;
  /** The chosen eye, or null when not chosen yet. */
  value: Eye | null;
  onChange: (eye: Eye) => void;
}

/** The one Left / Right eye choice used everywhere: "Affected eye: ( ) Left ( ) Right". */
export function EyeRadioGroup({ name, legend = 'Affected eye', value, onChange }: EyeRadioGroupProps) {
  return <RadioGroup<Eye> name={name} legend={legend} value={value} options={EYE_OPTIONS} onChange={onChange} />;
}
