// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { testImageDataUrl, testImages, type TestImage } from './testImages';

const SVG_NS = 'http://www.w3.org/2000/svg';

function parse(img: TestImage): Document {
  return new DOMParser().parseFromString(img.svg, 'image/svg+xml');
}

describe('testImages', () => {
  it('provides five images with unique ids', () => {
    expect(testImages).toHaveLength(5);
    const ids = testImages.map((img) => img.id);
    expect(new Set(ids).size).toBe(5);
    expect(ids).toEqual(['amsler', 'reading', 'face', 'street', 'pattern']);
  });

  for (const img of testImages) {
    describe(img.id, () => {
      it('parses as SVG without a parsererror', () => {
        const doc = parse(img);
        expect(doc.querySelector('parsererror')).toBeNull();
        expect(doc.documentElement.localName).toBe('svg');
        expect(doc.documentElement.namespaceURI).toBe(SVG_NS);
      });

      it('has width, height and viewBox matching the declared size', () => {
        const root = parse(img).documentElement;
        expect(root.getAttribute('width')).toBe(String(img.width));
        expect(root.getAttribute('height')).toBe(String(img.height));
        expect(root.getAttribute('viewBox')).toBe(`0 0 ${img.width} ${img.height}`);
      });

      it('starts with a light full-size background rect', () => {
        const rect = parse(img).querySelector('rect');
        expect(rect).not.toBeNull();
        expect(rect?.getAttribute('x')).toBe('0');
        expect(rect?.getAttribute('y')).toBe('0');
        expect(rect?.getAttribute('width')).toBe(String(img.width));
        expect(rect?.getAttribute('height')).toBe(String(img.height));
      });

      it('references no external URLs or fonts', () => {
        expect(img.svg.replace(SVG_NS, '')).not.toMatch(/https?:\/\//);
        expect(img.svg).not.toMatch(/<image\b/);
        expect(img.svg).not.toMatch(/@import/);
      });

      it('uses the system font stack for all text', () => {
        for (const text of Array.from(parse(img).querySelectorAll('text'))) {
          expect(text.getAttribute('font-family')).toBe('system-ui, sans-serif');
        }
      });
    });
  }

  it('draws the Amsler grid as 21 horizontal and 21 vertical lines with a centre dot', () => {
    const amsler = testImages.find((img) => img.id === 'amsler');
    expect(amsler).toBeDefined();
    if (!amsler) return;
    const doc = parse(amsler);
    const lines = Array.from(doc.querySelectorAll('line'));
    const horizontal = lines.filter(
      (l) => l.getAttribute('y1') === l.getAttribute('y2') && l.getAttribute('x1') !== l.getAttribute('x2'),
    );
    const vertical = lines.filter(
      (l) => l.getAttribute('x1') === l.getAttribute('x2') && l.getAttribute('y1') !== l.getAttribute('y2'),
    );
    expect(horizontal).toHaveLength(21);
    expect(vertical).toHaveLength(21);

    const dot = Array.from(doc.querySelectorAll('circle')).find(
      (c) => c.getAttribute('cx') === '600' && c.getAttribute('cy') === '600',
    );
    expect(dot).toBeDefined();
    expect(Number(dot?.getAttribute('r'))).toBeGreaterThan(0);
    expect(Number(dot?.getAttribute('r'))).toBeLessThan(20);
    expect(dot?.getAttribute('fill')).toBe('#000000');
  });

  it('labels every reading line with its size, from 64 px down to 12 px', () => {
    const reading = testImages.find((img) => img.id === 'reading');
    expect(reading).toBeDefined();
    if (!reading) return;
    const texts = Array.from(parse(reading).querySelectorAll('text'));
    const labels = texts.filter((t) => /^\d+ px$/.test(t.textContent ?? ''));
    const sizes = labels.map((t) => Number((t.textContent ?? '').replace(' px', '')));
    expect(sizes[0]).toBe(64);
    expect(sizes[sizes.length - 1]).toBe(12);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    for (const label of labels) {
      expect(label.getAttribute('fill')).toBe('#7a7a7a');
    }
  });

  it('includes the MAIN ST sign in the street scene', () => {
    const street = testImages.find((img) => img.id === 'street');
    expect(street).toBeDefined();
    if (!street) return;
    const texts = Array.from(parse(street).querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toContain('MAIN ST');
  });

  it('draws the pattern with 18 black Siemens star wedges of 10 degrees', () => {
    const pattern = testImages.find((img) => img.id === 'pattern');
    expect(pattern).toBeDefined();
    if (!pattern) return;
    const wedges = Array.from(parse(pattern).querySelectorAll('path')).filter((p) =>
      (p.getAttribute('d') ?? '').startsWith('M900 600 L'),
    );
    expect(wedges).toHaveLength(18);
  });

  it('builds a data:image/svg+xml URL that round-trips the svg', () => {
    for (const img of testImages) {
      const url = testImageDataUrl(img);
      expect(url.startsWith('data:image/svg+xml')).toBe(true);
      const payload = url.slice(url.indexOf(',') + 1);
      expect(decodeURIComponent(payload)).toBe(img.svg);
    }
  });
});
