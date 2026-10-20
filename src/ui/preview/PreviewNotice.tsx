import {
  WEBGL_LOST_MESSAGE,
  WEBGL_UNSUPPORTED_MESSAGE,
  lastMapMs,
  lastRenderMs,
  previewStatus,
} from '../../state/render';
import { image } from '../../state/store';
import { formatMs } from './math';

/** Explains why the original is shown when the WebGL preview is unavailable. */
export function PreviewNotice() {
  if (!image.value) return null;
  const status = previewStatus.value;
  let text = '';
  if (status === 'unsupported') text = WEBGL_UNSUPPORTED_MESSAGE;
  else if (status === 'lost') text = WEBGL_LOST_MESSAGE;
  else if (status === 'error') text = 'The simulation could not start on this device. Showing the original photo.';
  if (!text) return null;
  return (
    <p class="notice" role="alert">
      {text}
    </p>
  );
}

/** "Performance: x ms" line for the ⋯ menu (GPU render time, plus the last effect-map build). */
export function PerformanceLine() {
  const render = lastRenderMs.value;
  const maps = lastMapMs.value;
  const status = previewStatus.value;
  const text =
    status === 'ready' && render !== null
      ? `Performance: ${formatMs(render)} ms (maps ${formatMs(maps)} ms)`
      : 'Performance: no live preview';
  return (
    <p class="menu-perf" aria-live="off">
      {text}
    </p>
  );
}
