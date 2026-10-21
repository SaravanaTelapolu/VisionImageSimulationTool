// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  INITIAL_FLOW,
  STALE_MESSAGE,
  exportFlowReducer,
  primaryLabel,
  type ExportFlow,
  type FlowAction,
} from './exportFlow';
import { canShareFiles, shareNow, type PreparedExport } from './run';

const prepared = (n = 2): PreparedExport => ({
  files: Array.from({ length: n }, (_, i) => ({ blob: new Blob(['x']), name: `f${i}.png` })),
  shareFiles: [],
  downscaled: false,
  width: 10,
  height: 10,
});

const run = (actions: FlowAction[], from: ExportFlow = INITIAL_FLOW): ExportFlow =>
  actions.reduce(exportFlowReducer, from);

describe('export flow state machine', () => {
  it('goes idle -> preparing -> ready', () => {
    const s1 = run([{ type: 'prepare' }]);
    expect(s1.phase).toBe('preparing');
    expect(primaryLabel(s1, false)).toBe('Rendering…');
    const s2 = run([{ type: 'progress', job: s1.job, text: 'Adding the caption…' }], s1);
    expect(primaryLabel(s2, false)).toBe('Adding the caption…');
    const s3 = run([{ type: 'prepared', job: s1.job, prepared: prepared() }], s2);
    expect(s3.phase).toBe('ready');
    expect(s3.prepared?.files).toHaveLength(2);
  });

  it('offers Share when the browser can share, otherwise Download', () => {
    const ready = run([{ type: 'prepare' }, { type: 'prepared', job: 1, prepared: prepared() }]);
    expect(primaryLabel(ready, true)).toBe('Share');
    expect(primaryLabel(ready, false)).toBe('Download');
    expect(primaryLabel(INITIAL_FLOW, true)).toBe('Prepare images');
  });

  it('cannot share before the images are prepared', () => {
    expect(run([{ type: 'share-start' }]).phase).toBe('idle');
    const preparing = run([{ type: 'prepare' }, { type: 'share-start' }]);
    expect(preparing.phase).toBe('preparing');
  });

  it('share keeps the files so the user can share again or download', () => {
    const ready = run([{ type: 'prepare' }, { type: 'prepared', job: 1, prepared: prepared() }]);
    const sharing = run([{ type: 'share-start' }], ready);
    expect(sharing.phase).toBe('sharing');
    expect(run([{ type: 'prepare' }], sharing).phase).toBe('sharing'); // no second run while sharing
    const done = run([{ type: 'share-done', outcome: 'shared' }], sharing);
    expect(done.phase).toBe('ready');
    expect(done.message).toEqual({ tone: 'ok', text: 'Shared' });
    expect(done.prepared).not.toBeNull();
    const cancelled = run([{ type: 'share-start' }, { type: 'share-done', outcome: 'cancelled' }], done);
    expect(cancelled.message?.text).toBe('Cancelled');
  });

  it('a failed share leaves Download instead available', () => {
    const ready = run([{ type: 'prepare' }, { type: 'prepared', job: 1, prepared: prepared() }]);
    const failed = run([{ type: 'share-start' }, { type: 'share-failed', text: 'nope' }], ready);
    expect(failed.phase).toBe('ready');
    expect(failed.message).toEqual({ tone: 'error', text: 'nope' });
    expect(failed.prepared).not.toBeNull();
    const dl = run([{ type: 'downloaded', count: 2 }], failed);
    expect(dl.message?.text).toBe('Downloaded 2 files');
  });

  it('a failed prepare returns to idle with the error', () => {
    const s = run([{ type: 'prepare' }, { type: 'prepare-failed', job: 1, text: 'boom' }]);
    expect(s.phase).toBe('idle');
    expect(s.message?.tone).toBe('error');
    expect(s.prepared).toBeNull();
  });

  it('invalidates prepared files when something changes, and ignores the abandoned run', () => {
    const ready = run([{ type: 'prepare' }, { type: 'prepared', job: 1, prepared: prepared() }]);
    const stale = run([{ type: 'invalidate' }], ready);
    expect(stale.phase).toBe('idle');
    expect(stale.prepared).toBeNull();
    expect(stale.message?.text).toBe(STALE_MESSAGE);

    const preparing = run([{ type: 'prepare' }]);
    const dropped = run([{ type: 'invalidate' }], preparing);
    expect(dropped.phase).toBe('idle');
    // The old run finishing must not resurrect it...
    expect(run([{ type: 'prepared', job: preparing.job, prepared: prepared() }], dropped).phase).toBe('idle');
    // ...even when a newer run has started.
    const again = run([{ type: 'prepare' }], dropped);
    expect(run([{ type: 'prepared', job: preparing.job, prepared: prepared() }], again).phase).toBe('preparing');
    expect(run([{ type: 'prepared', job: again.job, prepared: prepared() }], again).phase).toBe('ready');
  });

  it('invalidate does nothing to an idle or sharing flow', () => {
    expect(run([{ type: 'invalidate' }])).toEqual(INITIAL_FLOW);
    const ready = run([{ type: 'prepare' }, { type: 'prepared', job: 1, prepared: prepared() }, { type: 'share-start' }]);
    expect(run([{ type: 'invalidate' }], ready).phase).toBe('sharing');
  });
});

describe('shareNow / canShareFiles', () => {
  const file = new File(['x'], 'a.png', { type: 'image/png' });

  it('calls navigator.share synchronously, inside the tap', () => {
    const share = vi.fn(() => Promise.resolve());
    const p = shareNow([file], 'Title', { share, canShare: () => true });
    expect(share).toHaveBeenCalledTimes(1); // before any await
    expect(share).toHaveBeenCalledWith({ files: [file], title: 'Title' });
    return expect(p).resolves.toBe('shared');
  });

  it('treats a dismissed sheet as cancelled and any other error as a failure', async () => {
    const abort = Object.assign(new Error('x'), { name: 'AbortError' });
    await expect(shareNow([file], 't', { share: () => Promise.reject(abort), canShare: () => true })).resolves.toBe(
      'cancelled',
    );
    const denied = Object.assign(new Error('x'), { name: 'NotAllowedError' });
    await expect(shareNow([file], 't', { share: () => Promise.reject(denied), canShare: () => true })).rejects.toBe(
      denied,
    );
  });

  it('rejects when sharing is missing or throws synchronously', async () => {
    await expect(shareNow([file], 't', {})).rejects.toThrow();
    const share = () => {
      throw new Error('sync');
    };
    await expect(shareNow([file], 't', { share, canShare: () => true })).rejects.toThrow('sync');
  });

  it('detects file sharing support', () => {
    expect(canShareFiles([file], {})).toBe(false);
    expect(canShareFiles([file], { share: () => Promise.resolve() })).toBe(false);
    expect(canShareFiles([file], { share: () => Promise.resolve(), canShare: () => false })).toBe(false);
    expect(canShareFiles([file], { share: () => Promise.resolve(), canShare: () => true })).toBe(true);
    const throwing = () => {
      throw new Error('x');
    };
    expect(canShareFiles([file], { share: () => Promise.resolve(), canShare: throwing })).toBe(false);
  });
});
