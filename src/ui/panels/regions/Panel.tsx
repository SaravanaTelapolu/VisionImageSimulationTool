import { useEffect, useRef, useState } from 'preact/hooks';
import { defaultEllipse, newRegion } from '../../../model/defaults';
import { addRegion, duplicateRegion, moveRegion, removeRegion, setRegionVisible, updateRegion } from '../../../model/ops';
import type { Region } from '../../../model/types';
import { startPlacing } from '../../../state/edit';
import { activeTab, applyEdit, image, profile, selectedRegionId } from '../../../state/store';
import { addBrushRegion, BrushToolbar } from '../../edit/brush';
import { PathToolbar } from '../../edit/freehand';
import { cleanRegionName, nextRegionName, selectionAfterDelete, shapeLabel } from './helpers';
import { CopyIcon, DownIcon, EyeIcon, EyeOffIcon, PencilIcon, TrashIcon, UpIcon } from './icons';
import './regions.css';

const LONG_PRESS_MS = 550;

function addEllipse(): void {
  // With a photo loaded the user taps where the spot is; otherwise it lands on the fixation point.
  if (image.value) {
    startPlacing('ellipse');
    return;
  }
  const region = newRegion(defaultEllipse(), nextRegionName(profile.value, 'ellipse'));
  applyEdit((p) => addRegion(p, region));
  selectedRegionId.value = region.id;
}

function addWholeImage(): void {
  const region = newRegion({ type: 'full' }, nextRegionName(profile.value, 'full'));
  applyEdit((p) => addRegion(p, region));
  selectedRegionId.value = region.id;
}

function duplicate(id: string): void {
  const { profile: next, newId } = duplicateRegion(profile.value, id);
  if (!newId) return;
  applyEdit(() => next);
  selectedRegionId.value = newId;
}

function remove(id: string): void {
  const nextSelection = selectionAfterDelete(profile.value, id);
  applyEdit((p) => removeRegion(p, id));
  if (selectedRegionId.value === id) selectedRegionId.value = nextSelection;
}

function RegionRow({ region, index, count }: { region: Region; index: number; count: number }) {
  const selected = selectedRegionId.value === region.id;
  const [editing, setEditing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);
  const cancelled = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      cancelled.current = false;
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const startRename = () => {
    selectedRegionId.value = region.id;
    setEditing(true);
  };

  const commitRename = (raw: string) => {
    setEditing(false);
    // "cancelled" doubles as "already finished": Enter then the unmount blur must not commit twice.
    if (cancelled.current) return;
    cancelled.current = true;
    const name = cleanRegionName(raw);
    if (name && name !== region.name) applyEdit((p) => updateRegion(p, region.id, { name }));
  };

  const clearTimer = () => window.clearTimeout(timer.current);

  return (
    <li class="rg-item" data-selected={selected ? 'true' : undefined} data-hidden={region.visible ? undefined : 'true'}>
      <div class="rg-line">
        {editing ? (
          <input
            ref={inputRef}
            class="rg-rename"
            type="text"
            aria-label={`Rename ${region.name}`}
            defaultValue={region.name}
            maxLength={60}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename((e.currentTarget as HTMLInputElement).value);
              } else if (e.key === 'Escape') {
                cancelled.current = true;
                setEditing(false);
              }
            }}
            onBlur={(e) => commitRename((e.currentTarget as HTMLInputElement).value)}
          />
        ) : (
          <button
            type="button"
            class="rg-select"
            aria-pressed={selected}
            onClick={() => {
              if (longPressed.current) {
                longPressed.current = false;
                return;
              }
              selectedRegionId.value = region.id;
            }}
            onPointerDown={() => {
              longPressed.current = false;
              clearTimer();
              timer.current = window.setTimeout(() => {
                longPressed.current = true;
                startRename();
              }, LONG_PRESS_MS);
            }}
            onPointerUp={clearTimer}
            onPointerLeave={clearTimer}
            onPointerCancel={clearTimer}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span class="rg-name">{region.name}</span>
            <span class="rg-kind">{shapeLabel(region.shape.type)}</span>
          </button>
        )}
        <button type="button" class="iconbtn" aria-label={`Rename ${region.name}`} title="Rename" onClick={startRename}>
          <PencilIcon />
        </button>
        <button
          type="button"
          class="iconbtn"
          aria-pressed={region.visible}
          aria-label={region.visible ? `Hide ${region.name}` : `Show ${region.name}`}
          title={region.visible ? 'Visible' : 'Hidden'}
          onClick={() => applyEdit((p) => setRegionVisible(p, region.id, !region.visible))}
        >
          {region.visible ? <EyeIcon /> : <EyeOffIcon />}
        </button>
      </div>
      <div class="rg-line rg-actions">
        <button type="button" class="iconbtn" aria-label={`Duplicate ${region.name}`} title="Duplicate" onClick={() => duplicate(region.id)}>
          <CopyIcon />
        </button>
        <button
          type="button"
          class="iconbtn"
          aria-label={`Move ${region.name} up`}
          title="Move up"
          disabled={index === 0}
          onClick={() => applyEdit((p) => moveRegion(p, region.id, index - 1))}
        >
          <UpIcon />
        </button>
        <button
          type="button"
          class="iconbtn"
          aria-label={`Move ${region.name} down`}
          title="Move down"
          disabled={index === count - 1}
          onClick={() => applyEdit((p) => moveRegion(p, region.id, index + 1))}
        >
          <DownIcon />
        </button>
        <button type="button" class="iconbtn rg-delete" aria-label={`Delete ${region.name}`} title="Delete" onClick={() => remove(region.id)}>
          <TrashIcon />
        </button>
        {selected && (
          <button type="button" class="btn rg-effects" onClick={() => (activeTab.value = 'effects')}>
            Edit effects →
          </button>
        )}
      </div>
    </li>
  );
}

export function RegionsPanel() {
  const regions = profile.value.regions;
  const selectedShape = regions.find((r) => r.id === selectedRegionId.value)?.shape.type;
  return (
    <div class="rg-panel">
      <div class="rg-add" role="group" aria-label="Add a region">
        <button type="button" class="btn" onClick={addEllipse}>
          + Spot (ellipse)
        </button>
        <button type="button" class="btn" onClick={addWholeImage}>
          + Whole image
        </button>
        <button
          type="button"
          class="btn"
          disabled={!image.value}
          title={image.value ? undefined : 'Open a photo first'}
          onClick={() => startPlacing('path')}
        >
          Freehand
        </button>
        <button
          type="button"
          class="btn"
          disabled={!image.value}
          title={image.value ? undefined : 'Open a photo first'}
          onClick={() => addBrushRegion()}
        >
          Brush
        </button>
      </div>

      {selectedShape === 'path' && selectedRegionId.value && <PathToolbar regionId={selectedRegionId.value} />}
      {selectedShape === 'mask' && <BrushToolbar />}

      {regions.length === 0 ? (
        <p class="rg-empty">
          Add a spot where your vision is affected. Positions follow the crosshair (your fixation point).
        </p>
      ) : (
        <ul class="rg-list" aria-label="Regions">
          {regions.map((r, i) => (
            <RegionRow key={r.id} region={r} index={i} count={regions.length} />
          ))}
        </ul>
      )}
    </div>
  );
}
