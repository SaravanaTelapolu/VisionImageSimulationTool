import type { ComponentChildren } from 'preact';

function Svg({ children }: { children: ComponentChildren }) {
  return (
    <svg
      class="icon"
      viewBox="0 0 24 24"
      width="24"
      height="24"
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

export const UndoIcon = () => (
  <Svg>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Svg>
);

export const RedoIcon = () => (
  <Svg>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Svg>
);

export const FlipIcon = () => (
  <Svg>
    <path d="M4 8h15m0 0l-4-4m4 4l-4 4" />
    <path d="M20 16H5m0 0l4-4m-4 4l4 4" />
  </Svg>
);

export const MoreIcon = () => (
  <svg class="icon" viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true" focusable="false">
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </svg>
);

export const PhotoIcon = () => (
  <Svg>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="M3 17l5-5 4 4 3-3 6 6" />
  </Svg>
);

export const CameraIcon = () => (
  <Svg>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </Svg>
);

export const ChevronUpIcon = () => (
  <Svg>
    <path d="M6 15l6-6 6 6" />
  </Svg>
);
