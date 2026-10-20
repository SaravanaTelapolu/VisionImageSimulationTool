import { uiTextScale } from '../../../state/store';
import type { ViewportInfo } from '../../viewport/context';

const ACCENT = '#ffd54a';
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** Average glyph width as a fraction of the font size (system sans-serif). */
const CHAR_W = 0.56;

/** Splits text into lines of at most `maxChars` characters, breaking at spaces. Long words stay whole. */
export function wrapBannerText(text: string, maxChars: number): string[] {
  const limit = Math.max(8, Math.floor(maxChars));
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > limit) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/**
 * A hint banner pinned to the top of the visible image area (drawn in the viewport's SVG overlay),
 * with a button on the right. Used by the placing, freehand and brush tools. Text and button follow
 * the UI text-size setting; the hint wraps onto more lines instead of running off the banner.
 */
export function ToolBanner({
  info,
  text,
  buttonLabel,
  buttonAriaLabel,
  onButton,
}: {
  info: ViewportInfo;
  text: string;
  buttonLabel: string;
  /** Accessible name of the button when it should say more than the visible label. */
  buttonAriaLabel?: string;
  onButton: () => void;
}) {
  const { px, view, scale, box } = info;
  const s = uiTextScale.value;
  const visW = box.width / scale;
  const w = Math.min(px(340 * Math.max(1, s)), visW - px(16));
  const fontPx = 14 * s;
  const btnFontPx = 16 * s;
  const btnW = px(Math.max(92, btnFontPx * CHAR_W * buttonLabel.length + 28));
  const btnH = px(Math.max(44, btnFontPx * 1.8));
  const textW = w - btnW - px(6) - px(14) - px(8);
  const lines = wrapBannerText(text, textW / px(fontPx * CHAR_W));
  const lineH = px(fontPx * 1.3);
  const h = Math.max(px(56), lines.length * lineH + px(18), btnH + px(12));
  const x = -view.tx / scale + (visW - w) / 2;
  const y = -view.ty / scale + px(8);
  const btnX = x + w - btnW - px(6);
  const btnY = y + (h - btnH) / 2;
  const textY = y + h / 2 - ((lines.length - 1) * lineH) / 2;
  const stop = (e: Event) => e.stopPropagation();
  return (
    <g role="status" style={{ pointerEvents: 'all' }} onPointerDown={stop}>
      <rect x={x} y={y} width={w} height={h} rx={px(10)} fill="#14141a" stroke={ACCENT} stroke-width={px(2)} />
      <text
        x={x + px(14)}
        y={textY}
        dominant-baseline="central"
        fill="#fff"
        font-size={px(fontPx)}
        font-weight="600"
        font-family={FONT}
        pointer-events="none"
        style={{ userSelect: 'none' }}
      >
        {lines.map((line, i) => (
          <tspan key={i} x={x + px(14)} y={textY + i * lineH}>
            {line}
          </tspan>
        ))}
      </text>
      <g
        role="button"
        tabIndex={0}
        aria-label={buttonAriaLabel ?? buttonLabel}
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
          font-size={px(btnFontPx)}
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
