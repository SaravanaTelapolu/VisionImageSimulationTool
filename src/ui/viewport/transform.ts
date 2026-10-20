// Pure view maths for the image viewport (no DOM).
//
// A View is the zoom relative to "fit" (1 = whole image visible, up to MAX_ZOOM) plus a
// translation. Screen coordinates are CSS pixels relative to the viewport box's top-left:
//   screen = image * scale + (tx, ty),   scale = fitScale * zoom.

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface View {
  zoom: number;
  tx: number;
  ty: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

/** Scale at which the whole image fits inside the box. */
export function fitScale(image: Size, box: Size): number {
  if (!(image.width > 0) || !(image.height > 0) || !(box.width > 0) || !(box.height > 0)) return 1;
  return Math.min(box.width / image.width, box.height / image.height);
}

/** Screen pixels per image pixel. */
export function viewScale(view: View, image: Size, box: Size): number {
  return fitScale(image, box) * view.zoom;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function clampAxis(t: number, content: number, boxLen: number): number {
  if (content <= boxLen) return (boxLen - content) / 2; // smaller than the box: centre it
  return Math.min(0, Math.max(boxLen - content, t)); // larger: never show a gap at an edge
}

/** Clamps zoom to the allowed range and keeps the image covering the box (or centred when smaller). */
export function clampView(view: View, image: Size, box: Size): View {
  const zoom = clampZoom(view.zoom);
  const s = fitScale(image, box) * zoom;
  return {
    zoom,
    tx: clampAxis(view.tx, image.width * s, box.width),
    ty: clampAxis(view.ty, image.height * s, box.height),
  };
}

/** The whole image visible and centred. */
export function fitView(image: Size, box: Size): View {
  return clampView({ zoom: MIN_ZOOM, tx: 0, ty: 0 }, image, box);
}

export function screenToImage(view: View, image: Size, box: Size, p: Point): Point {
  const s = viewScale(view, image, box);
  return { x: (p.x - view.tx) / s, y: (p.y - view.ty) / s };
}

export function imageToScreen(view: View, image: Size, box: Size, p: Point): Point {
  const s = viewScale(view, image, box);
  return { x: p.x * s + view.tx, y: p.y * s + view.ty };
}

/** Sets the zoom (clamped) so the image point under `anchor` (screen px) stays under it. */
export function zoomTo(view: View, image: Size, box: Size, zoom: number, anchor: Point): View {
  const anchorImage = screenToImage(view, image, box, anchor);
  const z = clampZoom(zoom);
  const s = fitScale(image, box) * z;
  return clampView(
    { zoom: z, tx: anchor.x - anchorImage.x * s, ty: anchor.y - anchorImage.y * s },
    image,
    box,
  );
}

/** Multiplies the zoom by `factor` about a screen point. */
export function zoomAbout(view: View, image: Size, box: Size, factor: number, anchor: Point): View {
  return zoomTo(view, image, box, view.zoom * factor, anchor);
}

/** Pans by a screen-space delta, clamped. */
export function panBy(view: View, image: Size, box: Size, dx: number, dy: number): View {
  return clampView({ zoom: view.zoom, tx: view.tx + dx, ty: view.ty + dy }, image, box);
}
