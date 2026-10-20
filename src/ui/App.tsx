import { useEffect, useRef, useState } from 'preact/hooks';
import { loadWorkingImage } from '../image/load';

export function App() {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  async function onPick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-picking the same file
    if (!file) return;
    setError('');
    try {
      const img = await loadWorkingImage(file);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      // Phase 0 shows the original file; later phases render `img.working` via WebGL.
      urlRef.current = URL.createObjectURL(img.original);
      setPhotoUrl(urlRef.current);
      setInfo(`${img.width} x ${img.height}`);
    } catch {
      setError('Could not open that image.');
    }
  }

  return (
    <div class="app">
      <header class="topbar">
        <h1 class="title">Vision Simulator</h1>
        <label class="btn">
          Choose photo
          <input type="file" accept="image/*" onChange={onPick} />
        </label>
        <label class="btn">
          Camera
          <input type="file" accept="image/*" capture="environment" onChange={onPick} />
        </label>
      </header>
      <main class="stage">
        {photoUrl ? (
          <img class="photo" src={photoUrl} alt={`Chosen photo ${info}`} />
        ) : (
          <p class="hint">Choose a photo or take one with the camera.</p>
        )}
        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
      </main>
      <footer class="footer">My own approximation — not a clinical measurement.</footer>
    </div>
  );
}
