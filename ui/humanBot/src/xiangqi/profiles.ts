import { compileProfile, MODEL_VERSION, nominalControls } from '../controls';
import type { CompiledProfile, ProfileSpec, ScalarId } from '../types';
import { XIANGQI_MANIFEST } from './knowledge';

export const PROFILE_FAMILIES: Readonly<Record<string, Partial<Record<ScalarId, number>>>> = {
  neutral: {},
  attacker: { S01: 0.85, S03: 0.25, S04: 0.8, P01: 0.75, A01: 0.3, K04: 0.7 },
  defender: { A01: 0.85, A02: 0.8, C04: 0.85, K06: 0.85, S03: 0.8, T01: 0.7, S06: 0.8 },
  familiarist: { K02: 0.9, K05: 0.8, T03: 0.9, T04: 0.8, C02: 0.25, X08: 0.65 },
  technician: { S05: 0.85, P01: 0.65, T02: 0.75, C04: 0.7, S01: 0.35 },
  explorer: { C02: 0.9, C03: 0.75, C05: 0.9, P03: 0.9, S04: 0.75, T02: 0.8 },
  resister: { X07: 0.98, X06: 0.8, S01: 0.65, T01: 0.8, A02: 0.7, S03: 0.25 },
  // Maximum available knowledge and calculation resources, without turning
  // underconfidence, persistence or stylistic preferences into "strength" knobs.
  // This is a diagnostic profile, not a calibrated high-rated player.
  advanced: {
    K02: 1,
    K04: 1,
    K05: 1,
    K06: 1,
    A01: 0.7,
    A02: 0.7,
    A03: 1,
    A04: 0.35,
    C01: 1,
    C02: 1,
    C03: 1,
    C04: 1,
    C05: 1,
    C06: 1,
    P01: 0.4,
    P02: 1,
    P03: 0.6,
    P04: 0.25,
    T01: 0.5,
    T02: 0.65,
    T03: 1,
    T04: 1,
    X01: 0.5,
    X02: 0,
    X03: 0.5,
    X04: 0.2,
    X05: 1,
    X06: 0.25,
    X07: 1,
    X08: 0,
  },
};
export function xiangqiProfileSpec(family = 'neutral', seed = 'reference'): ProfileSpec {
  const adjustments = PROFILE_FAMILIES[family];
  if (!adjustments) throw new Error(`Unknown profile family: ${family}`);
  const controls = nominalControls(XIANGQI_MANIFEST);
  for (const id of ['recapture', 'rook-line', 'cannon-screen', 'horse-leg', 'elephant-eye', 'general-safety'])
    controls.K03[id] = 'proceduralized';
  Object.assign(controls, adjustments);
  if (family === 'attacker') {
    controls.S07['cannon-pressure'] = 0.85;
    controls.S07['active-rook'] = 0.8;
  }
  if (family === 'technician')
    for (const schema of XIANGQI_MANIFEST.schemas)
      if (schema.family === 'endgame') controls.K03[schema.id] = 'proceduralized';
  if (family === 'advanced')
    for (const schema of XIANGQI_MANIFEST.schemas) controls.K03[schema.id] = 'proceduralized';
  if (family === 'familiarist')
    for (const side of ['red', 'black'])
      controls.K01[side] = { 'central-cannon': 0.8, 'screen-horses': 0.15, 'elephant-formation': 0.05 };
  return {
    id: family,
    seed,
    modelVersion: MODEL_VERSION,
    knowledgeVersion: XIANGQI_MANIFEST.version,
    experimental: false,
    controls,
  };
}
export function xiangqiProfile(family = 'neutral', seed = 'reference'): CompiledProfile {
  return compileProfile(xiangqiProfileSpec(family, seed), XIANGQI_MANIFEST);
}
