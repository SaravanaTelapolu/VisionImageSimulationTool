import { useEffect } from 'preact/hooks';
import { image, photoError, photoLoading, uiTextScale, viewMode } from '../state/store';
import { PhotoPicker } from './PhotoPicker';
import { Sheet } from './Sheet';
import { TopBar } from './TopBar';
import { Viewport } from './viewport/Viewport';

const BASE_FONT_PX = 16;

export function App() {
  const scale = uiTextScale.value;
  useEffect(() => {
    document.documentElement.style.fontSize = `${BASE_FONT_PX * scale}px`;
  }, [scale]);

  const hasImage = image.value !== null;

  return (
    <div class="app">
      <TopBar />
      <div class="workspace">
        <main class="stage">
          <Viewport />
          {hasImage && viewMode.value === 'original' && (
            <div class="badge" role="status">
              Original
            </div>
          )}
          {!hasImage && (
            <div class="empty">
              <p class="hint">
                {photoLoading.value ? 'Opening photo…' : 'Choose a photo or take one with the camera.'}
              </p>
              <div class="cta-row">
                <PhotoPicker kind="photo" variant="cta" />
                <PhotoPicker kind="camera" variant="cta" />
              </div>
            </div>
          )}
          {photoError.value && (
            <p class="error" role="alert">
              {photoError.value}
            </p>
          )}
        </main>
        <Sheet />
      </div>
      <footer class="footer">My own approximation — not a clinical measurement.</footer>
    </div>
  );
}
