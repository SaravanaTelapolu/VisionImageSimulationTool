import { findRegion, updateRegion } from '../../../model/ops';
import type { Eye } from '../../../model/types';
import { activeTab, applyEdit, endEdit, profile, selectedRegionId } from '../../../state/store';
import { Segmented } from '../../controls/Segmented';
import { Slider } from '../../controls/Slider';
import './effects.css';
import {
  EFFECT_DEFS,
  EFFECT_GROUPS,
  FEATHER_DEF,
  FEATHER_FULL_NOTE,
  GHOST_DEF,
  GLOBAL_DEFS,
  SIZE_CHANGE_NOTE,
  VIEWING_DISTANCE_DEF,
  isEffectEnabled,
  isFeatherEnabled,
  type NumericGlobalKey,
} from './effectDefs';
import { setEffect, setEye, setFeather, setGhostOffset, setGlobal, setViewingDistance } from './edits';

const EYE_OPTIONS = [
  { value: 'left', label: 'Left eye' },
  { value: 'right', label: 'Right eye' },
] as const;

function GlobalSlider({ k }: { k: NumericGlobalKey }) {
  const def = GLOBAL_DEFS[k];
  return (
    <Slider
      {...def}
      value={profile.value.globals[k]}
      noReset
      onInput={(v) => applyEdit((p) => setGlobal(p, k, v), `globals:${k}`)}
      onCommit={endEdit}
    />
  );
}

function ProfileSettings() {
  const p = profile.value;
  return (
    <details class="fx-details">
      <summary class="fx-summary">Profile settings (all regions)</summary>
      <div class="fx-details-body">
        <GlobalSlider k="distortWaveSize" />
        <GlobalSlider k="distortAngle" />
        <GlobalSlider k="distortMaxAmplitude" />
        <Slider
          {...GHOST_DEF}
          label="Ghost offset, sideways (x)"
          value={p.globals.ghostOffset[0]}
          noReset
          help={GHOST_DEF.help}
          onInput={(v) => applyEdit((q) => setGhostOffset(q, 0, v), 'globals:ghostOffsetX')}
          onCommit={endEdit}
        />
        <Slider
          {...GHOST_DEF}
          label="Ghost offset, up/down (y)"
          value={p.globals.ghostOffset[1]}
          noReset
          help="Positive is down."
          onInput={(v) => applyEdit((q) => setGhostOffset(q, 1, v), 'globals:ghostOffsetY')}
          onCommit={endEdit}
        />
        <GlobalSlider k="darkSpotShade" />
        <Slider
          {...VIEWING_DISTANCE_DEF}
          value={p.viewingDistanceCm}
          noReset
          onInput={(v) => applyEdit((q) => setViewingDistance(q, v), 'globals:viewingDistanceCm')}
          onCommit={endEdit}
        />
        <Segmented<Eye>
          label="Profile eye"
          value={p.eye}
          options={EYE_OPTIONS}
          onChange={(eye) => applyEdit((q) => setEye(q, eye))}
        />
      </div>
    </details>
  );
}

export function EffectsPanel() {
  const p = profile.value;
  const id = selectedRegionId.value;
  const region = id ? findRegion(p, id) : undefined;

  if (!region) {
    return (
      <div class="fx-panel">
        <p class="fx-prompt">Select a region first, or add one, to change its effects.</p>
        <button type="button" class="fx-link" onClick={() => (activeTab.value = 'regions')}>
          ← Go to Regions
        </button>
        <ProfileSettings />
      </div>
    );
  }

  const shape = region.shape.type;
  const rid = region.id;

  return (
    <div class="fx-panel">
      <div class="fx-name">
        <label class="slider-label" for={`fx-name-${rid}`}>
          Region name
        </label>
        <input
          id={`fx-name-${rid}`}
          class="fx-name-input"
          type="text"
          value={region.name}
          maxLength={60}
          onInput={(e) => {
            const name = (e.currentTarget as HTMLInputElement).value;
            applyEdit((q) => updateRegion(q, rid, { name }), `name:${rid}`);
          }}
          onBlur={endEdit}
        />
      </div>

      <Slider
        {...FEATHER_DEF}
        key={`${rid}:feather`}
        value={region.feather}
        disabled={!isFeatherEnabled(shape)}
        help={isFeatherEnabled(shape) ? FEATHER_DEF.help : FEATHER_FULL_NOTE}
        onInput={(v) => applyEdit((q) => setFeather(q, rid, v), `effect:${rid}:feather`)}
        onCommit={endEdit}
      />

      {EFFECT_GROUPS.map((group) => (
        <section class="fx-group" key={group.id} aria-labelledby={`fx-g-${group.id}`}>
          <h3 class="fx-group-title" id={`fx-g-${group.id}`}>
            {group.title}
          </h3>
          {group.keys.map((key) => {
            const def = EFFECT_DEFS[key];
            const enabled = isEffectEnabled(key, shape);
            return (
              <Slider
                {...def}
                key={`${rid}:${key}`}
                value={region.effects[key]}
                disabled={!enabled}
                help={enabled ? def.help : SIZE_CHANGE_NOTE}
                onInput={(v) => applyEdit((q) => setEffect(q, rid, key, v), `effect:${rid}:${key}`)}
                onCommit={endEdit}
              />
            );
          })}
        </section>
      ))}

      <ProfileSettings />
    </div>
  );
}
