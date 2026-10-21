// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APPROXIMATION_LINE } from '../../../export';
import { newProfile } from '../../../model/defaults';
import { activeTab, image, resetProfile, setWorkingImage } from '../../../state/store';
import { ExportPanel } from './Panel';

let root: HTMLElement;

const mount = () =>
  act(() => {
    render(<ExportPanel />, root);
  });

const shareButton = (): HTMLButtonElement =>
  Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Prepare images') as HTMLButtonElement;

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  resetProfile({ ...newProfile(), name: 'Check-up', note: 'Night view' });
  activeTab.value = 'export';
  image.value = null;
});

afterEach(() => {
  act(() => {
    render(null, root);
  });
  root.remove();
});

describe('ExportPanel', () => {
  it('is disabled with an explanation when no image is loaded', () => {
    mount();
    expect(shareButton().disabled).toBe(true);
    expect(root.textContent).toContain('Load a photo or a test image first.');
  });

  it('defaults to Simulated + Side by side and prefills the caption from the profile', () => {
    act(() => {
      setWorkingImage(document.createElement('canvas'), 10, 10, 'test');
    });
    mount();
    const checks = Array.from(root.querySelectorAll<HTMLInputElement>('.export-check input')).map((i) => [
      i.parentElement?.textContent,
      i.checked,
    ]);
    expect(checks.slice(0, 3)).toEqual([
      ['Simulated', true],
      ['Original', false],
      ['Side by side', true],
    ]);
    expect(shareButton().disabled).toBe(false);
    expect((root.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Night view');
    expect(root.textContent).toContain(APPROXIMATION_LINE);
  });
});
