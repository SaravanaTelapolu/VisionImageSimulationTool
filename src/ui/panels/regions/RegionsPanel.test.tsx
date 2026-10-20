// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newProfile } from '../../../model/defaults';
import { activeTab, profile, resetProfile, selectedRegionId, undo } from '../../../state/store';
import { RegionsPanel } from './Panel';

let root: HTMLElement;

function mount() {
  act(() => {
    render(<RegionsPanel />, root);
  });
}

function button(text: string): HTMLButtonElement {
  const b = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((x) => x.textContent?.includes(text));
  if (!b) throw new Error(`no button ${text}`);
  return b;
}

function byLabel(label: string): HTMLButtonElement {
  const b = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!b) throw new Error(`no button labelled ${label}`);
  return b;
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  resetProfile(newProfile());
  activeTab.value = 'regions';
});

afterEach(() => {
  act(() => {
    render(null, root);
  });
  root.remove();
});

describe('RegionsPanel', () => {
  it('shows the empty state; Freehand and Brush need a photo', () => {
    mount();
    expect(root.textContent).toContain('Add a spot where your vision is affected.');
    expect(button('Freehand').disabled).toBe(true);
    expect(button('Brush').disabled).toBe(true);
  });

  it('adds an ellipse at the fixation point and selects it', () => {
    mount();
    act(() => button('Spot (ellipse)').click());
    const r = profile.value.regions[0];
    expect(r?.shape).toMatchObject({ type: 'ellipse', cx: 0, cy: 0 });
    expect(selectedRegionId.value).toBe(r?.id);
    expect(root.textContent).toContain('Spot 1');
    expect(root.textContent).not.toContain('Add a spot where');
  });

  it('offers Edit effects for the selected region and switches tab', () => {
    mount();
    act(() => button('Whole image').click());
    act(() => button('Edit effects').click());
    expect(activeTab.value).toBe('effects');
  });

  it('toggles visibility, duplicates, reorders, renames and deletes', () => {
    mount();
    act(() => button('Spot (ellipse)').click());
    act(() => button('Spot (ellipse)').click());
    const [a, b] = profile.value.regions;

    act(() => byLabel('Hide Spot 2').click());
    expect(profile.value.regions[1]?.visible).toBe(false);

    act(() => byLabel('Move Spot 2 up').click());
    expect(profile.value.regions.map((r) => r.id)).toEqual([b?.id, a?.id]);

    act(() => byLabel('Duplicate Spot 1').click());
    expect(profile.value.regions).toHaveLength(3);
    expect(profile.value.regions.some((r) => r.name === 'Spot 1 copy')).toBe(true);

    act(() => byLabel('Rename Spot 1').click());
    const input = root.querySelector<HTMLInputElement>('input.rg-rename');
    expect(input).not.toBeNull();
    act(() => {
      (input as HTMLInputElement).value = 'Scar';
      (input as HTMLInputElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(profile.value.regions.some((r) => r.name === 'Scar')).toBe(true);

    act(() => byLabel('Delete Scar').click());
    expect(profile.value.regions).toHaveLength(2);
    act(() => undo());
    expect(profile.value.regions).toHaveLength(3);
  });
});
