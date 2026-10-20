// BASIC EXPORT PANEL (W2-1). Two buttons: simulated PNG and side-by-side PNG, with the standard
// caption. W3-3 replaces/extends this file with PNG/JPEG choice, caption fields, orientation and
// share options; the building blocks it should reuse are runExport() below, renderFullSize() and
// getOriginalCanvas() in src/state/render.ts and the src/export/* helpers.
import { useState } from 'preact/hooks';
import { buildCaptionLines, composeExport, canvasToBlob, exportFileName, shareOrDownload } from '../../../export';
import type { ExportKind } from '../../../export';
import { getOriginalCanvas, renderFullSize } from '../../../state/render';
import { image, profile } from '../../../state/store';

type Status = { kind: 'idle' } | { kind: 'busy'; what: ExportKind } | { kind: 'done' | 'error'; text: string };

async function blobToBitmapCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob);
  try {
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available.');
    ctx.drawImage(bmp, 0, 0);
    return c;
  } finally {
    bmp.close();
  }
}

/** Renders, composes (with caption) and shares or downloads one export. Returns a status line. */
export async function runExport(kind: 'simulated' | 'side-by-side'): Promise<string> {
  const p = profile.peek();
  const date = new Date();
  const caption = buildCaptionLines({
    date,
    eye: p.eye,
    viewingDistanceCm: p.viewingDistanceCm,
    note: p.note,
    profileName: p.name,
  });
  const sim = await renderFullSize({ type: 'image/png' });
  const simCanvas = await blobToBitmapCanvas(sim.blob);
  const original = kind === 'side-by-side' ? await getOriginalCanvas(Math.max(sim.width, sim.height)) : undefined;
  const composed = composeExport({
    simulated: simCanvas,
    ...(original ? { original } : {}),
    orientation: 'auto',
    caption,
    labels: kind === 'side-by-side',
  });
  const blob = await canvasToBlob(composed, 'image/png');
  const name = exportFileName({ profileName: p.name, date, kind, ext: 'png' });
  const result = await shareOrDownload([{ blob, name }], 'Vision simulation');
  const size = `${composed.width} × ${composed.height}`;
  const note = sim.downscaled ? ' (reduced to fit this device)' : '';
  if (result === 'cancelled') return 'Sharing cancelled.';
  return `${result === 'shared' ? 'Shared' : 'Saved'} ${name} — ${size}${note}.`;
}

export function ExportPanel() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const hasImage = image.value !== null;
  const busy = status.kind === 'busy';

  const go = (kind: 'simulated' | 'side-by-side') => {
    setStatus({ kind: 'busy', what: kind });
    runExport(kind).then(
      (text) => setStatus({ kind: 'done', text }),
      (err: unknown) => {
        console.warn('[export] failed', err);
        setStatus({ kind: 'error', text: err instanceof Error ? err.message : 'Export failed.' });
      },
    );
  };

  return (
    <div class="export-panel">
      {!hasImage && <p class="panel-placeholder">Load a photo or a test image first.</p>}
      <button
        type="button"
        class="btn export-btn"
        disabled={!hasImage || busy}
        onClick={() => go('simulated')}
      >
        {busy && status.what === 'simulated' ? 'Rendering…' : 'Save simulated image (PNG)'}
      </button>
      <button
        type="button"
        class="btn btn-secondary export-btn"
        disabled={!hasImage || busy}
        onClick={() => go('side-by-side')}
      >
        {busy && status.what === 'side-by-side' ? 'Rendering…' : 'Save side-by-side (PNG)'}
      </button>
      <p class="export-help">
        Full size, with the date, eye, viewing distance, your note and the "approximation" line underneath.
      </p>
      {(status.kind === 'done' || status.kind === 'error') && (
        <p class={status.kind === 'error' ? 'export-status export-error' : 'export-status'} role="status">
          {status.text}
        </p>
      )}
    </div>
  );
}
