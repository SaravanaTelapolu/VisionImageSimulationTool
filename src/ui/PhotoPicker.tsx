import { loadPhoto } from '../state/store';
import { CameraIcon, PhotoIcon } from './icons';

interface Props {
  /** 'camera' opens the camera directly on phones. */
  kind: 'photo' | 'camera';
  /** 'cta' = large labelled button (empty state); 'icon' = compact top-bar button. */
  variant: 'cta' | 'icon';
}

/** A file input styled as a button. The invisible input covers the button, so taps open the picker. */
export function PhotoPicker({ kind, variant }: Props) {
  const label = kind === 'camera' ? 'Camera' : 'Choose photo';

  const onChange = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow picking the same file again
    if (file) void loadPhoto(file);
  };

  return (
    <label class={variant === 'cta' ? 'btn btn-cta' : 'iconbtn'} title={label}>
      {kind === 'camera' ? <CameraIcon /> : <PhotoIcon />}
      {variant === 'cta' && <span>{label}</span>}
      <input
        type="file"
        accept="image/*"
        capture={kind === 'camera' ? 'environment' : undefined}
        aria-label={label}
        onChange={onChange}
      />
    </label>
  );
}
