import type { ViewportInfo } from '../../viewport/context';

const ACCENT = '#ffd54a';
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/**
 * A hint banner pinned to the top of the visible image area (drawn in the viewport's SVG overlay),
 * with a button on the right. Used by the freehand and brush tools.
 */
export function ToolBanner({
  info,
  text,
  buttonLabel,
  onButton,
}: {
  info: ViewportInfo;
  text: string;
  buttonLabel: string;
  onButton: () => void;
}) {
  const { px, view, scale, box } = info;
  const visW = box.width / scale;
  const w = Math.min(px(340), visW - px(16));
  const h = px(56);
  const x = -view.tx / scale + (visW - w) / 2;
  const y = -view.ty / scale + px(8);
  const btnW = px(92);
  const btnH = px(44);
  const btnX = x + w - btnW - px(6);
  const btnY = y + (h - btnH) / 2;
  const stop = (e: Event) => e.stopPropagation();
  return (
    <g role="status" style={{ pointerEvents: 'all' }} onPointerDown={stop}>
      <rect x={x} y={y} width={w} height={h} rx={px(10)} fill="#14141a" stroke={ACCENT} stroke-width={px(2)} />
      <text
        x={x + px(14)}
        y={y + h / 2}
        dominant-baseline="central"
        fill="#fff"
        font-size={px(14)}
        font-weight="600"
        font-family={FONT}
        pointer-events="none"
        style={{ userSelect: 'none' }}
      >
        {text}
      </text>
      <g
        role="button"
        tabIndex={0}
        aria-label={buttonLabel}
        style={{ cursor: 'pointer', touchAction: 'none' }}
        onClick={onButton}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onButton();
          }
        }}
      >
        <rect x={btnX} y={btnY} width={btnW} height={btnH} rx={px(8)} fill={ACCENT} stroke="#000" stroke-width={px(2)} />
        <text
          x={btnX + btnW / 2}
          y={btnY + btnH / 2}
          text-anchor="middle"
          dominant-baseline="central"
          fill="#000"
          font-size={px(16)}
          font-weight="700"
          font-family={FONT}
          pointer-events="none"
          style={{ userSelect: 'none' }}
        >
          {buttonLabel}
        </text>
      </g>
    </g>
  );
}
