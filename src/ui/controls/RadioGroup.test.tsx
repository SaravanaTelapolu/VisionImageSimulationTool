// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EyeRadioGroup } from './EyeRadioGroup';
import { RadioGroup } from './RadioGroup';

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

const radios = () => [...host.querySelectorAll<HTMLInputElement>('input[type=radio]')];

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
] as const;

describe('RadioGroup', () => {
  it('renders a fieldset with a legend and labelled native radios sharing one name', () => {
    act(() => render(<RadioGroup name="g1" legend="Pick one" value="b" options={OPTIONS} onChange={() => {}} />, host));
    const fs = host.querySelector('fieldset');
    expect(fs).not.toBeNull();
    expect(fs?.querySelector('legend')?.textContent).toBe('Pick one');
    const r = radios();
    expect(r.map((x) => x.name)).toEqual(['g1', 'g1']);
    expect(r.map((x) => x.value)).toEqual(['a', 'b']);
    expect(r.map((x) => x.checked)).toEqual([false, true]);
    // Each radio sits inside its <label>, so the whole (44 px) row is the tap target and its name.
    expect(r.map((x) => x.closest('label')?.textContent)).toEqual(['Alpha', 'Beta']);
    expect(host.querySelector('label[data-checked="true"]')?.textContent).toBe('Beta');
  });

  it('reports a new choice once, and nothing for the current one', () => {
    const onChange = vi.fn();
    act(() => render(<RadioGroup name="g2" legend="L" value="a" options={OPTIONS} onChange={onChange} />, host));
    act(() => radios()[0]!.click());
    expect(onChange).not.toHaveBeenCalled();
    act(() => radios()[1]!.click());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('shows nothing selected when the value is null', () => {
    act(() => render(<RadioGroup name="g3" legend="L" value={null} options={OPTIONS} onChange={() => {}} />, host));
    expect(radios().some((x) => x.checked)).toBe(false);
  });

  it('can be disabled as a whole', () => {
    act(() => render(<RadioGroup name="g4" legend="L" value="a" options={OPTIONS} onChange={() => {}} disabled />, host));
    expect(host.querySelector('fieldset')?.disabled).toBe(true);
  });
});

describe('EyeRadioGroup', () => {
  it('offers Left and Right under "Affected eye" by default', () => {
    const onChange = vi.fn();
    act(() => render(<EyeRadioGroup name="eye-t" value="right" onChange={onChange} />, host));
    expect(host.querySelector('legend')?.textContent).toBe('Affected eye');
    expect(radios().map((x) => [x.value, x.checked])).toEqual([
      ['left', false],
      ['right', true],
    ]);
    act(() => radios()[0]!.click());
    expect(onChange).toHaveBeenCalledWith('left');
  });

  it('takes a custom legend', () => {
    act(() => render(<EyeRadioGroup name="eye-u" legend="Which eye?" value={null} onChange={() => {}} />, host));
    expect(host.querySelector('legend')?.textContent).toBe('Which eye?');
  });
});
