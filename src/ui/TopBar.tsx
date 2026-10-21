import { useEffect, useRef, useState } from 'preact/hooks';
import {
  UI_TEXT_SCALE_MAX,
  UI_TEXT_SCALE_MIN,
  canRedo,
  canUndo,
  flipView,
  profile,
  redo,
  setUiTextScale,
  uiTextScale,
  undo,
  viewMode,
} from '../state/store';
import { openCalibration } from '../state/ui';
import { MORE_BUTTON_ID } from './dialogFocus';
import { FlipIcon, MoreIcon, RedoIcon, UndoIcon } from './icons';
import { PhotoPicker, TestImagePicker } from './PhotoPicker';
import { PerformanceLine } from './preview/PreviewNotice';

const TEXT_STEP = 0.1;

/** The step-by-step help page (public/help.html). Opened in a new tab so unsaved edits stay. */
export const HELP_URL = 'help.html';


function MoreMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      document.getElementById(MORE_BUTTON_ID)?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const scale = uiTextScale.value;
  return (
    <div class="menu-root" ref={rootRef}>
      <button
        type="button"
        id={MORE_BUTTON_ID}
        class="iconbtn"
        aria-label="More options"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreIcon />
      </button>
      {open && (
        <div class="menu" role="group" aria-label="More options">
          <span class="menu-label" id="text-size-label">
            Text size
          </span>
          <div class="menu-row" aria-labelledby="text-size-label">
            <button
              type="button"
              class="iconbtn iconbtn-solid"
              aria-label="Smaller text"
              disabled={scale <= UI_TEXT_SCALE_MIN}
              onClick={() => setUiTextScale(scale - TEXT_STEP)}
            >
              <span aria-hidden="true">A−</span>
            </button>
            <output class="menu-value" aria-live="polite">
              {Math.round(scale * 100)}%
            </output>
            <button
              type="button"
              class="iconbtn iconbtn-solid"
              aria-label="Larger text"
              disabled={scale >= UI_TEXT_SCALE_MAX}
              onClick={() => setUiTextScale(scale + TEXT_STEP)}
            >
              <span aria-hidden="true">A+</span>
            </button>
          </div>
          <div class="menu-sep" />
          <TestImagePicker variant="menu" onPicked={() => setOpen(false)} />
          <button
            type="button"
            class="menu-item"
            onClick={() => {
              setOpen(false);
              openCalibration();
            }}
          >
            Calibration guide
          </button>
          <a class="menu-item" href={HELP_URL} target="_blank" rel="noopener" onClick={() => setOpen(false)}>
            Help and how-to
          </a>
          <div class="menu-sep" />
          <PerformanceLine />
        </div>
      )}
    </div>
  );
}

/** Undo, redo and flip. Shown at the bottom of the image area so a thumb can reach them. */
export function QuickBar() {
  const original = viewMode.value === 'original';
  return (
    <div class="quickbar" role="toolbar" aria-label="Quick actions">
      <button type="button" class="iconbtn" aria-label="Undo" disabled={!canUndo.value} onClick={undo}>
        <UndoIcon />
      </button>
      <button type="button" class="iconbtn" aria-label="Redo" disabled={!canRedo.value} onClick={redo}>
        <RedoIcon />
      </button>
      <button
        type="button"
        class="iconbtn"
        aria-label={original ? 'Showing original. Tap to show simulated' : 'Showing simulated. Tap to show original'}
        aria-pressed={original}
        title={original ? 'Original' : 'Simulated'}
        onClick={flipView}
      >
        <FlipIcon />
      </button>
    </div>
  );
}

export function TopBar() {
  return (
    <header class="topbar">
      <div class="title-block">
        <span class="app-name">Vision Simulator</span>
        <h1 class="title">{profile.value.name}</h1>
      </div>
      <PhotoPicker kind="photo" variant="icon" />
      <PhotoPicker kind="camera" variant="icon" />
      <MoreMenu />
    </header>
  );
}
