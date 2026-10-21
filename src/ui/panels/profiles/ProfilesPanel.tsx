import { useEffect, useRef, useState } from 'preact/hooks';
import {
  busy,
  currentIsSaved,
  currentPhotoSaved,
  deleteProfileById,
  dirty,
  duplicateCurrentAsCheckup,
  duplicateProfileById,
  exportAllJson,
  exportCurrentJson,
  exportProfileById,
  importJsonFile,
  newProfile,
  notice,
  openProfile,
  persistentStorage,
  profileList,
  refreshList,
  renameCurrent,
  saveCurrent,
  savePhotoWithCurrent,
  storageError,
} from '../../../state/profiles';
import { image, profile } from '../../../state/store';
import { formatProfileDate, notePreview, regionCountLabel } from './helpers';
import './profiles.css';

export interface ProfilesPanelProps {
  /** When given, a "Compare over time" button appears (needs two or more saved profiles). */
  onOpenTimeline?: () => void;
}

type Pending = { kind: 'delete' | 'open' | 'new'; id: string } | null;

const CONFIRM_MS = 5000;

const eyeLabel = (eye: string): string => (eye === 'left' ? 'Left eye' : 'Right eye');

/** One-line note on how safe the saved profiles are, from the browser's persistent-storage answer. */
export function storageHintText(persistent: boolean | null): string {
  if (persistent === true) return 'Saved on this device (protected from automatic clearing).';
  if (persistent === false) {
    return 'Saved on this device only. The browser may clear it if storage runs low — use Export all to keep a backup.';
  }
  return '';
}

/** Saved eye maps: save, open, duplicate as a check-up, export, import, delete. */
export function ProfilesPanel({ onOpenTimeline }: ProfilesPanelProps) {
  const [pending, setPending] = useState<Pending>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    void refreshList();
    return () => window.clearTimeout(timer.current);
  }, []);

  const arm = (p: Exclude<Pending, null>) => {
    setPending(p);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPending(null), CONFIRM_MS);
  };
  const disarm = () => {
    window.clearTimeout(timer.current);
    setPending(null);
  };
  const isPending = (kind: 'delete' | 'open' | 'new', id: string) => pending?.kind === kind && pending.id === id;

  const cur = profile.value;
  const isDirty = dirty.value;
  const saved = currentIsSaved.value;
  const working = busy.value;
  const list = profileList.value;
  const error = storageError.value;
  const message = notice.value;
  const canSavePhoto = image.value?.original != null;
  const storageHint = storageHintText(persistentStorage.value);

  const onNew = () => {
    if (isDirty && !isPending('new', '')) return arm({ kind: 'new', id: '' });
    disarm();
    newProfile();
  };

  const onOpen = (id: string) => {
    if (isDirty && !isPending('open', id)) return arm({ kind: 'open', id });
    disarm();
    void openProfile(id);
  };

  const onDelete = (id: string) => {
    if (!isPending('delete', id)) return arm({ kind: 'delete', id });
    disarm();
    void deleteProfileById(id);
  };

  const onImport = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await importJsonFile(file);
  };

  const commitName = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    if (!renameCurrent(input.value)) input.value = cur.name;
  };

  return (
    <div class="pf">
      {error && (
        <p class="pf-msg pf-msg-error" role="alert">
          {error}
        </p>
      )}
      {!error && message && (
        <p class="pf-msg" role="status">
          {message}
        </p>
      )}

      <section class="pf-card" aria-label="Current profile">
        <div class="pf-card-head">
          <label class="pf-label" for="pf-name">
            Profile name
          </label>
          {isDirty ? (
            <span class="pf-state" role="status">
              <span class="pf-dot" aria-hidden="true" /> Unsaved changes
            </span>
          ) : (
            <span class="pf-state pf-state-ok">{saved ? 'Saved' : 'Not saved yet'}</span>
          )}
        </div>
        <input
          id="pf-name"
          key={`${cur.id}|${cur.name}`}
          class="pf-input"
          type="text"
          defaultValue={cur.name}
          maxLength={80}
          autoComplete="off"
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
          }}
        />
        <p class="pf-meta">
          {eyeLabel(cur.eye)} · created {formatProfileDate(cur.createdAt)} · {regionCountLabel(cur.regions.length)}
        </p>
        <div class="pf-row">
          <button type="button" class="pf-btn pf-btn-primary" disabled={working} onClick={() => void saveCurrent()}>
            {isDirty || !saved ? 'Save' : 'Saved'}
          </button>
          <button type="button" class="pf-btn" disabled={working} onClick={() => void duplicateCurrentAsCheckup()}>
            New check-up (duplicate)
          </button>
          <button
            type="button"
            class={`pf-btn${isPending('new', '') ? ' pf-btn-danger' : ''}`}
            disabled={working}
            onClick={onNew}
          >
            {isPending('new', '') ? 'Tap again to discard changes' : 'New profile'}
          </button>
        </div>
        <div class="pf-row">
          <button type="button" class="pf-btn" disabled={working} onClick={() => void exportCurrentJson()}>
            Export this profile
          </button>
          <button
            type="button"
            class="pf-btn"
            disabled={working || !canSavePhoto}
            onClick={() => void savePhotoWithCurrent()}
          >
            {currentPhotoSaved.value ? 'Update saved photo' : 'Save photo with this profile'}
          </button>
        </div>
        {!canSavePhoto && <p class="pf-hint">Photos are only kept if you choose to. Open a photo from a file to save it here.</p>}
      </section>

      <section aria-label="Saved profiles">
        <div class="pf-list-head">
          <h2 class="pf-h">Saved profiles ({list.length})</h2>
          {onOpenTimeline && (
            <button type="button" class="pf-btn" disabled={list.length < 2} onClick={onOpenTimeline}>
              Compare over time
            </button>
          )}
        </div>
        {list.length === 0 ? (
          <p class="pf-hint">
            {error ? 'Saved profiles cannot be shown right now.' : 'Nothing saved yet. Tap Save to keep this eye map on this device.'}
          </p>
        ) : (
          <ul class="pf-list">
            {list.map((s) => {
              const isCurrent = s.id === cur.id;
              const preview = notePreview(s.note);
              return (
                <li key={s.id} class="pf-item" data-current={isCurrent ? 'true' : undefined}>
                  <div class="pf-item-title">
                    <strong>{s.name}</strong>
                    {isCurrent && <span class="pf-tag">Open now</span>}
                  </div>
                  <p class="pf-meta">
                    {formatProfileDate(s.createdAt)} · {eyeLabel(s.eye)} · {regionCountLabel(s.regionCount)}
                  </p>
                  {preview && <p class="pf-note">{preview}</p>}
                  <div class="pf-row">
                    <button
                      type="button"
                      class={`pf-btn${isPending('open', s.id) ? ' pf-btn-danger' : ''}`}
                      disabled={working}
                      onClick={() => onOpen(s.id)}
                    >
                      {isPending('open', s.id) ? 'Discard changes and open' : 'Open'}
                    </button>
                    <button type="button" class="pf-btn" disabled={working} onClick={() => void duplicateProfileById(s.id)}>
                      Duplicate
                    </button>
                    <button type="button" class="pf-btn" disabled={working} onClick={() => void exportProfileById(s.id)}>
                      Export
                    </button>
                    <button
                      type="button"
                      class={`pf-btn pf-btn-quiet${isPending('delete', s.id) ? ' pf-btn-danger' : ''}`}
                      disabled={working}
                      aria-label={isPending('delete', s.id) ? `Confirm delete ${s.name}` : `Delete ${s.name}`}
                      onClick={() => onDelete(s.id)}
                    >
                      {isPending('delete', s.id) ? 'Tap again to delete for good' : 'Delete'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section class="pf-row pf-transfer" aria-label="Import and export">
        <label class="pf-btn pf-file">
          Import JSON
          <input type="file" accept="application/json,.json" onChange={(e) => void onImport(e)} />
        </label>
        <button
          type="button"
          class="pf-btn"
          disabled={working || list.length === 0}
          onClick={() => void exportAllJson()}
        >
          Export all
        </button>
      </section>
      {storageHint && (
        <p class="pf-hint pf-storage-hint" data-persistent={persistentStorage.value ? 'true' : 'false'}>
          {storageHint}
        </p>
      )}
      <p class="pf-hint">My own approximation, not a clinical measurement. Profiles stay on this device unless you export them.</p>
    </div>
  );
}
