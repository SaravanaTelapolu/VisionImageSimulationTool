import { describe, expect, it } from 'vitest';
import { AUTO_STACK_ASPECT, captionPadFor, labelBandFor, layoutExport, lineHeightFor, MIN_FONT_PX } from './layout';

const portrait = { w: 600, h: 800 };
const landscape = { w: 800, h: 600 };

describe('layoutExport', () => {
  it('auto: portrait images go side by side at equal height, original first', () => {
    const l = layoutExport({
      simulated: portrait,
      original: { w: 1200, h: 1600 },
      orientation: 'auto',
      captionLines: 0,
      labels: false,
    });
    expect(l.panels).toHaveLength(2);
    const [o, s] = l.panels as [typeof l.panels[0], typeof l.panels[0]];
    expect(o.h).toBe(800);
    expect(s.h).toBe(800);
    expect(o.w).toBe(600);
    expect(o.y).toBe(0);
    expect(s.x).toBe(o.w + l.gap);
    expect(l.width).toBe(o.w + l.gap + s.w);
    expect(l.height).toBe(800);
    expect(l.caption).toBeNull();
  });

  it('auto: landscape images are stacked at equal width', () => {
    const l = layoutExport({
      simulated: landscape,
      original: { w: 1600, h: 1200 },
      orientation: 'auto',
      captionLines: 0,
      labels: false,
    });
    const [o, s] = l.panels as [typeof l.panels[0], typeof l.panels[0]];
    expect(l.width).toBe(800);
    expect(o.w).toBe(800);
    expect(s.w).toBe(800);
    expect(o.h).toBe(600);
    expect(s.y).toBe(o.h + l.gap);
    expect(l.height).toBe(o.h + l.gap + s.h);
  });

  it('auto: square images go side by side', () => {
    const l = layoutExport({
      simulated: { w: 500, h: 500 },
      original: { w: 500, h: 500 },
      orientation: 'auto',
      captionLines: 0,
      labels: false,
    });
    expect(l.height).toBe(500);
    expect(l.panels[1]!.x).toBeGreaterThan(0);
    expect(l.panels[1]!.y).toBe(0);
  });

  it('auto: only clearly landscape images (aspect > 1.15) stack', () => {
    const at = (w: number, h: number) =>
      layoutExport({ simulated: { w, h }, original: { w, h }, orientation: 'auto', captionLines: 0, labels: false });
    // 1.15 exactly and slightly wider than square still sit side by side
    expect(at(1150, 1000).panels[1]!.x).toBeGreaterThan(0);
    expect(at(1100, 1000).panels[1]!.x).toBeGreaterThan(0);
    // just over the threshold stacks
    const stacked = at(1160, 1000);
    expect(stacked.panels[1]!.x).toBe(0);
    expect(stacked.panels[1]!.y).toBeGreaterThan(0);
    expect(AUTO_STACK_ASPECT).toBe(1.15);
  });

  it('explicit orientation overrides auto', () => {
    const h = layoutExport({
      simulated: landscape,
      original: landscape,
      orientation: 'horizontal',
      captionLines: 0,
      labels: false,
    });
    expect(h.panels[1]!.x).toBeGreaterThan(0);
    expect(h.height).toBe(600);
    const v = layoutExport({
      simulated: portrait,
      original: portrait,
      orientation: 'vertical',
      captionLines: 0,
      labels: false,
    });
    expect(v.width).toBe(600);
    expect(v.panels[1]!.y).toBeGreaterThan(0);
  });

  it('scales an original of a different aspect ratio to the shared dimension', () => {
    const l = layoutExport({
      simulated: portrait,
      original: { w: 1000, h: 500 },
      orientation: 'horizontal',
      captionLines: 0,
      labels: false,
    });
    expect(l.panels[0]).toMatchObject({ w: 1600, h: 800 });
    const v = layoutExport({
      simulated: landscape,
      original: { w: 400, h: 800 },
      orientation: 'vertical',
      captionLines: 0,
      labels: false,
    });
    expect(v.panels[0]).toMatchObject({ w: 800, h: 1600 });
  });

  it('without an original there is one panel at the simulated size and no gap', () => {
    const l = layoutExport({
      simulated: portrait,
      orientation: 'auto',
      captionLines: 0,
      labels: false,
    });
    expect(l.panels).toEqual([{ x: 0, y: 0, w: 600, h: 800, label: '' }]);
    expect(l.width).toBe(600);
    expect(l.height).toBe(800);
    expect(l.gap).toBe(0);
  });

  it('labels reserve a band above each panel and name the panels', () => {
    const l = layoutExport({
      simulated: portrait,
      original: portrait,
      orientation: 'horizontal',
      captionLines: 0,
      labels: true,
    });
    const band = labelBandFor(l.fontPx);
    expect(band).toBeGreaterThan(0);
    expect(l.panels.map((p) => p.label)).toEqual(['Original', 'Simulated']);
    expect(l.panels.every((p) => p.y === band)).toBe(true);
    expect(l.height).toBe(band + 800);

    const v = layoutExport({
      simulated: landscape,
      original: landscape,
      orientation: 'vertical',
      captionLines: 0,
      labels: true,
    });
    const vb = labelBandFor(v.fontPx);
    expect(v.panels[0]!.y).toBe(vb);
    expect(v.panels[1]!.y).toBe(vb + 600 + v.gap + vb);
    expect(v.height).toBe(2 * (vb + 600) + v.gap);
  });

  it('labels a lone simulated panel too', () => {
    const l = layoutExport({ simulated: portrait, orientation: 'auto', captionLines: 0, labels: true });
    expect(l.panels[0]!.label).toBe('Simulated');
  });

  it('adds a full-width caption bar below the content sized by line count', () => {
    const l = layoutExport({
      simulated: portrait,
      original: portrait,
      orientation: 'auto',
      captionLines: 3,
      labels: false,
    });
    const barH = 3 * lineHeightFor(l.fontPx) + 2 * captionPadFor(l.fontPx);
    expect(l.caption).toEqual({ x: 0, y: 800, w: l.width, h: barH });
    expect(l.height).toBe(800 + barH);
  });

  it('font scales with output width with a minimum of 14 px', () => {
    const small = layoutExport({ simulated: { w: 100, h: 100 }, orientation: 'auto', captionLines: 0, labels: false });
    expect(small.fontPx).toBe(MIN_FONT_PX);
    const mid = layoutExport({ simulated: { w: 1000, h: 800 }, orientation: 'auto', captionLines: 0, labels: false });
    const big = layoutExport({ simulated: { w: 2000, h: 1600 }, orientation: 'auto', captionLines: 0, labels: false });
    expect(big.fontPx).toBeGreaterThan(mid.fontPx);
    expect(mid.fontPx).toBeGreaterThan(MIN_FONT_PX);
  });
});
