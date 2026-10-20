import { useEffect } from 'preact/hooks';
import { initPreview } from '../state/render';
import {
  activeTab,
  applyEdit,
  endEdit,
  flipView,
  image,
  loadTestImage,
  photoError,
  photoLoading,
  profile,
  redo,
  uiTextScale,
  undo,
  viewMode,
} from '../state/store';
import { calibrationOpen, closeCalibration, openCalibration } from '../state/ui';
import { CalibrationGuide } from './calibration/CalibrationGuide';
import { PhotoPicker, TestImagePicker } from './PhotoPicker';
import { PreviewNotice } from './preview/PreviewNotice';
import { Sheet } from './Sheet';
import { TopBar } from './TopBar';
import { RegionOverlay } from './edit/RegionOverlay';
import { Viewport } from './viewport/Viewport';

const BASE_FONT_PX = 16;

/** True when the key event belongs to a text field, where Ctrl+Z should keep its native meaning. */
function isTextEditing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color'].includes(target.type);
  }
  return false;
}

/** Ctrl/Cmd+Z undoes; Ctrl+Y or Ctrl/Cmd+Shift+Z redoes. */
function onShortcut(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || isTextEditing(e.target)) return;
  const key = e.key.toLowerCase();
  if (key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if ((key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey)) {
    e.preventDefault();
    redo();
  }
}

function Calibration() {
  if (!calibrationOpen.value) return null;
  const p = profile.value;
  return (
    <CalibrationGuide
      eye={p.eye}
      viewingDistanceCm={p.viewingDistanceCm}
      onDistanceChange={(cm) =>
        applyEdit((q) => (q.viewingDistanceCm === cm ? q : { ...q, viewingDistanceCm: cm }), 'calibration-distance')
      }
      onFlip={flipView}
      onNote={(text) => applyEdit((q) => (q.note === text ? q : { ...q, note: text }), 'calibration-note')}
      onFinish={() => {
        endEdit();
        closeCalibration();
        activeTab.value = 'regions';
      }}
      onClose={() => {
        endEdit();
        closeCalibration();
      }}
    />
  );
}

export function App() {
  const scale = uiTextScale.value;
  useEffect(() => {
    document.documentElement.style.fontSize = `${BASE_FONT_PX * scale}px`;
  }, [scale]);

  useEffect(() => initPreview(), []);

  useEffect(() => {
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);

  const hasImage = image.value !== null;

  return (
    <div class="app">
      <TopBar />
      <div class="workspace">
        <main class="stage">
          <Viewport overlay={(info) => <RegionOverlay info={info} />} />
          {hasImage && viewMode.value === 'original' && (
            <div class="badge" role="status">
              Original
            </div>
          )}
          {!hasImage && (
            <div class="empty">
              <p class="hint">
                {photoLoading.value ? 'Opening image…' : 'Choose a photo or take one with the camera.'}
              </p>
              <div class="cta-row">
                <PhotoPicker kind="photo" variant="cta" />
                <PhotoPicker kind="camera" variant="cta" />
              </div>
              <div class="cta-row">
                <button type="button" class="btn btn-cta btn-secondary" onClick={() => void loadTestImage('amsler')}>
                  Try the Amsler grid
                </button>
                <TestImagePicker variant="cta" />
              </div>
              <button type="button" class="link-btn" onClick={openCalibration}>
                New here? Open the calibration guide
              </button>
            </div>
          )}
          <PreviewNotice />
          {photoError.value && (
            <p class="error" role="alert">
              {photoError.value}
            </p>
          )}
        </main>
        <Sheet />
      </div>
      <footer class="footer">My own approximation — not a clinical measurement.</footer>
      <Calibration />
    </div>
  );
}
