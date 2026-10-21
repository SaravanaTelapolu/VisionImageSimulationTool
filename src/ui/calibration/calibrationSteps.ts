/** Pure step-flow logic for the calibration guide (no UI imports). */

export const STEP_COUNT = 5;

export const STEP_IDS = ['setup', 'look', 'switch', 'check', 'tips'] as const;
export type StepId = (typeof STEP_IDS)[number];

export type TestImage = 'amsler' | 'photo';

export interface CalibrationState {
  /** Zero-based index into STEP_IDS. */
  step: number;
  /** Which test target the user chose in step 1 (UI-local; the same one each time). */
  image: TestImage;
}

export type CalibrationAction =
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'goTo'; step: number }
  | { type: 'setImage'; image: TestImage }
  | { type: 'reset' };

export const initialCalibrationState: CalibrationState = { step: 0, image: 'amsler' };

function clampStep(step: number): number {
  if (!Number.isFinite(step)) return 0;
  return Math.min(STEP_COUNT - 1, Math.max(0, Math.trunc(step)));
}

export function calibrationReducer(
  state: CalibrationState,
  action: CalibrationAction,
): CalibrationState {
  switch (action.type) {
    case 'next':
      return state.step >= STEP_COUNT - 1 ? state : { ...state, step: state.step + 1 };
    case 'back':
      return state.step <= 0 ? state : { ...state, step: state.step - 1 };
    case 'goTo': {
      const step = clampStep(action.step);
      return step === state.step ? state : { ...state, step };
    }
    case 'setImage':
      return state.image === action.image ? state : { ...state, image: action.image };
    case 'reset':
      return initialCalibrationState;
  }
}

export function isFirstStep(state: CalibrationState): boolean {
  return state.step <= 0;
}

export function isLastStep(state: CalibrationState): boolean {
  return state.step >= STEP_COUNT - 1;
}

export function stepId(state: CalibrationState): StepId {
  return STEP_IDS[clampStep(state.step)] ?? 'setup';
}
