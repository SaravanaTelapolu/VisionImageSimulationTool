// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultEllipse, defaultRect, newProfile, newRegion } from '../../../model/defaults';
import { addRegion } from '../../../model/ops';
import { activeTab, canUndo, profile, resetProfile, selectedRegionId, undo } from '../../../state/store';
import { EffectsPanel } from './Panel';

let root: HTMLElement;

function mount() {
  act(() => {
    render(<EffectsPanel />, root);
  });
}

function sliderByLabel(label: string): HTMLInputElement {
  const el = Array.from(root.querySelectorAll('label')).find((l) => l.textContent === label);
  if (!el) throw new Error(`no label ${label}`);
  return document.getElementById(el.getAttribute('for') ?? '') as HTMLInputElement;
}

function drag(input: HTMLInputElement, values: number[]) {
  for (const v of values) {
    act(() => {
      input.value = String(v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  const region = newRegion(defaultEllipse(), 'Spot 1');
  resetProfile(addRegion(newProfile(), region));
  selectedRegionId.value = region.id;
  activeTab.value = 'effects';
});

afterEach(() => {
  act(() => {
    render(null, root);
  });
  root.remove();
});

describe('EffectsPanel', () => {
  it('prompts when nothing is selected', () => {
    selectedRegionId.value = null;
    mount();
    expect(root.textContent).toContain('Select a region first');
    expect(root.querySelector('input[type=range].slider-input')).not.toBeNull(); // profile settings stay reachable
  });

  it('shows all effect sliders in the four groups plus feather', () => {
    mount();
    const titles = Array.from(root.querySelectorAll('.fx-group-title')).map((e) => e.textContent);
    expect(titles).toEqual(['Sharpness', 'Spots', 'Shape', 'Tone']);
    for (const label of [
      'Soft edge (feather)',
      'Blur',
      'Dark spot',
      'Missing area',
      'Distortion',
      'Size change',
      'Contrast loss',
      'Dimming',
      'Colour fade',
      'Double image',
    ]) {
      expect(sliderByLabel(label)).toBeTruthy();
    }
    const blur = sliderByLabel('Blur');
    expect(blur.min).toBe('0');
    expect(blur.max).toBe('100');
    expect(blur.getAttribute('aria-valuetext')).toBe('0.0 px');
  });

  it('one drag is one undo step and updates the profile live', () => {
    mount();
    const blur = sliderByLabel('Blur');
    drag(blur, [2, 5, 9]);
    expect(profile.value.regions[0]?.effects.blur).toBe(9);
    expect(sliderByLabel('Blur').getAttribute('aria-valuetext')).toBe('9.0 px');
    expect(canUndo.value).toBe(true);
    act(() => undo());
    expect(profile.value.regions[0]?.effects.blur).toBe(0);
    expect(canUndo.value).toBe(false);
  });

  it('enables size change for a rectangle spot', () => {
    const rect = newRegion(defaultRect(), 'Box');
    resetProfile(addRegion(newProfile(), rect));
    selectedRegionId.value = rect.id;
    mount();
    expect(sliderByLabel('Size change').disabled).toBe(false);
    expect(sliderByLabel('Soft edge (feather)').disabled).toBe(false);
  });

  it('disables size change for non-spot shapes with a note', () => {
    const full = newRegion({ type: 'full' }, 'Whole image');
    resetProfile(addRegion(newProfile(), full));
    selectedRegionId.value = full.id;
    mount();
    expect(sliderByLabel('Size change').disabled).toBe(true);
    expect(sliderByLabel('Soft edge (feather)').disabled).toBe(true);
    expect(root.textContent).toContain('Size change works on spots');
    expect(sliderByLabel('Blur').disabled).toBe(false);
  });

  it('has a per-region dark-spot shade next to Dark spot, off while Dark spot is 0 (D05)', () => {
    mount();
    const shade = sliderByLabel('Dark spot shade');
    expect(shade.disabled).toBe(true);
    expect(root.textContent).toContain('Turn up Dark spot');
    expect(shade.closest('.fx-group')?.querySelector('.fx-group-title')?.textContent).toBe('Spots');
    expect(root.querySelector('.fx-details')?.textContent).not.toContain('Dark spot shade');
    drag(sliderByLabel('Dark spot'), [0.5]);
    expect(sliderByLabel('Dark spot shade').disabled).toBe(false);
    drag(sliderByLabel('Dark spot shade'), [0.3, 0.6]);
    expect(profile.value.regions[0]?.darkSpotShade).toBe(0.6);
    expect(profile.value.globals.darkSpotShade).toBe(0);
    act(() => undo());
    expect(profile.value.regions[0]?.darkSpotShade).toBe(0);
  });

  it('edits profile settings with globals keys', () => {
    mount();
    drag(sliderByLabel('Wave direction'), [45, 90]);
    expect(profile.value.globals.distortAngle).toBe(90);
    drag(sliderByLabel('Viewing distance'), [60]);
    expect(profile.value.viewingDistanceCm).toBe(60);
    const left = root.querySelector<HTMLInputElement>('input[type=radio][name=eye-effects][value=left]');
    expect(left?.checked).toBe(false);
    act(() => left?.click());
    expect(profile.value.eye).toBe('left');
    expect(root.querySelector<HTMLInputElement>('input[name=eye-effects][value=left]')?.checked).toBe(true);
  });

  it('reset button sets an effect back to 0', () => {
    mount();
    drag(sliderByLabel('Dimming'), [40]);
    const reset = root.querySelector<HTMLButtonElement>('button[aria-label^="Reset Dimming"]');
    expect(reset?.disabled).toBe(false);
    act(() => reset?.click());
    expect(profile.value.regions[0]?.effects.dimming).toBe(0);
  });
});
