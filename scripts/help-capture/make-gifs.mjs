// Turns the screen recordings made by capture.spec.ts into captioned, looping GIFs for the Help
// page and the README. Each recording <name>.webm has a <name>.json with
// { start, end, captions: [{ at, text }] } (seconds from the start of the video).
// Needs ffmpeg on the PATH. Run: node scripts/help-capture/make-gifs.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const RAW = join(here, 'out');
const DEST = join(here, '..', '..', 'public', 'help', 'media');

const WIDTH = 360; // GIF width in px (phone recordings are 390 css px wide)
const FPS = 10;
const BAR = 58; // caption bar height
const FONT = process.platform === 'win32' ? 'C\\:/Windows/Fonts/segoeuib.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

/** Escapes text for an ffmpeg drawtext textfile-free `text=` value. */
function esc(text) {
  return text.replace(/\\/g, '\\\\').replace(/'/g, '\u2019').replace(/:/g, '\\:').replace(/%/g, '\\%').replace(/,/g, '\\,');
}

mkdirSync(DEST, { recursive: true });
const only = process.argv.slice(2);
for (const file of readdirSync(RAW).filter((f) => f.endsWith('.webm'))) {
  const name = file.replace(/\.webm$/, '');
  if (only.length && !only.includes(name)) continue;
  const metaPath = join(RAW, `${name}.json`);
  if (!existsSync(metaPath)) continue;
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const caps = meta.captions;
  const draw = caps.map((c, i) => {
    const from = Math.max(0, c.at - meta.start);
    const to = i + 1 < caps.length ? caps[i + 1].at - meta.start : 1e6;
    return (
      `drawtext=fontfile='${FONT}':text='${esc(c.text)}':fontcolor=0xffd54a:fontsize=19:` +
      `x=(w-text_w)/2:y=(${BAR}-text_h)/2:enable='between(t\\,${from.toFixed(2)}\\,${to.toFixed(2)})'`
    );
  });
  const chain = [
    `fps=${FPS}`,
    `scale=${WIDTH}:-2:flags=lanczos`,
    `pad=iw:ih+${BAR}:0:${BAR}:color=0x111111`,
    ...draw,
    'split[a][b]',
  ].join(',');
  const filter = `${chain};[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
  const out = join(DEST, `${name}.gif`);
  execFileSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-ss', String(meta.start), '-to', String(meta.end), '-i', join(RAW, file), '-filter_complex', filter, '-loop', '0', out],
    { stdio: 'inherit' },
  );
  console.log(`${name}.gif  ${(statSync(out).size / 1024).toFixed(0)} KB`);
}
writeFileSync(join(RAW, '.done'), new Date().toISOString());
