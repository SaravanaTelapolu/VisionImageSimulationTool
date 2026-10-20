// Export panel (W3-3): choose what to save, format, orientation and caption, preview the
// side-by-side image, then share or download everything with one button.
import { effect } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { APPROXIMATION_LINE } from '../../../export';
import { renderTick } from '../../../state/render';
import { activeTab, image, profile } from '../../../state/store';
import { Segmented, Slider } from '../../controls';
import {
  JPEG_QUALITY_MAX,
  JPEG_QUALITY_MIN,
  captionFieldsFromProfile,
  captionLinesFromFields,
  disabledReason,
  loadExportOptions,
  planExportFiles,
  resultMessage,
  saveExportOptions,
  type CaptionFields,
  type ExportOptions,
} from './options';
import { runExportJob } from './run';
import { buildThumbnail } from './thumbnail';
import './export.css';

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; text: string }
  | { kind: 'done'; text: string; notice: string }
  | { kind: 'error'; text: string };

const THUMB_DEBOUNCE_MS = 250;

function Check(props: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="export-check">
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange((e.currentTarget as HTMLInputElement).checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}

export function ExportPanel() {
  const [opts, setOpts] = useState<ExportOptions>(() => loadExportOptions());
  const [edits, setEdits] = useState<Partial<CaptionFields>>({});
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [thumbState, setThumbState] = useState<'idle' | 'ready' | 'unavailable'>('idle');
  const thumbRef = useRef<HTMLCanvasElement>(null);

  const hasImage = image.value !== null;
  const prof = profile.value;
  // Caption fields follow the profile until the user edits them.
  const fields: CaptionFields = { ...captionFieldsFromProfile(prof), ...edits };
  const busy = status.kind === 'busy';
  const reason = disabledReason(hasImage, opts);
  const plan = planExportFiles(opts, fields);
  const captionLines = captionLinesFromFields(fields);
  const captionKey = captionLines.join('\n');

  const setOpt = <K extends keyof ExportOptions>(key: K, value: ExportOptions[K]) => {
    setOpts((prev) => {
      const next = { ...prev, [key]: value };
      saveExportOptions(next);
      return next;
    });
  };
  const setField = <K extends keyof CaptionFields>(key: K, value: CaptionFields[K]) =>
    setEdits((prev) => ({ ...prev, [key]: value }));

  // Live thumbnail: debounced, and only while the Export tab is the visible one.
  useEffect(() => {
    if (!hasImage) {
      setThumbState('idle');
      return;
    }
    let timer = 0;
    let snapping = false;
    const draw = () => {
      timer = 0;
      if (activeTab.peek() !== 'export' || busy) return;
      snapping = true; // snapshotPreview may flush a render, which bumps renderTick
      let canvas: HTMLCanvasElement | null = null;
      try {
        canvas = buildThumbnail(opts, captionKey.split('\n'));
      } catch (err) {
        console.warn('[export] thumbnail failed', err);
      } finally {
        snapping = false;
      }
      const target = thumbRef.current;
      if (!canvas || !target) {
        setThumbState('unavailable');
        return;
      }
      target.width = canvas.width;
      target.height = canvas.height;
      target.getContext('2d')?.drawImage(canvas, 0, 0);
      setThumbState('ready');
    };
    const schedule = () => {
      if (snapping) return;
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(draw, THUMB_DEBOUNCE_MS);
    };
    const stop = effect(() => {
      void renderTick.value;
      void image.value;
      void activeTab.value;
      schedule();
    });
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [hasImage, busy, opts.orientation, opts.labels, opts.caption, captionKey]);

  const go = () => {
    setStatus({ kind: 'busy', text: 'Rendering…' });
    runExportJob(opts, fields, (text) => setStatus({ kind: 'busy', text })).then(
      (r) =>
        setStatus({
          kind: 'done',
          text: resultMessage(r.outcome, r.fileCount),
          notice: r.downscaled
            ? `Saved at ${r.width} × ${r.height} px: your phone's graphics chip could not render the full photo size.`
            : '',
        }),
      (err: unknown) => {
        console.warn('[export] failed', err);
        setStatus({ kind: 'error', text: err instanceof Error ? err.message : 'Export failed.' });
      },
    );
  };

  return (
    <div class="export-panel">
      <fieldset class="export-group">
        <legend>What to save</legend>
        <Check label="Simulated" checked={opts.simulated} onChange={(v) => setOpt('simulated', v)} />
        <Check label="Original" checked={opts.original} onChange={(v) => setOpt('original', v)} />
        <Check label="Side by side" checked={opts.sideBySide} onChange={(v) => setOpt('sideBySide', v)} />
      </fieldset>

      <Segmented
        label="Format"
        value={opts.format}
        options={[
          { value: 'png', label: 'PNG' },
          { value: 'jpeg', label: 'JPEG' },
        ]}
        onChange={(v) => setOpt('format', v)}
      />
      {opts.format === 'jpeg' && (
        <Slider
          label="JPEG quality"
          value={opts.jpegQuality}
          min={JPEG_QUALITY_MIN}
          max={JPEG_QUALITY_MAX}
          step={0.05}
          scale={100}
          unit="%"
          resetValue={0.9}
          onInput={(v) => setOpt('jpegQuality', v)}
        />
      )}

      <Segmented
        label="Side-by-side layout"
        value={opts.orientation}
        options={[
          { value: 'auto', label: 'Auto' },
          { value: 'horizontal', label: 'Horizontal' },
          { value: 'vertical', label: 'Vertical' },
        ]}
        onChange={(v) => setOpt('orientation', v)}
      />
      <Check
        label='"Original" / "Simulated" labels'
        checked={opts.labels}
        onChange={(v) => setOpt('labels', v)}
      />

      <Check label="Caption under the image" checked={opts.caption} onChange={(v) => setOpt('caption', v)} />
      {opts.caption && (
        <div class="export-caption-fields">
          <div class="export-fields-row">
            <label class="export-field">
              <span>Date</span>
              <input
                type="date"
                value={fields.date}
                onInput={(e) => setField('date', (e.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <label class="export-field">
              <span>Viewing distance (cm)</span>
              <input
                type="number"
                inputMode="decimal"
                min={5}
                max={500}
                step={1}
                value={fields.viewingDistanceCm}
                onInput={(e) => {
                  const v = parseFloat((e.currentTarget as HTMLInputElement).value);
                  if (Number.isFinite(v) && v > 0) setField('viewingDistanceCm', v);
                }}
              />
            </label>
          </div>
          <Segmented
            label="Eye"
            value={fields.eye}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'right', label: 'Right' },
            ]}
            onChange={(v) => setField('eye', v)}
          />
          <label class="export-field">
            <span>Profile name</span>
            <input
              type="text"
              value={fields.profileName}
              onInput={(e) => setField('profileName', (e.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <label class="export-field">
            <span>Note</span>
            <textarea
              rows={2}
              value={fields.note}
              onInput={(e) => setField('note', (e.currentTarget as HTMLTextAreaElement).value)}
            />
          </label>
          <p class="export-fixed-note">Always included: "{APPROXIMATION_LINE}"</p>
          {Object.keys(edits).length > 0 && (
            <button type="button" class="export-link" onClick={() => setEdits({})}>
              Reset caption to the profile
            </button>
          )}
        </div>
      )}

      {hasImage && (
        <div class="export-preview">
          <p class="export-heading">Preview (side by side)</p>
          <canvas class="export-thumb" ref={thumbRef} hidden={thumbState !== 'ready'} aria-label="Side-by-side preview" />
          {thumbState === 'unavailable' && (
            <p class="export-help">The preview needs the live simulation, which is not running.</p>
          )}
        </div>
      )}

      <button type="button" class="btn btn-cta export-btn" disabled={reason !== '' || busy} onClick={go}>
        {busy ? status.text : 'Share / Save'}
      </button>
      {reason !== '' && <p class="export-help">{reason}</p>}
      {reason === '' && !busy && plan.length > 0 && (
        <p class="export-help">
          {plan.length === 1 ? '1 file' : `${plan.length} files`}: {plan.map((p) => p.name).join(', ')}
        </p>
      )}
      {status.kind === 'done' && (
        <>
          <p class="export-status" role="status">
            {status.text}
          </p>
          {status.notice && <p class="export-notice">{status.notice}</p>}
        </>
      )}
      {status.kind === 'error' && (
        <p class="export-status export-error" role="status">
          {status.text}
        </p>
      )}
    </div>
  );
}
