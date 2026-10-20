// Typed storage errors the UI can show ("Saving is unavailable in private browsing", etc.).

export type StorageFailureReason = 'unavailable' | 'quota' | 'failed';

/**
 * Thrown when IndexedDB cannot be used: missing (some private modes), blocked, out of space, or
 * any other low-level failure. `reason` lets the UI pick a message; `message` is already friendly.
 */
export class StorageUnavailableError extends Error {
  readonly reason: StorageFailureReason;

  constructor(reason: StorageFailureReason = 'unavailable', cause?: unknown) {
    super(messageFor(reason));
    this.name = 'StorageUnavailableError';
    this.reason = reason;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

function messageFor(reason: StorageFailureReason): string {
  switch (reason) {
    case 'quota':
      return 'This device has run out of storage space, so nothing more can be saved. Free some space or export your profiles to a file.';
    case 'failed':
      return 'Saving on this device failed unexpectedly. Your work on screen is unaffected; try again or export it to a file.';
    default:
      return 'Saving on this device is not available here (for example in private browsing). You can still export profiles to a file.';
  }
}

/** Thrown by operations that need an existing profile (for example duplicateAsCheckup). */
export class ProfileNotFoundError extends Error {
  readonly profileId: string;

  constructor(profileId: string) {
    super(`No saved profile with id "${profileId}".`);
    this.name = 'ProfileNotFoundError';
    this.profileId = profileId;
  }
}

/** Converts anything thrown by IndexedDB into a StorageUnavailableError. */
export function toStorageError(e: unknown): StorageUnavailableError {
  if (e instanceof StorageUnavailableError) return e;
  const name = typeof e === 'object' && e !== null ? (e as { name?: unknown }).name : undefined;
  if (name === 'QuotaExceededError') return new StorageUnavailableError('quota', e);
  if (name === 'SecurityError' || name === 'InvalidStateError' || name === 'NotSupportedError') {
    return new StorageUnavailableError('unavailable', e);
  }
  return new StorageUnavailableError('failed', e);
}
