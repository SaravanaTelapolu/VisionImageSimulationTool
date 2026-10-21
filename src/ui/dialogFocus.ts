import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';

const FOCUSABLE =
  'a[href], button, input, select, textarea, summary, [tabindex], [role="slider"]';

/** Elements inside `root` that Tab can reach, in DOM order. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.tabIndex < 0) return false;
    if ((el as HTMLButtonElement).disabled) return false;
    if (el.closest('[hidden], [inert]')) return false;
    // A closed <details> hides everything but its <summary>.
    const details = el.closest('details');
    if (details && !details.open && el.tagName !== 'SUMMARY' && !el.closest('summary')) return false;
    return true;
  });
}

/**
 * Where Tab / Shift+Tab should go next so focus never leaves `root`, or null when the browser's own
 * move stays inside. Pure apart from reading the DOM; used by the keydown handler and the tests.
 */
export function trapTarget(root: HTMLElement, active: Element | null, shift: boolean): HTMLElement | null {
  const items = focusableIn(root);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return root;
  const outside = !active || !root.contains(active);
  if (shift) return outside || active === first || active === root ? last : null;
  return outside || active === last ? first : null;
}

// The page behind a dialog is made inert, which drops focus to <body> before the dialog can look at
// it. So the last element focused outside any dialog is tracked here as the one to come back to.
let lastOutsideFocus: Element | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener(
    'focusin',
    (e) => {
      const t = e.target;
      if (t instanceof Element && !t.closest('[aria-modal="true"]')) lastOutsideFocus = t;
    },
    true,
  );
}

/** Id of the top bar's "More options" button. Dialogs opened from its menu return focus here. */
export const MORE_BUTTON_ID = 'more-btn';

export interface DialogOptions {
  /** Close on Escape. Omit when the dialog handles Escape itself. */
  onEscape?: () => void;
  /** Where focus goes on close when the opener is gone (for example a menu item that closed its menu). */
  fallbackFocusId?: string;
}

/**
 * Makes a modal dialog behave: Tab and Shift+Tab stay inside, Escape closes (when asked), and focus
 * goes back to the control that opened it once it unmounts. The dialog root should have tabIndex -1.
 * Mount the dialog only while it is open.
 */
export function useDialog(rootRef: RefObject<HTMLElement>, options: DialogOptions = {}): void {
  const opener = useRef<Element | null>(null);
  const escRef = useRef(options.onEscape);
  escRef.current = options.onEscape;
  const fallbackId = options.fallbackFocusId ?? MORE_BUTTON_ID;

  // Remember the opener before anything inside the dialog takes focus.
  useLayoutEffect(() => {
    const active = document.activeElement;
    opener.current = active && active !== document.body ? active : lastOutsideFocus;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (e.key === 'Escape' && escRef.current && !e.defaultPrevented) {
        e.preventDefault();
        escRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const target = trapTarget(root, document.activeElement, e.shiftKey);
      if (target) {
        e.preventDefault();
        target.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [rootRef]);

  // Give focus back on close.
  useEffect(
    () => () => {
      const el = opener.current;
      const target =
        el instanceof HTMLElement && el.isConnected && el !== document.body
          ? el
          : fallbackId
            ? document.getElementById(fallbackId)
            : null;
      // After the dialog is removed, so the focus move is not undone by the unmount.
      window.setTimeout(() => target?.focus(), 0);
    },
    [fallbackId],
  );
}
