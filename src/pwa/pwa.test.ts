import { describe, expect, it } from 'vitest';
import { BACKGROUND_COLOR, manifestConfig, PRECACHE_GLOBS, THEME_COLOR } from './manifest';
import { captureInstallPrompt, installEvent, promptInstall, type BeforeInstallPromptEvent } from './install';
import { needRefresh, setUpdater, updateApp } from './signals';

const publicFiles = Object.keys(import.meta.glob('../../public/icons/*', { query: '?url' }));

describe('manifestConfig', () => {
  it('is installable and sub-path safe', () => {
    expect(manifestConfig.name).toBe('Vision Simulator');
    expect(manifestConfig.short_name).toBe('Vision Sim');
    expect(manifestConfig.start_url).toBe('./');
    expect(manifestConfig.scope).toBe('./');
    expect(manifestConfig.display).toBe('standalone');
    expect(manifestConfig.orientation).toBeUndefined();
  });

  it('uses the dark app colours', () => {
    expect(THEME_COLOR).toBe('#000000');
    expect(manifestConfig.theme_color).toBe(THEME_COLOR);
    expect(manifestConfig.background_color).toBe(BACKGROUND_COLOR);
  });

  it('has relative icon URLs that exist in public/, including a maskable one', () => {
    const icons = manifestConfig.icons ?? [];
    expect(icons.some((i) => i.sizes === '192x192')).toBe(true);
    expect(icons.some((i) => i.sizes === '512x512' && i.purpose === 'any')).toBe(true);
    expect(icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const icon of icons) {
      expect(icon.src.startsWith('/')).toBe(false);
      expect(publicFiles).toContain(`../../public/${icon.src}`);
    }
  });

  it('precaches the required asset types', () => {
    const g = PRECACHE_GLOBS.join(' ');
    for (const ext of ['js', 'css', 'html', 'svg', 'png', 'woff2']) expect(g).toContain(ext);
  });
});

describe('install prompt capture', () => {
  it('captures, prompts once and clears', async () => {
    const target = new EventTarget();
    const stop = captureInstallPrompt(target);
    let prompted = 0;
    const ev = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: async () => {
        prompted++;
      },
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    }) as BeforeInstallPromptEvent;
    target.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(installEvent.value).toBe(ev);
    expect(await promptInstall()).toBe('accepted');
    expect(prompted).toBe(1);
    expect(installEvent.value).toBeNull();
    expect(await promptInstall()).toBeNull();
    stop();
  });

  it('clears on appinstalled and stops listening after cleanup', () => {
    const target = new EventTarget();
    const stop = captureInstallPrompt(target);
    target.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true }));
    expect(installEvent.value).not.toBeNull();
    target.dispatchEvent(new Event('appinstalled'));
    expect(installEvent.value).toBeNull();
    stop();
    target.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true }));
    expect(installEvent.value).toBeNull();
  });
});

describe('updateApp', () => {
  it('is a no-op without an updater and reloads through the updater otherwise', async () => {
    setUpdater(null);
    await expect(updateApp()).resolves.toBeUndefined();
    const calls: Array<boolean | undefined> = [];
    setUpdater(async (reload) => {
      calls.push(reload);
    });
    await updateApp();
    expect(calls).toEqual([true]);
    setUpdater(null);
    expect(needRefresh.value).toBe(false);
  });
});
