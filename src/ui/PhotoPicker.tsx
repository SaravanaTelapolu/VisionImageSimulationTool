import { testImages } from '../assets/testImages';
import { loadPhoto, loadTestImage } from '../state/store';
import { CameraIcon, PhotoIcon } from './icons';

interface TestImagePickerProps {
  /** 'cta' = large button-like select (empty state); 'menu' = full-width row in the ⋯ menu. */
  variant: 'cta' | 'menu';
  /** Called after an image was chosen (for example to close a menu). */
  onPicked?: () => void;
}

/** A native select listing the built-in test images (Amsler grid, reading text, ...). */
export function TestImagePicker({ variant, onPicked }: TestImagePickerProps) {
  const onChange = (e: Event) => {
    const select = e.currentTarget as HTMLSelectElement;
    const id = select.value;
    select.value = '';
    if (!id) return;
    void loadTestImage(id);
    onPicked?.();
  };
  return (
    <label class={variant === 'cta' ? 'btn btn-cta btn-secondary test-picker' : 'test-picker test-picker-menu'}>
      <span>Test image</span>
      <select aria-label="Load a test image" value="" onChange={onChange}>
        <option value="" disabled>
          Choose a test image…
        </option>
        {testImages.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}

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
