// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_DISTANCE_KEY,
  _resetProfilesStateForTests,
  defaultDistanceCm,
  persistentStorage,
  profileList,
  saveCurrent,
} from '../../../state/profiles';
import { getSetting } from '../../../storage';
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

  it('shows a storage hint that follows persistentStorage (nothing while unknown)', async () => {
    act(() => render(<ProfilesPanel />, host));
    await flush();
    expect(host.querySelector('.pf-storage-hint')).toBeNull();

    act(() => {
      persistentStorage.value = false;
    });
    expect(host.querySelector('.pf-storage-hint')?.textContent).toBe(
      'Saved on this device only. The browser may clear it if storage runs low — use Export all to keep a backup.',
    );

    act(() => {
      persistentStorage.value = true;
    });
    expect(host.querySelector('.pf-storage-hint')?.textContent).toBe(
      'Saved on this device (protected from automatic clearing).',
    );

    act(() => {
      persistentStorage.value = null;
    });
    expect(host.querySelector('.pf-storage-hint')).toBeNull();
  });
});

describe('ProfilesPanel default viewing distance setting', () => {
  it('shows presets, saves a chosen one, and labels profiles Near / Far', async () => {
    act(() => render(<ProfilesPanel />, host));
    await flush();
    expect(host.textContent).toContain('Default viewing distance for new profiles');
    expect(button('Near (reading) 40 cm').getAttribute('aria-pressed')).toBe('true');
    expect(host.textContent).toContain('Near · 40 cm');

    act(() => button('Far 300 cm').click());
    await flush();
    expect(defaultDistanceCm.value).toBe(300);
    expect(await getSetting<number>(DEFAULT_DISTANCE_KEY, -1)).toBe(300);
    expect(button('Far 300 cm').getAttribute('aria-pressed')).toBe('true');

    act(() => button('New profile').click());
    await flush();
    expect(profile.value.viewingDistanceCm).toBe(300);
    act(() => button('Save').click());
    await flush();
    expect(host.textContent).toContain('Far · 300 cm');
  });

  it('accepts a custom distance up to 600 cm and rejects more', async () => {
    act(() => render(<ProfilesPanel />, host));
    await flush();
    const input = host.querySelector<HTMLInputElement>('#pf-dd-custom')!;
    act(() => {
      input.value = '450';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
    expect(defaultDistanceCm.value).toBe(450);
    act(() => {
      input.value = '700';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
    expect(defaultDistanceCm.value).toBe(450);
    expect(host.textContent).toContain('between 10 and 600 cm');
  });
});
