// Small pure helpers for dates and file names, shared by profiles.ts and transfer.ts.

/** yyyy-mm-dd in the device's local time zone. */
export function formatLocalDate(d: Date): string {
  const y = String(d.getFullYear()).padStart(4, '0');
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Lower-case, ASCII, dash-separated; never empty. */
export function slugify(text: string, fallback = 'profile', maxLength = 40): string {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return s === '' ? fallback : s;
}
