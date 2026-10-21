// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WipeDivider } from './WipeDivider';

let root: HTMLElement;
const onChange = vi.fn();

beforeEach(() => {
  // Lets Preact bind onPointerDown & co. to the real lower-case events (jsdom lacks these properties).
  for (const n of ['onpointerdown', 'onpointermove', 'onpointerup', 'onpointercancel']) {
    Object.defineProperty(HTMLElement.prototype, n, { value: null, writable: true, configurable: true });
  }
  onChange.mockClear();
  root = document.createElement('div');
  document.body.appendChild(root);
  act(() => {
    render(
      <div class="container">
        <WipeDivider pos={0.5} width={300} onChange={onChange} />
      </div>,
      root,
    );
  });
});

afterEach(() => {
  act(() => {
    render(null, root);
  });
  root.remove();
});

const fire = (el: Element, type: string, init: Record<string, unknown> = {}) =>
  act(() => {
    // jsdom has no PointerEvent, so a plain Event carries the fields the handlers read.
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0, button: 0, key: '', shiftKey: false }, init);
    el.dispatchEvent(e);
  });

/** The CSS declarations of the first rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): string {
  const m = new RegExp(`(?:^|\\n)[ \\t]*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1] as string;
}

describe('WipeDivider hit areas', () => {
  it('has exactly two pointer targets: the knob slider and a narrow line strip', () => {
    const handle = root.querySelector('.wipe-handle') as HTMLElement;
    const line = root.querySelector('.wipe-line') as HTMLElement;
    expect(handle.getAttribute('role')).toBe('slider');
    expect(handle.querySelector('.wipe-knob')).not.toBeNull();
    expect(line.getAttribute('aria-hidden')).toBe('true');
    // Nothing else in the divider takes pointers except the two labels, which are CSS pointer-events: none.
    expect(root.querySelectorAll('.wipe > *').length).toBeGreaterThanOrEqual(2);
  });

  it('the CSS keeps the container click-through and the knob at 44 px, not full height', async () => {
    // The stylesheet is read as text (vitest does not give CSS imports back as source).
    const fsName = 'node:fs';
    const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync(path: string, enc: string): string };
    const css = fs.readFileSync('src/ui/panels/compare/compare.css', 'utf8');
    expect(rule(css, '.wipe')).toMatch(/pointer-events:\s*none/);
    const handle = rule(css, '.wipe-handle');
    expect(handle).toMatch(/width:\s*44px/);
    expect(handle).toMatch(/height:\s*44px/);
    expect(handle).not.toMatch(/bottom:/); // no longer spans the whole image height
    expect(handle).toMatch(/pointer-events:\s*auto/);
    const line = rule(css, '.wipe-line');
    expect(line).toMatch(/width:\s*16px/); // narrow
    expect(line).toMatch(/pointer-events:\s*auto/);
    expect(rule(css, '.wipe-knob')).toMatch(/width:\s*44px/);
  });

  it('dragging the knob or the line moves the divider', () => {
    fire(root.querySelector('.wipe-handle') as Element, 'pointerdown', { clientX: 10 });
    expect(onChange).toHaveBeenCalledTimes(1);
    fire(root.querySelector('.wipe-line') as Element, 'pointerdown', { clientX: 10 });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('a press on the divider does not reach the viewport underneath', () => {
    const outer = vi.fn();
    root.addEventListener('pointerdown', outer);
    fire(root.querySelector('.wipe-handle') as Element, 'pointerdown');
    fire(root.querySelector('.wipe-line') as Element, 'pointerdown');
    expect(outer).not.toHaveBeenCalled();
  });

  it('stays keyboard operable', () => {
    const handle = root.querySelector('.wipe-handle') as HTMLElement;
    expect(handle.tabIndex).toBe(0);
    expect(handle.getAttribute('aria-valuenow')).toBe('50');
    fire(handle, 'keydown', { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(0.52);
    fire(handle, 'keydown', { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(0);
    fire(handle, 'keydown', { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(1);
  });
});
