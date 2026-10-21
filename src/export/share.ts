export type ExportKind = 'simulated' | 'original' | 'side-by-side';

export interface ExportFileNameOptions {
  profileName?: string;
  date: Date;
  kind: ExportKind;
  ext: 'png' | 'jpg';
}

export function slugify(text: string, maxLen = 40): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/, '');
}

const two = (n: number): string => String(n).padStart(2, '0');

/** e.g. "vision-sim_2026-10-20_right-eye_simulated.png" (profile part omitted when empty). */
export function exportFileName(o: ExportFileNameOptions): string {
  const d = `${o.date.getFullYear()}-${two(o.date.getMonth() + 1)}-${two(o.date.getDate())}`;
  const slug = slugify(o.profileName ?? '');
  const parts = ['vision-sim', d, ...(slug ? [slug] : []), o.kind];
  return `${parts.join('_')}.${o.ext}`;
}

export interface ShareFile {
  blob: Blob;
  name: string;
}

function download(files: ShareFile[]): void {
  for (const f of files) {
    const url = URL.createObjectURL(f.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke once the browser has started the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

/**
 * Uses the phone's share sheet when it can share files, otherwise downloads each file.
 * A dismissed share sheet gives 'cancelled'; any other share failure falls back to downloading.
 */
export async function shareOrDownload(
  files: ShareFile[],
  title: string,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator;
  if (nav && typeof nav.share === 'function' && typeof nav.canShare === 'function') {
    const shareFiles = files.map((f) => new File([f.blob], f.name, { type: f.blob.type }));
    if (nav.canShare({ files: shareFiles })) {
      try {
        await nav.share({ files: shareFiles, title });
        return 'shared';
      } catch (e) {
        if (isAbort(e)) return 'cancelled';
        // Otherwise fall through to download (e.g. NotAllowedError once the tap has expired).
      }
    }
  }
  download(files);
  return 'downloaded';
}
