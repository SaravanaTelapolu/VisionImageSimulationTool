import { useEffect, useMemo, useState } from 'preact/hooks';
import { rasterizeTestImage, testImages } from '../assets/testImages';
import type { Profile } from '../model/types';
import { loadAllProfiles } from '../state/profiles';
import { renderWithProfile } from '../state/render';
import { image } from '../state/store';
import { closeTimeline } from '../state/ui';
import { TimelineView, type TimelineSource } from './panels/profiles';

const FALLBACK_TEST_IMAGE = 'amsler';
const FALLBACK_SIDE = 1024;

/**
 * Overlay that loads every saved profile and shows the timeline. The picture is the current photo
 * (labelled with its name); with no photo it starts from the Amsler grid. Mount only while open.
 */
export function TimelineHost() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [fallback, setFallback] = useState<TimelineSource | null>(null);
  const img = image.value;

  useEffect(() => {
    let cancelled = false;
    void loadAllProfiles().then((list) => {
      if (!cancelled) setProfiles(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // No photo yet: prepare a test image so the view has a picture to start from.
  useEffect(() => {
    if (img) return;
    const def = testImages.find((t) => t.id === FALLBACK_TEST_IMAGE);
    if (!def) return;
    let cancelled = false;
    void rasterizeTestImage(def, FALLBACK_SIDE).then((c) => {
      if (!cancelled) setFallback({ image: c, width: c.width, height: c.height, label: def.name });
    });
    return () => {
      cancelled = true;
    };
  }, [img]);

  const source = useMemo<TimelineSource | null>(
    () => (img ? { image: img.working, width: img.width, height: img.height, label: img.name } : fallback),
    [img, fallback],
  );

  if (!profiles || !source) {
    return (
      <div class="tl" role="status" aria-label="Loading timeline">
        <p class="pf-hint">Loading…</p>
      </div>
    );
  }
  return <TimelineView profiles={profiles} source={source} renderWithProfile={renderWithProfile} onClose={closeTimeline} />;
}
