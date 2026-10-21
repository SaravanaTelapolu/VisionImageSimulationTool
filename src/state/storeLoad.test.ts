import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function defer<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

const pending = new Map<string, Deferred<unknown>>();

vi.mock('../image/load', () => ({
  loadWorkingImage: vi.fn((file: File) => {
    const d = defer<unknown>();
    pending.set(file.name, d);
    return d.promise;
  }),
}));
vi.mock('../assets/testImages', () => ({
  testImages: [{ id: 'amsler', name: 'Amsler grid' }],
  rasterizeTestImage: vi.fn(() => {
    const d = defer<unknown>();
    pending.set('test:amsler', d);
    return d.promise;
  }),
}));

import {
  BITMAP_CLOSE_DELAY_MS,
  GENERIC_PHOTO_ERROR,
  HEIC_ERROR,
  activityCount,
  applyEdit,
  image,
  loadPhoto,
  loadTestImage,
  photoError,
  photoLoading,
  resetProfile,
  setWorkingImage,
} from './store';

// Node 18 has no File; the store only reads name and type.
const file = (name: string, type = 'image/jpeg'): File => ({ name, type }) as unknown as File;
const bitmap = () => ({ close: vi.fn(), width: 10, height: 10 });
const decoded = (b: unknown, f: File) => ({ original: f, working: b, width: 10, height: 10 });

beforeEach(() => {
  vi.useFakeTimers();
  pending.clear();
  image.value = null;
  photoError.value = '';
  photoLoading.value = false;
});
afterEach(() => vi.useRealTimers());

describe('image loading is latest-wins (M3)', () => {
  it('a slow earlier photo cannot replace a later test image', async () => {
    const slowBmp = bitmap();
    const slow = loadPhoto(file('slow.jpg'));
    const test = loadTestImage('amsler');
    expect(photoLoading.value).toBe(true);

    const canvas = { width: 20, height: 20 };
    pending.get('test:amsler')!.resolve(canvas);
    expect(await test).toBe(true);
    expect(image.value?.name).toBe('Amsler grid');
    // The newest request finished but the stale one is still running.
    expect(photoLoading.value).toBe(true);

    pending.get('slow.jpg')!.resolve(decoded(slowBmp, file('slow.jpg')));
    expect(await slow).toBe(false);
    expect(image.value?.name).toBe('Amsler grid');
    expect(slowBmp.close).toHaveBeenCalledTimes(1); // the discarded bitmap is released
    expect(photoLoading.value).toBe(false);
  });

  it('the last photo requested wins even when it finishes first', async () => {
    const a = loadPhoto(file('a.jpg'));
    const b = loadPhoto(file('b.jpg'));
    pending.get('b.jpg')!.resolve(decoded(bitmap(), file('b.jpg')));
    await b;
    pending.get('a.jpg')!.resolve(decoded(bitmap(), file('a.jpg')));
    await a;
    expect(image.value?.name).toBe('b.jpg');
    expect(photoLoading.value).toBe(false);
  });

  it('a stale failure does not show an error, and a failure clears the loading flag', async () => {
    const a = loadPhoto(file('a.jpg'));
    const b = loadPhoto(file('b.jpg'));
    pending.get('a.jpg')!.reject(new Error('nope'));
    expect(await a).toBe(false);
    expect(photoError.value).toBe('');
    expect(photoLoading.value).toBe(true);
    pending.get('b.jpg')!.reject(new Error('nope'));
    expect(await b).toBe(false);
    expect(photoError.value).toBe(GENERIC_PHOTO_ERROR);
    expect(photoLoading.value).toBe(false);
  });

  it('setWorkingImage cancels a photo that is still loading', async () => {
    const slow = loadPhoto(file('slow.jpg'));
    setWorkingImage({} as CanvasImageSource, 5, 5, 'direct');
    pending.get('slow.jpg')!.resolve(decoded(bitmap(), file('slow.jpg')));
    expect(await slow).toBe(false);
    expect(image.value?.name).toBe('direct');
    expect(photoLoading.value).toBe(false);
  });
});

describe('photo errors (L6)', () => {
  it('names the HEIC problem and how to fix it', async () => {
    const p = loadPhoto(file('IMG_0001.HEIC', ''));
    pending.get('IMG_0001.HEIC')!.reject(new Error('decode'));
    expect(await p).toBe(false);
    expect(photoError.value).toBe(HEIC_ERROR);
    expect(photoError.value).toMatch(/Most Compatible/);
  });

  it('recognises HEIC by mime type too, and gives a generic message otherwise', async () => {
    const h = loadPhoto(file('photo', 'image/heif'));
    pending.get('photo')!.reject(new Error('x'));
    await h;
    expect(photoError.value).toBe(HEIC_ERROR);
    const g = loadPhoto(file('broken.jpg'));
    pending.get('broken.jpg')!.reject(new Error('x'));
    await g;
    expect(photoError.value).toBe(GENERIC_PHOTO_ERROR);
  });

  it('clears the error when a later load starts', () => {
    photoError.value = 'old';
    void loadPhoto(file('next.jpg'));
    expect(photoError.value).toBe('');
  });
});

describe('replaced bitmaps are closed (L4)', () => {
  it('closes the previous working bitmap after a delay, not the current one', () => {
    const first = bitmap();
    const second = bitmap();
    setWorkingImage(first as unknown as CanvasImageSource, 10, 10, 'one');
    setWorkingImage(second as unknown as CanvasImageSource, 10, 10, 'two');
    expect(first.close).not.toHaveBeenCalled(); // views may still be drawing it
    vi.advanceTimersByTime(BITMAP_CLOSE_DELAY_MS + 1);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).not.toHaveBeenCalled();
  });

  it('does not close a bitmap that is reused', () => {
    const a = bitmap();
    setWorkingImage(a as unknown as CanvasImageSource, 10, 10, 'one');
    setWorkingImage(a as unknown as CanvasImageSource, 10, 10, 'again');
    vi.advanceTimersByTime(BITMAP_CLOSE_DELAY_MS + 1);
    expect(a.close).not.toHaveBeenCalled();
  });
});

describe('activityCount (M2)', () => {
  it('moves on edits, profile resets and load requests', () => {
    const n0 = activityCount();
    applyEdit((p) => ({ ...p, name: 'zzz' }));
    const n1 = activityCount();
    expect(n1).toBeGreaterThan(n0);
    resetProfile();
    const n2 = activityCount();
    expect(n2).toBeGreaterThan(n1);
    void loadPhoto(file('x.jpg'));
    expect(activityCount()).toBeGreaterThan(n2);
  });
});
