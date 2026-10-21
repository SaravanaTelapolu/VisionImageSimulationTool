import { signal } from '@preact/signals';
import { useRef } from 'preact/hooks';
import { TAB_IDS, activeTab, type TabId } from '../state/store';
import { ChevronUpIcon } from './icons';
import { ComparePanel } from './panels/compare/Panel';
import { EffectsPanel } from './panels/effects/Panel';
import { ExportPanel } from './panels/export/Panel';
import { ProfilesPanel } from './panels/profiles';
import { RegionsPanel } from './panels/regions/Panel';
import { TAB_LABELS } from './tabs';
import { TabIcon } from './tabIcons';
import { openTimeline } from '../state/ui';

type Snap = 'collapsed' | 'half' | 'full';
const SNAPS: readonly Snap[] = ['collapsed', 'half', 'full'];

/** Bottom-sheet height on phones. Ignored at >= 900 px, where the sheet is a sidebar. */
export const sheetSnap = signal<Snap>('half');

function step(delta: number): void {
  const i = SNAPS.indexOf(sheetSnap.value) + delta;
  const next = SNAPS[Math.min(SNAPS.length - 1, Math.max(0, i))];
  if (next) sheetSnap.value = next;
}

function Panel({ tab }: { tab: TabId }) {
  switch (tab) {
    case 'regions':
      return <RegionsPanel />;
    case 'effects':
      return <EffectsPanel />;
    case 'compare':
      return <ComparePanel />;
    case 'export':
      return <ExportPanel />;
    case 'profiles':
      return <ProfilesPanel onOpenTimeline={openTimeline} />;
  }
}

/** Tabs and their panels: a bottom sheet on phones, a right sidebar on wide screens (CSS decides). */
export function Sheet() {
  const snap = sheetSnap.value;
  const tab = activeTab.value;
  const swipeStart = useRef<number | null>(null);

  const selectTab = (t: TabId) => {
    activeTab.value = t;
    if (sheetSnap.value === 'collapsed') sheetSnap.value = 'half';
  };

  const onTabKey = (e: KeyboardEvent) => {
    const i = TAB_IDS.indexOf(tab);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % TAB_IDS.length;
    else if (e.key === 'ArrowLeft') n = (i + TAB_IDS.length - 1) % TAB_IDS.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = TAB_IDS.length - 1;
    else return;
    e.preventDefault();
    const t = TAB_IDS[n];
    if (t) {
      selectTab(t);
      document.getElementById(`tab-${t}`)?.focus();
    }
  };

  // Swipe up / down on the tab strip changes the sheet height.
  const onHeadDown = (e: PointerEvent) => {
    swipeStart.current = e.clientY;
  };
  const onHeadUp = (e: PointerEvent) => {
    const y0 = swipeStart.current;
    swipeStart.current = null;
    if (y0 === null) return;
    const dy = e.clientY - y0;
    if (dy < -40) step(1);
    else if (dy > 40) step(-1);
  };

  return (
    <section class="sheet" data-snap={snap} aria-label="Tools">
      <div
        class="sheet-head"
        onPointerDown={onHeadDown}
        onPointerUp={onHeadUp}
        onPointerCancel={() => (swipeStart.current = null)}
      >
        <div class="tabs" role="tablist" aria-label="Tools" onKeyDown={onTabKey}>
          {TAB_IDS.map((t) => (
            <button
              key={t}
              id={`tab-${t}`}
              type="button"
              role="tab"
              class="tab"
              aria-selected={tab === t}
              aria-controls="tabpanel"
              tabIndex={tab === t ? 0 : -1}
              onClick={() => selectTab(t)}
            >
              <TabIcon tab={t} />
              <span class="tab-label">{TAB_LABELS[t]}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          class="iconbtn sheet-toggle"
          aria-label={snap === 'full' ? 'Collapse panel' : 'Expand panel'}
          aria-expanded={snap !== 'collapsed'}
          onClick={() => (sheetSnap.value = snap === 'collapsed' ? 'half' : snap === 'half' ? 'full' : 'collapsed')}
        >
          <span class="sheet-toggle-icon" data-snap={snap}>
            <ChevronUpIcon />
          </span>
        </button>
      </div>
      <div class="tabpanel" id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1}>
        <Panel tab={tab} />
      </div>
    </section>
  );
}
