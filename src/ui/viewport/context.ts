import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Point, Size, View } from './transform';

/** What overlay content needs to draw in image coordinates and keep handles a constant screen size. */
export interface ViewportInfo {
  /** Image size in image pixels (overlay user units). */
  image: Size;
  /** Viewport box in CSS pixels. */
  box: Size;
  view: View;
  /** Screen (CSS) pixels per image pixel. */
  scale: number;
  /** Converts a length in screen CSS pixels to overlay user units (image pixels): `px(44)` is a 44 px hit area. */
  px: (screenPx: number) => number;
  /** Converts pointer client coordinates to image pixels. */
  clientToImage: (clientX: number, clientY: number) => Point;
}

export const ViewportContext = createContext<ViewportInfo | null>(null);

export function useViewport(): ViewportInfo | null {
  return useContext(ViewportContext);
}
