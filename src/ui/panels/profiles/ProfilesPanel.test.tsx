// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetProfilesStateForTests, profileList, saveCurrent } from '../../../state/profiles';
import { applyEdit, profile, resetProfile } from '../../../state/store';
import { defaultEllipse, newRegion } from '../../../model/defaults';
import { _resetForTests } from '../../../storage/db';
import { ProfilesPanel } from './ProfilesPanel';

let host: HTMLDivElement;

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 150)));
const button = (text: string): HTMLButtonElement => {
  const b = [...host.querySelectorAll('button')].find((x) => x.textContent?.includes(text));
  if (!b) throw new Error(`no button "${text}"`);
  return b;
};

beforeEach(async () => {
  await _resetForTests();
  resetProfile();
  _resetProfilesStateForTests();
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

describe('ProfilesPanel', () => {
  it('saves the current profile, lists it, and deletes only on the second tap', async () => {
    act(() => render(<ProfilesPanel />, host));
    await flush();
    expect(host.textContent).toContain('Not saved yet');

    act(() => applyEdit((p) => ({ ...p, regions: [newRegion(defaultEllipse(), 'Spot')] })));
    expect(host.textContent).toContain('Unsaved changes');

    act(() => button('Save').click());
    await flush();
    expect(host.textContent).toContain('Saved profiles (1)');
    expect(host.textContent).toContain('1 region');
    expect(profileList.value).toHaveLength(1);

    act(() => button('Delete').click());
    expect(profileList.value).toHaveLength(1);
    expect(host.textContent).toContain('Tap again to delete');
    act(() => button('Tap again to delete').click());
    await flush();
    expect(profileList.value).toHaveLength(0);
    expect(host.textContent).toContain('Nothing saved yet');
  });

  it('asks before discarding unsaved changes when opening another profile', async () => {
    await saveCurrent();
    const firstId = profile.value.id;
    act(() => render(<ProfilesPanel />, host));
    await flush();
    act(() => applyEdit((p) => ({ ...p, name: 'Edited' })));
    act(() => button('Open').click());
    expect(host.textContent).toContain('Discard changes and open');
    expect(profile.value.name).toBe('Edited');
    act(() => button('Discard changes and open').click());
    await flush();
    expect(profile.value.id).toBe(firstId);
    expect(profile.value.name).toBe('Right eye');
  });

  it('shows a clear message when storage is unavailable', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true, writable: true });
    try {
      await _resetForTests().catch(() => undefined);
      act(() => render(<ProfilesPanel />, host));
      await flush();
      expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/not available/);
    } finally {
      if (original) Object.defineProperty(globalThis, 'indexedDB', original);
    }
  });
});
