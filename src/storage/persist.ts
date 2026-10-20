// Asks the browser not to evict this origin's storage under pressure.

/** Returns true when storage is (now) persistent; false when refused, unsupported or on any error. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    if (!storage || typeof storage.persist !== 'function') return false;
    return (await storage.persist()) === true;
  } catch {
    return false;
  }
}
