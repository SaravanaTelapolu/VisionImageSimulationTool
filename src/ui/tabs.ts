import type { TabId } from '../state/store';

/** Short tab labels: five tabs must fit in 360 px next to the 44 px sheet toggle. */
export const TAB_LABELS: Record<TabId, string> = {
  regions: 'Regions',
  effects: 'Effects',
  compare: 'Compare',
  export: 'Export',
  profiles: 'Profiles',
};
