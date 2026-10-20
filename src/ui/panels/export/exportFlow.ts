// The Export panel's two-step flow as a small state machine, kept free of the DOM so it can be tested.
//
//   idle --prepare--> preparing --prepared--> ready --share / download--> ready (with a message)
//
// "Prepare images" renders the files. Only then do "Share" and "Download instead" appear, so
// navigator.share can run straight from a fresh tap (Android refuses it after a long wait).
import type { PreparedExport } from './run';
import { resultMessage } from './options';

export type FlowPhase = 'idle' | 'preparing' | 'ready' | 'sharing';

export interface FlowMessage {
  tone: 'ok' | 'error';
  text: string;
}

export interface ExportFlow {
  phase: FlowPhase;
  /** Plain-language step while preparing ("Rendering…"). */
  progress: string;
  /** Counts prepare runs, so the result of an abandoned run is ignored. */
  job: number;
  prepared: PreparedExport | null;
  message: FlowMessage | null;
}

export const INITIAL_FLOW: ExportFlow = { phase: 'idle', progress: '', job: 0, prepared: null, message: null };

export type FlowAction =
  | { type: 'prepare' }
  | { type: 'progress'; job: number; text: string }
  | { type: 'prepared'; job: number; prepared: PreparedExport }
  | { type: 'prepare-failed'; job: number; text: string }
  | { type: 'share-start' }
  | { type: 'share-done'; outcome: 'shared' | 'cancelled' }
  | { type: 'share-failed'; text: string }
  | { type: 'downloaded'; count: number }
  /** The options, caption, photo or simulation changed: the prepared files are out of date. */
  | { type: 'invalidate' };

export const STALE_MESSAGE = 'Something changed, so the images need to be prepared again.';

export function exportFlowReducer(state: ExportFlow, action: FlowAction): ExportFlow {
  switch (action.type) {
    case 'prepare':
      if (state.phase === 'preparing' || state.phase === 'sharing') return state;
      return { phase: 'preparing', progress: 'Rendering…', job: state.job + 1, prepared: null, message: null };
    case 'progress':
      return state.phase === 'preparing' && action.job === state.job ? { ...state, progress: action.text } : state;
    case 'prepared':
      if (state.phase !== 'preparing' || action.job !== state.job) return state;
      return { ...state, phase: 'ready', progress: '', prepared: action.prepared, message: null };
    case 'prepare-failed':
      if (state.phase !== 'preparing' || action.job !== state.job) return state;
      return { ...state, phase: 'idle', progress: '', message: { tone: 'error', text: action.text } };
    case 'share-start':
      return state.phase === 'ready' && state.prepared ? { ...state, phase: 'sharing', message: null } : state;
    case 'share-done':
      if (state.phase !== 'sharing') return state;
      return {
        ...state,
        phase: 'ready',
        message: { tone: 'ok', text: resultMessage(action.outcome, state.prepared?.files.length ?? 0) },
      };
    case 'share-failed':
      if (state.phase !== 'sharing') return state;
      return { ...state, phase: 'ready', message: { tone: 'error', text: action.text } };
    case 'downloaded':
      if (state.phase !== 'ready') return state;
      return { ...state, message: { tone: 'ok', text: resultMessage('downloaded', action.count) } };
    case 'invalidate':
      // While preparing, drop the run (its result will be ignored); while sharing the sheet is open
      // already, so leave it be.
      if (state.phase === 'ready') return { ...INITIAL_FLOW, job: state.job, message: { tone: 'ok', text: STALE_MESSAGE } };
      if (state.phase === 'preparing') return { ...INITIAL_FLOW, job: state.job };
      return state;
  }
}

/** Label of the main button for the current phase. */
export function primaryLabel(state: ExportFlow, canShare: boolean): string {
  switch (state.phase) {
    case 'idle':
      return 'Prepare images';
    case 'preparing':
      return state.progress || 'Rendering…';
    case 'sharing':
      return 'Sharing…';
    case 'ready':
      return canShare ? 'Share' : 'Download';
  }
}
