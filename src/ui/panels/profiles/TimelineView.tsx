import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { testImages, rasterizeTestImage, type TestImage } from '../../../assets/testImages';
import { APPROXIMATION_LINE, wrapText } from '../../../export/caption';
import { shareOrDownload } from '../../../export/share';
import type { Profile } from '../../../model/types';
import {
  defaultTimelineSelection,
  formatProfileDate,
  layoutTimelineExport,
  selectTimelineProfiles,
  timelineFileName,
  toggleId,
} from './helpers';
import './profiles.css';

/** The picture every selected profile is applied to. */
export interface TimelineSource {
  image: CanvasImageSource;
  width: number;
  height: number;
  label: string;
}

export type RenderedImage = HTMLCanvasElement | ImageBitmap | Blob;

export interface TimelineViewProps {
  /** Saved profiles to choose from (full profiles, any order). */
  profiles: Profile[];
  /** The current photo; a built-in test image can be chosen instead. */
  source: TimelineSource;
  /**
   * Applies a profile to a source and returns the simulated picture. It may reuse one canvas for every
   * call: the result is copied straight away. Calls are made one at a time.
   */
  renderWithProfile: (profile: Profile, source: TimelineSource) => Promise<RenderedImage>;
  onClose: () => void;
}

interface Tile {
  canvas?: HTMLCanvasElement;
  url?: string;
  error?: string;
}

const CURRENT = 'current';
const DEFAULT_TEST_IMAGE = 'amsler';
const MAX_RASTER_SIDE = 1536;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Copies whatever the renderer returned into a canvas of our own. */
async function toOwnCanvas(r: RenderedImage): Promise<HTMLCanvasElement> {
  const bitmap = r instanceof Blob ? await createImageBitmap(r) : null;
  const src: CanvasImageSource = bitmap ?? (r as HTMLCanvasElement | ImageBitmap);
  const w = bitmap?.width ?? (r as HTMLCanvasElement).width;
  const h = bitmap?.height ?? (r as HTMLCanvasElement).height;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.drawImage(src, 0, 0);
  bitmap?.close();
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make a PNG'))), 'image/png');
  });
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/** Draws the chosen pictures in one row with date captions and the approximation note. */
export function composeTimelineImage(
  entries: { profile: Profile; canvas: HTMLCanvasElement }[],
  sourceLabel: string,
): HTMLCanvasElement {
  const first = entries[0];
  if (!first) throw new Error('Nothing to save');
  const L = layoutTimelineExport({
    count: entries.length,
    imageWidth: first.canvas.width,
    imageHeight: first.canvas.height,
  });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');

  // Measure the footer first so the canvas can be sized.
  ctx.font = `${L.fontPx}px ${FONT}`;
  const footer = wrapText(APPROXIMATION_LINE, L.width - 2 * L.pad, (s) => ctx.measureText(s).width);
  const lineH = Math.round(L.fontPx * 1.4);
  canvas.width = L.width;
  canvas.height = L.bodyHeight + footer.length * lineH + L.pad;

  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${L.fontPx}px ${FONT}`;
  ctx.fillText(fitText(ctx, `Eye map timeline · ${sourceLabel}`, L.width - 2 * L.pad), L.pad, L.pad + L.fontPx);

  entries.forEach((e, k) => {
    const pos = L.tiles[k];
    if (!pos) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#000000';
    ctx.fillRect(pos.x, pos.y, L.tileWidth, L.tileHeight);
    ctx.drawImage(e.canvas, pos.x, pos.y, L.tileWidth, L.tileHeight);
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${L.fontPx}px ${FONT}`;
    const date = formatProfileDate(e.profile.createdAt);
    ctx.fillText(date, pos.x, pos.y + L.tileHeight + Math.round(L.fontPx * 1.3));
    ctx.fillStyle = '#c4c4d0';
    ctx.font = `${L.fontPx}px ${FONT}`;
    ctx.fillText(
      fitText(ctx, e.profile.name, L.tileWidth),
      pos.x,
      pos.y + L.tileHeight + Math.round(L.fontPx * 2.6),
    );
  });

  ctx.fillStyle = '#c4c4d0';
  ctx.font = `${L.fontPx}px ${FONT}`;
  footer.forEach((line, i) => ctx.fillText(line, L.pad, L.bodyHeight + L.fontPx + i * lineH));
  return canvas;
}

/** Full-screen side-by-side view of the same picture seen with several dated profiles. */
export function TimelineView({ profiles, source, renderWithProfile, onClose }: TimelineViewProps) {
  const [selected, setSelected] = useState<string[]>(() => defaultTimelineSelection(profiles));
  const [sourceId, setSourceId] = useState<string>(DEFAULT_TEST_IMAGE);
  const [tick, setTick] = useState(0);
  const [sourceError, setSourceError] = useState('');
  const [large, setLarge] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const cache = useRef(new Map<string, Tile>());
  const rasters = useRef(new Map<string, TimelineSource>());
  const closeBtn = useRef<HTMLButtonElement>(null);

  const shown = useMemo(() => selectTimelineProfiles(profiles, selected), [profiles, selected]);
  const testImage: TestImage | undefined = testImages.find((t) => t.id === sourceId);
  const sourceLabel = sourceId === CURRENT ? source.label : (testImage?.name ?? source.label);
  const sourceKey = `${sourceId}|${sourceId === CURRENT ? source.label : ''}`;

  // Pictures made for a different source are stale.
  const lastSource = useRef<{ key: string; image: CanvasImageSource } | null>(null);
  useEffect(() => {
    const last = lastSource.current;
    if (last && (last.key !== sourceKey || (sourceId === CURRENT && last.image !== source.image))) clearCache();
    lastSource.current = { key: sourceKey, image: source.image };
  }, [sourceKey, source.image]);

  function clearCache(): void {
    for (const t of cache.current.values()) if (t.url) URL.revokeObjectURL(t.url);
    cache.current.clear();
  }

  useEffect(() => () => clearCache(), []);

  // Render each shown profile once per (source, profile version), one after another.
  const shownKey = shown.map((p) => `${p.id}@${p.updatedAt}`).join(',');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setSourceError('');
      let src: TimelineSource;
      try {
        if (sourceId === CURRENT) src = source;
        else {
          const cached = rasters.current.get(sourceId);
          if (cached) src = cached;
          else {
            if (!testImage) throw new Error('Unknown test image');
            const c = await rasterizeTestImage(testImage, MAX_RASTER_SIDE);
            src = { image: c, width: c.width, height: c.height, label: testImage.name };
            rasters.current.set(sourceId, src);
          }
        }
      } catch {
        if (!cancelled) setSourceError('Could not prepare that picture.');
        return;
      }
      for (const p of shown) {
        if (cancelled) return;
        const key = `${sourceKey}|${p.id}|${p.updatedAt}`;
        if (cache.current.has(key)) continue;
        let tile: Tile;
        try {
          const canvas = await toOwnCanvas(await renderWithProfile(p, src));
          const url = URL.createObjectURL(await canvasToBlob(canvas));
          tile = { canvas, url };
        } catch {
          tile = { error: 'Could not draw this one.' };
        }
        if (cancelled) {
          if (tile.url) URL.revokeObjectURL(tile.url);
          return;
        }
        cache.current.set(key, tile);
        setTick((t) => t + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceId, sourceKey, shownKey, source, renderWithProfile]);

  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (large) setLarge(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [large, onClose]);

  const tileFor = (p: Profile): Tile | undefined => cache.current.get(`${sourceKey}|${p.id}|${p.updatedAt}`);
  void tick; // re-render when a picture finishes

  const ready = shown.filter((p) => tileFor(p)?.canvas);
  const sorted = [...profiles].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const largeProfile = shown.find((p) => p.id === large);
  const largeTile = largeProfile ? tileFor(largeProfile) : undefined;
  const aspect = `${source.width || 1} / ${source.height || 1}`;

  const saveAsImage = async () => {
    const entries = ready.map((p) => ({ profile: p, canvas: tileFor(p)!.canvas! }));
    if (entries.length === 0) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const blob = await canvasToBlob(composeTimelineImage(entries, sourceLabel));
      const r = await shareOrDownload([{ blob, name: timelineFileName(new Date()) }], 'Eye map timeline');
      setSaveMsg(r === 'shared' ? 'Shared.' : r === 'downloaded' ? 'Image downloaded.' : '');
    } catch {
      setSaveMsg('Could not make the image.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="tl" role="dialog" aria-modal="true" aria-label="Timeline">
      <header class="tl-top">
        <button ref={closeBtn} type="button" class="pf-btn" onClick={onClose}>
          Close
        </button>
        <h2 class="tl-title">Timeline</h2>
        <button type="button" class="pf-btn pf-btn-primary" disabled={saving || ready.length === 0} onClick={() => void saveAsImage()}>
          Save as image
        </button>
      </header>

      <details class="tl-controls">
        <summary>
          {shown.length} of {profiles.length} profiles · {sourceLabel}
        </summary>
        <div class="tl-controls-body">
          <label class="pf-label" for="tl-source">
            Picture
          </label>
          <select id="tl-source" class="pf-input" value={sourceId} onChange={(e) => setSourceId((e.currentTarget as HTMLSelectElement).value)}>
            {testImages.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.id === DEFAULT_TEST_IMAGE ? ' (default)' : ''}
              </option>
            ))}
            <option value={CURRENT}>Current photo: {source.label}</option>
          </select>
          <fieldset class="tl-profiles">
            <legend class="pf-label">Profiles to include</legend>
            {sorted.length === 0 && <p class="pf-hint">No saved profiles yet.</p>}
            {sorted.map((p) => (
              <label key={p.id} class="tl-check">
                <input
                  type="checkbox"
                  checked={selected.includes(p.id)}
                  onChange={() => setSelected((s) => toggleId(s, p.id))}
                />
                <span>
                  {p.name} <span class="pf-meta">· {formatProfileDate(p.createdAt)}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </div>
      </details>

      {sourceError && (
        <p class="pf-msg pf-msg-error" role="alert">
          {sourceError}
        </p>
      )}
      {saveMsg && (
        <p class="pf-msg" role="status">
          {saveMsg}
        </p>
      )}

      {shown.length === 0 ? (
        <p class="pf-hint tl-empty">Choose at least one saved profile to see it here.</p>
      ) : (
        <ol class="tl-stage">
          {shown.map((p) => {
            const t = tileFor(p);
            return (
              <li key={p.id} class="tl-tile">
                <button
                  type="button"
                  class="tl-pic"
                  style={{ aspectRatio: aspect }}
                  disabled={!t?.url}
                  aria-label={`Show ${p.name}, ${formatProfileDate(p.createdAt)}, large`}
                  onClick={() => setLarge(p.id)}
                >
                  {t?.url ? (
                    <img src={t.url} alt={`${sourceLabel} as seen with ${p.name}`} draggable={false} />
                  ) : (
                    <span class="tl-wait">{t?.error ?? 'Drawing…'}</span>
                  )}
                </button>
                <p class="tl-caption">
                  <strong>{formatProfileDate(p.createdAt)}</strong>
                  <span>{p.name}</span>
                </p>
              </li>
            );
          })}
        </ol>
      )}
      <p class="tl-note">{APPROXIMATION_LINE}</p>

      {largeProfile && largeTile?.url && (
        <div class="tl-large" role="dialog" aria-modal="true" aria-label={`${largeProfile.name} large`} onClick={() => setLarge(null)}>
          <img src={largeTile.url} alt={`${sourceLabel} as seen with ${largeProfile.name}`} />
          <p class="tl-caption">
            <strong>{formatProfileDate(largeProfile.createdAt)}</strong>
            <span>{largeProfile.name}</span>
          </p>
          <button type="button" class="pf-btn" onClick={() => setLarge(null)}>
            Back to timeline
          </button>
        </div>
      )}
    </div>
  );
}
