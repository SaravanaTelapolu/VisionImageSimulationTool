// Export panel (W3-3): choose what to save, format, orientation and caption, preview the
// side-by-side image, then prepare the files and share or download them (two steps, so the Android
// share sheet gets a fresh tap).
import { effect } from '@preact/signals';
import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import { APPROXIMATION_LINE } from '../../../export';
import { renderTick } from '../../../state/render';
import { activeTab, image, profile } from '../../../state/store';
import { EyeRadioGroup, Segmented, Slider } from '../../controls';
import {
  JPEG_QUALITY_MAX,
  JPEG_QUALITY_MIN,
  captionFieldsFromProfile,
  captionLinesFromFields,
  disabledReason,
  loadExportOptions,
  planExportFiles,
  saveExportOptions,
  type CaptionFields,
  type ExportOptions,
} from './options';
import { INITIAL_FLOW, exportFlowReducer, primaryLabel } from './exportFlow';
import { canShareFiles, downloadFiles, prepareExport, shareNow } from './run';
import { buildThumbnail } from './thumbnail';
import './export.css';

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
  const [flow, dispatch] = useReducer(exportFlowReducer, INITIAL_FLOW);
  const [thumbState, setThumbState] = useState<'idle' | 'ready' | 'unavailable'>('idle');
  const thumbRef = useRef<HTMLCanvasElement>(null);

  const hasImage = image.value !== null;
  const prof = profile.value;
  // Caption fields follow the profile until the user edits them.
  const fields: CaptionFields = { ...captionFieldsFromProfile(prof), ...edits };
  const busy = flow.phase === 'preparing' || flow.phase === 'sharing';
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

  // Files that were already prepared no longer match once anything they depend on changes.
  useEffect(() => {
    dispatch({ type: 'invalidate' });
  }, [opts, edits, prof, image.value]);

  const prepare = () => {
    dispatch({ type: 'prepare' });
    const job = flow.job + 1;
    prepareExport(opts, fields, (text) => dispatch({ type: 'progress', job, text })).then(
      (prepared) => dispatch({ type: 'prepared', job, prepared }),
      (err: unknown) => {
        console.warn('[export] failed', err);
        dispatch({ type: 'prepare-failed', job, text: err instanceof Error ? err.message : 'Export failed.' });
      },
    );
  };

  // Called straight from the tap: shareNow() starts navigator.share before anything is awaited.
  const share = () => {
    const prepared = flow.prepared;
    if (!prepared) return;
    const pending = shareNow(prepared.shareFiles, 'Vision simulation');
    dispatch({ type: 'share-start' });
    pending.then(
      (outcome) => dispatch({ type: 'share-done', outcome }),
      (err: unknown) => {
        console.warn('[export] share failed', err);
        dispatch({ type: 'share-failed', text: 'Sharing did not work on this device. Use "Download instead".' });
      },
    );
  };

  const download = () => {
    if (flow.prepared) dispatch({ type: 'downloaded', count: downloadFiles(flow.prepared.files) });
  };

  const prepared = flow.prepared;
  const canShare = prepared !== null && canShareFiles(prepared.shareFiles);
  const message = flow.message;
  const liveText = flow.phase === 'preparing' ? flow.progress : message && message.tone === 'ok' ? message.text : '';
  const downscaledNotice =
    prepared?.downscaled && flow.phase !== 'idle'
      ? `Saved at ${prepared.width} × ${prepared.height} px: your phone's graphics chip could not render the full photo size.`
      : '';

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
      {!opts.caption && <p class="export-fixed-note">A one-line "{APPROXIMATION_LINE}" note is still added.</p>}
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
          <EyeRadioGroup name="eye-export" legend="Eye" value={fields.eye} onChange={(v) => setField('eye', v)} />
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

      <div class="export-actions">
        {flow.phase === 'ready' || flow.phase === 'sharing' ? (
          <>
            <button
              type="button"
              class="btn btn-cta export-btn"
              disabled={flow.phase === 'sharing'}
              onClick={canShare ? share : download}
            >
              {primaryLabel(flow, canShare)}
            </button>
            {canShare && (
              <button
                type="button"
                class="btn btn-cta btn-secondary export-btn"
                disabled={flow.phase === 'sharing'}
                onClick={download}
              >
                Download instead
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            class="btn btn-cta export-btn"
            disabled={reason !== '' || busy}
            aria-busy={flow.phase === 'preparing'}
            onClick={prepare}
          >
            {primaryLabel(flow, canShare)}
          </button>
        )}
        {/* Always in the page, so screen readers announce progress and results as they change. */}
        <div class="export-status" role="status">
          {liveText}
        </div>
        {message?.tone === 'error' && (
          <p class="export-status export-error" role="alert">
            {message.text}
          </p>
        )}
        {reason !== '' && <p class="export-help">{reason}</p>}
        {reason === '' && flow.phase === 'idle' && plan.length > 0 && (
          <p class="export-help">
            Step 1 of 2: prepare {plan.length === 1 ? '1 file' : `${plan.length} files`}: {plan.map((p) => p.name).join(', ')}
          </p>
        )}
        {prepared && flow.phase !== 'idle' && (
          <p class="export-help" title={prepared.files.map((f) => f.name).join(', ')}>
            Ready: {prepared.files.length === 1 ? '1 file' : `${prepared.files.length} files`}.{' '}
            {canShare ? 'Tap Share to send them.' : 'Your browser cannot open a share sheet, so Download saves them.'}
          </p>
        )}
        {downscaledNotice && <p class="export-notice">{downscaledNotice}</p>}
      </div>
    </div>
  );
}
