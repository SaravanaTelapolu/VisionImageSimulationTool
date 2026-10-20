import type { ComponentChildren } from 'preact';
import type { TabId } from '../state/store';

function Svg({ children }: { children: ComponentChildren }) {
  return (
    <svg
      class="tab-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Small icon for each tab, drawn above its short label. */
export function TabIcon({ tab }: { tab: TabId }) {
  switch (tab) {
    case 'regions':
      return (
        <Svg>
          <ellipse cx="12" cy="12" rx="9" ry="6" stroke-dasharray="3 3" />
          <circle cx="12" cy="12" r="1.5" />
        </Svg>
      );
    case 'effects':
      return (
        <Svg>
          <path d="M5 6v12M12 6v12M19 6v12" />
          <circle cx="5" cy="14" r="2" fill="currentColor" />
          <circle cx="12" cy="9" r="2" fill="currentColor" />
          <circle cx="19" cy="15" r="2" fill="currentColor" />
        </Svg>
      );
    case 'compare':
      return (
        <Svg>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M12 5v14" />
          <path d="M3 12h4" />
        </Svg>
      );
    case 'export':
      return (
        <Svg>
          <path d="M12 15V4m0 0L8 8m4-4l4 4" />
          <path d="M5 14v5h14v-5" />
        </Svg>
      );
    case 'profiles':
      return (
        <Svg>
          <path d="M6 3h9l4 4v14H6z" />
          <path d="M14 3v5h5" />
          <path d="M9 13h7M9 17h7" />
        </Svg>
      );
  }
}
