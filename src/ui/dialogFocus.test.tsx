// @vitest-environment jsdom
import { render } from 'preact';
import { useRef } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trapTarget, useDialog } from './dialogFocus';
import { wrapBannerText } from './edit/freehand/ToolBanner';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
});

function Dialog({ onEscape }: { onEscape?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, onEscape ? { onEscape } : {});
  return (
    <div ref={ref} role="dialog" tabIndex={-1} id="dlg">
      <button id="first">First</button>
      <button id="skip" disabled>
        Disabled
      </button>
      <input id="last" />
    </div>
  );
}

const key = (k: string, shiftKey = false) =>
  act(() => {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));
  });

describe('trapTarget', () => {
  it('wraps Tab from the last control to the first and Shift+Tab the other way', () => {
    act(() => render(<Dialog />, host));
    const root = host.querySelector('#dlg') as HTMLElement;
    const first = host.querySelector('#first') as HTMLElement;
    const last = host.querySelector('#last') as HTMLElement;
    expect(trapTarget(root, last, false)).toBe(first);
    expect(trapTarget(root, first, true)).toBe(last);
    expect(trapTarget(root, first, false)).toBeNull(); // the browser's own move stays inside
    expect(trapTarget(root, document.body, false)).toBe(first); // focus escaped: pull it back
  });
});

describe('useDialog', () => {
  it('traps Tab, closes on Escape and gives focus back to the opener', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const onEscape = vi.fn();
    act(() => render(<Dialog onEscape={onEscape} />, host));
    const first = host.querySelector('#first') as HTMLElement;
    const last = host.querySelector('#last') as HTMLElement;

    last.focus();
    key('Tab');
    expect(document.activeElement).toBe(first);
    key('Tab', true);
    expect(document.activeElement).toBe(last);

    key('Escape');
    expect(onEscape).toHaveBeenCalledTimes(1);

    act(() => render(null, host));
    await new Promise((r) => setTimeout(r, 10));
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe('wrapBannerText', () => {
  it('breaks at spaces and keeps long words whole', () => {
    expect(wrapBannerText('Tap where the spot is', 40)).toEqual(['Tap where the spot is']);
    expect(wrapBannerText('Tap where the spot is', 12)).toEqual(['Tap where', 'the spot is']);
    expect(wrapBannerText('Supercalifragilistic word', 8)).toEqual(['Supercalifragilistic', 'word']);
    expect(wrapBannerText('', 20)).toEqual(['']);
  });
});
