import { testImages } from '../../../assets/testImages';
import { image, loadTestImage, photoLoading } from '../../../state/store';
import { COMPARE_MODES, compareMode, openCalibration, openPresent, openTimeline, type CompareMode } from '../../../state/ui';
import { Segmented } from '../../controls/Segmented';
import './compare.css';

const MODE_LABELS: Record<CompareMode, string> = {
  single: 'Single',
  wipe: 'Wipe',
  side: 'Side by side',
};

const MODE_HELP: Record<CompareMode, string> = {
  single: 'One view at a time. Use the flip button at the top to switch between original and simulated.',
  wipe: 'Drag the divider across the photo: original on the left, simulated on the right.',
  side: 'Original and simulated together. Switch back to Single to edit regions.',
};

const MODE_OPTIONS = COMPARE_MODES.map((value) => ({ value, label: MODE_LABELS[value] }));

/** Compare tab: how original and simulated are shown, presenting, the timeline and test images. */
export function ComparePanel() {
  const mode = compareMode.value;
  const hasImage = image.value !== null;
  const loading = photoLoading.value;
  return (
    <div class="cmp">
      <div class="cmp-group">
        <Segmented
          label="View"
          value={mode}
          options={MODE_OPTIONS}
          onChange={(m) => {
            compareMode.value = m;
          }}
        />
        <p class="cmp-help">{MODE_HELP[mode]}</p>
      </div>

      <div class="cmp-group">
        <button type="button" class="cmp-btn cmp-btn-primary" disabled={!hasImage} onClick={openPresent}>
          Present full screen
        </button>
        <button type="button" class="cmp-btn" onClick={openTimeline}>
          Timeline
        </button>
        <button type="button" class="cmp-btn" onClick={openCalibration}>
          Calibration guide
        </button>
      </div>

      <div class="cmp-group">
        <h3 class="cmp-heading">Test images</h3>
        <div class="cmp-grid">
          {testImages.map((t) => (
            <button
              key={t.id}
              type="button"
              class="cmp-btn"
              disabled={loading}
              title={t.description}
              onClick={() => void loadTestImage(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
