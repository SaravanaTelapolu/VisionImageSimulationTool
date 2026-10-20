import { describe, expect, it } from 'vitest';
import { migrateProfile, parseProfileJson, serializeProfile, validateProfile } from './validate';
import { PROFILE_VERSION, type Profile } from './types';
import { defaultGlobals, emptyEffects } from './defaults';

/** The sample from docs/Vision-Simulator-Plan.md (Data model). */
const planSample = () => ({
  version: 1,
  id: 'p-2026-10-16',
  name: 'Right eye, October 2026',
  eye: 'right',
  createdAt: '2026-10-16T18:00:00Z',
  viewingDistanceCm: 40,
  note: 'Before second treatment session',
  globals: { distortWaveSize: 0.05, distortAngle: 30, ghostOffset: [0.01, 0] },
  regions: [
    {
      id: 'r1',
      name: 'Central scar',
      visible: true,
      shape: { type: 'ellipse', cx: 0.05, cy: -0.02, rx: 0.12, ry: 0.09, rotation: 15 },
      feather: 0.4,
      effects: { blur: 18, darkSpot: 0.6, fillIn: 0, distortion: 0.3, sizeChange: 0, contrastLoss: 0.4, dimming: 0.2, colourFade: 0, doubleImage: 0 },
    },
  ],
});

/** A complete, valid profile that should validate with zero warnings. */
function fullProfile(): Profile {
  return {
    version: 1,
    id: 'p1',
    name: 'Full',
    eye: 'left',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    viewingDistanceCm: 35,
    note: 'hello',
    globals: { ...defaultGlobals(), distortAngle: 45 },
    regions: [
      { id: 'a', name: 'A', visible: true, feather: 0.2, effects: { ...emptyEffects(), blur: 10 }, shape: { type: 'ellipse', cx: 0, cy: 0, rx: 0.1, ry: 0.1, rotation: 0 } },
      { id: 'b', name: 'B', visible: false, feather: 0, effects: emptyEffects(), shape: { type: 'path', points: [[0, 0], [1, 0], [0, 1]] } },
      { id: 'c', name: 'C', visible: true, feather: 1, effects: emptyEffects(), shape: { type: 'mask', dataUrl: 'data:image/png;base64,AAAA', x: -0.1, y: -0.1, width: 0.2, height: 0.2 } },
      { id: 'd', name: 'D', visible: true, feather: 0.5, effects: emptyEffects(), shape: { type: 'full' } },
    ],
  };
}

function ok(input: unknown) {
  const r = validateProfile(input);
  if (!r.ok) throw new Error('expected ok, got errors: ' + r.errors.join(' | '));
  return r;
}
function fail(input: unknown) {
  const r = validateProfile(input);
  if (r.ok) throw new Error('expected failure');
  return r.errors;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mutate = (f: (p: any) => void) => {
  const p = JSON.parse(JSON.stringify(fullProfile()));
  f(p);
  return p;
};

describe('validateProfile: valid input', () => {
  it('accepts a complete profile unchanged with no warnings', () => {
    const r = ok(fullProfile());
    expect(r.warnings).toEqual([]);
    expect(r.profile).toEqual(fullProfile());
  });

  it('accepts the sample from the plan and fills the gaps with warnings', () => {
    const r = ok(planSample());
    const p = r.profile;
    expect(p.version).toBe(PROFILE_VERSION);
    expect(p.id).toBe('p-2026-10-16');
    expect(p.updatedAt).toBe(p.createdAt);
    expect(p.globals).toEqual({ ...defaultGlobals(), distortWaveSize: 0.05, distortAngle: 30, ghostOffset: [0.01, 0] });
    expect(p.regions[0]!.effects.blur).toBe(18);
    expect(p.regions[0]!.shape).toEqual({ type: 'ellipse', cx: 0.05, cy: -0.02, rx: 0.12, ry: 0.09, rotation: 15 });
    expect(r.warnings.some((w) => w.includes('updatedAt'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('globals.distortMaxAmplitude'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('globals.darkSpotShade'))).toBe(true);
  });

  it('does not mutate its input', () => {
    const input = planSample();
    const copy = JSON.parse(JSON.stringify(input));
    ok(input);
    expect(input).toEqual(copy);
  });

  it('round-trips through serialize and parse', () => {
    const p = fullProfile();
    const text = serializeProfile(p);
    expect(text).toContain('\n  "id"');
    const r = parseProfileJson(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.profile).toEqual(p);
      expect(r.warnings).toEqual([]);
    }
  });

  it('accepts an empty regions array', () => {
    expect(ok(mutate((p) => (p.regions = []))).profile.regions).toEqual([]);
  });
});

describe('validateProfile: errors', () => {
  it.each([null, undefined, 5, 'x', true, [], [1, 2]])('rejects non-object input %j', (v) => {
    expect(fail(v).length).toBeGreaterThan(0);
  });

  it('rejects a missing or empty profile id', () => {
    expect(fail(mutate((p) => delete p.id)).join()).toContain('id');
    expect(fail(mutate((p) => (p.id = ''))).join()).toContain('id');
    expect(fail(mutate((p) => (p.id = 7))).join()).toContain('id');
  });

  it('rejects missing or non-array regions', () => {
    expect(fail(mutate((p) => delete p.regions)).join()).toContain('regions');
    expect(fail(mutate((p) => (p.regions = {}))).join()).toContain('regions');
  });

  it('rejects a region that is not an object or has no id', () => {
    expect(fail(mutate((p) => (p.regions[0] = 3))).join()).toContain('regions[0]');
    expect(fail(mutate((p) => delete p.regions[1].id)).join()).toContain('regions[1].id');
  });

  it('rejects an unknown or missing shape type', () => {
    expect(fail(mutate((p) => (p.regions[0].shape = { type: 'star' }))).join()).toContain('unknown shape type');
    expect(fail(mutate((p) => delete p.regions[0].shape)).join()).toContain('shape');
    expect(fail(mutate((p) => (p.regions[0].shape = 'ellipse'))).join()).toContain('shape');
  });

  it('rejects ellipses with missing or non-numeric geometry', () => {
    expect(fail(mutate((p) => delete p.regions[0].shape.cx)).join()).toContain('cx');
    expect(fail(mutate((p) => (p.regions[0].shape.rx = 'big'))).join()).toContain('rx');
    expect(fail(mutate((p) => (p.regions[0].shape.cy = null))).join()).toContain('cy');
  });

  it('rejects paths with fewer than 3 points or bad points', () => {
    expect(fail(mutate((p) => (p.regions[1].shape.points = [[0, 0], [1, 1]]))).join()).toContain('at least 3');
    expect(fail(mutate((p) => (p.regions[1].shape.points = 'abc'))).join()).toContain('points');
    expect(fail(mutate((p) => (p.regions[1].shape.points = [[0, 0], [1, 1], ['a', 2]]))).join()).toContain('points[2]');
    expect(fail(mutate((p) => (p.regions[1].shape.points = [[0, 0], [1, 1], [2]]))).join()).toContain('points[2]');
  });

  it('rejects masks with a bad data URL or missing geometry', () => {
    expect(fail(mutate((p) => (p.regions[2].shape.dataUrl = 'http://evil/x.png'))).join()).toContain('dataUrl');
    expect(fail(mutate((p) => delete p.regions[2].shape.dataUrl)).join()).toContain('dataUrl');
    expect(fail(mutate((p) => delete p.regions[2].shape.width)).join()).toContain('width');
  });

  it('rejects versions newer than this app understands', () => {
    const errs = fail(mutate((p) => (p.version = PROFILE_VERSION + 1)));
    expect(errs.join()).toMatch(/version/i);
  });

  it('rejects an invalid version value', () => {
    expect(fail(mutate((p) => (p.version = 'one'))).join()).toContain('version');
    expect(fail(mutate((p) => (p.version = 0))).join()).toContain('version');
    expect(fail(mutate((p) => (p.version = 1.5))).join()).toContain('version');
  });

  it('collects several errors at once', () => {
    const errs = fail(mutate((p) => {
      delete p.id;
      p.regions[0].shape = { type: 'nope' };
      delete p.regions[1].id;
    }));
    expect(errs.length).toBeGreaterThanOrEqual(3);
  });
});

describe('validateProfile: clamping', () => {
  it('clamps effect values into their ranges with warnings', () => {
    const r = ok(mutate((p) => {
      Object.assign(p.regions[0].effects, {
        blur: 99,
        darkSpot: 2,
        fillIn: -1,
        distortion: 1.5,
        sizeChange: -5,
        contrastLoss: 3,
        dimming: -0.1,
        colourFade: 7,
        doubleImage: 9,
      });
    }));
    expect(r.profile.regions[0]!.effects).toEqual({
      blur: 40,
      darkSpot: 1,
      fillIn: 0,
      distortion: 1,
      sizeChange: -0.3,
      contrastLoss: 1,
      dimming: 0,
      colourFade: 1,
      doubleImage: 1,
    });
    expect(r.warnings).toHaveLength(9);
  });

  it('clamps positive sizeChange and negative blur', () => {
    const r = ok(mutate((p) => {
      p.regions[0].effects.sizeChange = 0.9;
      p.regions[0].effects.blur = -4;
    }));
    expect(r.profile.regions[0]!.effects.sizeChange).toBe(0.3);
    expect(r.profile.regions[0]!.effects.blur).toBe(0);
  });

  it('clamps feather into 0..1', () => {
    const r = ok(mutate((p) => {
      p.regions[0].feather = 5;
      p.regions[1].feather = -1;
    }));
    expect(r.profile.regions[0]!.feather).toBe(1);
    expect(r.profile.regions[1]!.feather).toBe(0);
    expect(r.warnings.some((w) => w.includes('feather'))).toBe(true);
  });

  it('raises non-positive ellipse radii to a small positive value', () => {
    const r = ok(mutate((p) => {
      p.regions[0].shape.rx = 0;
      p.regions[0].shape.ry = -0.3;
    }));
    const s = r.profile.regions[0]!.shape;
    expect(s.type === 'ellipse' && s.rx > 0 && s.ry > 0).toBe(true);
    expect(r.warnings.filter((w) => /\.r[xy]/.test(w))).toHaveLength(2);
  });

  it('raises non-positive mask sizes', () => {
    const r = ok(mutate((p) => {
      p.regions[2].shape.width = 0;
      p.regions[2].shape.height = -1;
    }));
    const s = r.profile.regions[2]!.shape;
    expect(s.type === 'mask' && s.width > 0 && s.height > 0).toBe(true);
  });

  it('clamps globals', () => {
    const r = ok(mutate((p) => {
      p.globals.darkSpotShade = 4;
      p.globals.distortMaxAmplitude = -1;
      p.globals.ghostOffset = [5, -5];
      p.globals.distortWaveSize = 0;
    }));
    expect(r.profile.globals.darkSpotShade).toBe(1);
    expect(r.profile.globals.distortMaxAmplitude).toBe(0);
    expect(r.profile.globals.ghostOffset).toEqual([1, -1]);
    expect(r.profile.globals.distortWaveSize).toBeGreaterThan(0);
  });
});

describe('validateProfile: defaults and cleanup', () => {
  it('fills missing optional profile fields with warnings', () => {
    const r = ok(mutate((p) => {
      delete p.updatedAt;
      delete p.note;
      delete p.name;
      delete p.eye;
      delete p.viewingDistanceCm;
      delete p.globals;
    }));
    expect(r.profile.updatedAt).toBe(r.profile.createdAt);
    expect(r.profile.note).toBe('');
    expect(r.profile.name.length).toBeGreaterThan(0);
    expect(r.profile.eye).toBe('right');
    expect(r.profile.viewingDistanceCm).toBe(40);
    expect(r.profile.globals).toEqual(defaultGlobals());
    for (const f of ['updatedAt', 'note', 'name', 'eye', 'viewingDistanceCm', 'globals']) {
      expect(r.warnings.some((w) => w.startsWith(f))).toBe(true);
    }
  });

  it('fills each missing globals field individually', () => {
    const r = ok(mutate((p) => (p.globals = { distortAngle: 90 })));
    expect(r.profile.globals).toEqual({ ...defaultGlobals(), distortAngle: 90 });
  });

  it('falls back on a wrong-typed ghostOffset', () => {
    const r = ok(mutate((p) => (p.globals.ghostOffset = [1])));
    expect(r.profile.globals.ghostOffset).toEqual(defaultGlobals().ghostOffset);
  });

  it('fills a missing or invalid createdAt', () => {
    const r = ok(mutate((p) => (p.createdAt = 'yesterday')));
    expect(Number.isNaN(Date.parse(r.profile.createdAt))).toBe(false);
    expect(r.warnings.some((w) => w.startsWith('createdAt'))).toBe(true);
  });

  it('treats missing effect keys and a missing effects object as 0', () => {
    const r = ok(mutate((p) => {
      delete p.regions[0].effects.blur;
      p.regions[0].effects.dimming = 'lots';
      delete p.regions[1].effects;
    }));
    expect(r.profile.regions[0]!.effects).toEqual({ ...emptyEffects(), darkSpot: 0, blur: 0, dimming: 0 });
    expect(r.profile.regions[1]!.effects).toEqual(emptyEffects());
    expect(r.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it('fills missing region name, visible and feather', () => {
    const r = ok(mutate((p) => {
      delete p.regions[0].name;
      delete p.regions[0].visible;
      delete p.regions[0].feather;
    }));
    const reg = r.profile.regions[0]!;
    expect(reg.name).toBe('Region');
    expect(reg.visible).toBe(true);
    expect(reg.feather).toBe(0.3);
  });

  it('fills a missing ellipse rotation with 0', () => {
    const r = ok(mutate((p) => delete p.regions[0].shape.rotation));
    expect(r.profile.regions[0]!.shape).toMatchObject({ rotation: 0 });
  });

  it('strips unknown keys at every level', () => {
    const r = ok(mutate((p) => {
      p.extra = 1;
      p.globals.extra = 2;
      p.regions[0].extra = 3;
      p.regions[0].effects.extra = 4;
      p.regions[0].shape.extra = 5;
      p.regions[1].shape.extra = 5;
      p.regions[2].shape.extra = 5;
      p.regions[3].shape.extra = 5;
    }));
    expect(JSON.stringify(r.profile)).not.toContain('extra');
    expect(r.profile).toEqual(fullProfile());
  });

  it('replaces duplicate region ids and warns', () => {
    const r = ok(mutate((p) => (p.regions[1].id = 'a')));
    const ids = r.profile.regions.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('a');
    expect(r.warnings.some((w) => w.includes('used twice'))).toBe(true);
  });

  it('keeps path points as fresh pairs (drops extra tuple entries)', () => {
    const r = ok(mutate((p) => (p.regions[1].shape.points = [[0, 0, 9], [1, 0], [0, 1]])));
    expect(r.profile.regions[1]!.shape).toEqual({ type: 'path', points: [[0, 0], [1, 0], [0, 1]] });
  });
});

describe('migrateProfile', () => {
  it('passes v1 through', () => {
    const m = migrateProfile(fullProfile());
    expect(m.ok).toBe(true);
    if (m.ok) {
      expect(m.data['version']).toBe(PROFILE_VERSION);
      expect(m.warnings).toEqual([]);
    }
  });

  it('treats a missing version as v1 with a warning', () => {
    const input = mutate((p) => delete p.version);
    const m = migrateProfile(input);
    expect(m.ok).toBe(true);
    if (m.ok) expect(m.warnings.join()).toContain('version');
    expect(ok(input).profile.version).toBe(PROFILE_VERSION);
  });

  it('rejects future versions and non-objects', () => {
    expect(migrateProfile({ version: 99 }).ok).toBe(false);
    expect(migrateProfile(null).ok).toBe(false);
  });

  it('does not mutate the input', () => {
    const input = Object.freeze({ ...fullProfile() });
    expect(() => migrateProfile(input)).not.toThrow();
  });
});

describe('parseProfileJson', () => {
  it('parses valid JSON', () => {
    expect(parseProfileJson(JSON.stringify(planSample())).ok).toBe(true);
  });

  it('gives a friendly error for bad JSON', () => {
    const r = parseProfileJson('{not json');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(/not valid JSON/i);
      expect(r.errors[0]).not.toMatch(/Unexpected token/);
    }
  });

  it('reports validation errors for JSON that is not a profile', () => {
    expect(parseProfileJson('[]').ok).toBe(false);
    expect(parseProfileJson('42').ok).toBe(false);
    expect(parseProfileJson('{}').ok).toBe(false);
  });
});

describe('serializeProfile', () => {
  it('produces pretty JSON that parses back', () => {
    const p = fullProfile();
    const text = serializeProfile(p);
    expect(text.split('\n').length).toBeGreaterThan(10);
    expect(JSON.parse(text)).toEqual(p);
  });
});
