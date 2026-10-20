// Side by side shows two read-only copies, so region editing cannot work there. Opening an editing
// tab (Regions or Effects) while it is on puts the compare mode back to Single.
import { effect } from '@preact/signals';
import { activeTab, type TabId } from '../state/store';
import { compareMode, type CompareMode } from '../state/ui';
import { announce } from './announce';

/** Tabs whose controls edit regions on the image. */
export const EDITING_TABS: readonly TabId[] = ['regions', 'effects'];

export const SWITCHED_TO_SINGLE_MESSAGE = 'Switched to Single view so you can edit.';

/** True when the compare mode has to change for the tab to be usable. */
export function mustLeaveSideBySide(mode: CompareMode, tab: TabId): boolean {
  return mode === 'side' && EDITING_TABS.includes(tab);
}

/** Starts watching the tab and compare mode. Returns the function that stops watching. */
export function installCompareAutoSwitch(): () => void {
  return effect(() => {
    if (mustLeaveSideBySide(compareMode.value, activeTab.value)) {
      compareMode.value = 'single';
      announce(SWITCHED_TO_SINGLE_MESSAGE);
    }
  });
}
