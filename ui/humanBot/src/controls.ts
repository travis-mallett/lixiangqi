import { fingerprint, freeze } from './random';
import type {
  CompiledProfile,
  ControlId,
  Controls,
  KnowledgeManifest,
  Mastery,
  ProfileSpec,
  ScalarId,
} from './types';

export const MODEL_VERSION = 'engine-deliberation-3';
export interface ControlContract {
  id: ControlId;
  label: string;
  tier: 'core' | 'advanced' | 'experimental';
  owner: string;
  kind: 'scalar' | 'repertoire' | 'curriculum' | 'roles';
  min: number;
  max: number;
  nominal: number;
  observable: string;
  counterexample: string;
}
type Row = readonly [ControlId, string, string, string, string];
const rows: readonly Row[] = [
  [
    'K01',
    'Repertoire distribution',
    'retrieval',
    'Selected family frequencies across games',
    'Non-opening positions',
  ],
  ['K02', 'Recall extent', 'retrieval', 'Availability of deeper authored branches', 'Unlisted continuations'],
  [
    'K03',
    'Knowledge curriculum',
    'retrieval',
    'Available schemas and inspection access',
    'Absent schemas never retrieve',
  ],
  ['K04', 'Transfer breadth', 'retrieval', 'Near-match access and misapplication', 'Exact familiar bindings'],
  ['K05', 'Retrieval accessibility', 'retrieval', 'Coupled access and retrieval cost', 'Unknown knowledge'],
  [
    'K06',
    'Applicability checking',
    'scheduler',
    'Relation inspection and engine verification effort',
    'No remaining search budget or inspectable relation',
  ],
  [
    'A01',
    'Defensive orientation',
    'attention',
    'Opponent relation inspection priority',
    'No recognized opposing pieces',
  ],
  [
    'A02',
    'Quiet-resource attention',
    'attention',
    'Quiet defensive candidate salience',
    'Only forcing legal actions',
  ],
  ['A03', 'Relational coverage', 'attention', 'Reach to remote relations', 'Local relations'],
  [
    'A04',
    'Focus persistence',
    'attention',
    'Persistent schema focus and nomination bias',
    'Expired focus or no matching schema',
  ],
  [
    'C01',
    'Deliberation capacity',
    'search',
    'Engine node budget and candidate discovery',
    'Clock or host resource ceiling',
  ],
  [
    'C02',
    'Own candidate breadth',
    'scheduler',
    'Scored candidate breadth and nominee count',
    'One legal action',
  ],
  [
    'C03',
    'Opponent reply breadth',
    'search',
    'Engine-informed reply expectations and unknown mass',
    'One forced reply',
  ],
  [
    'C04',
    'Verification effort',
    'scheduler',
    'Engine verification and refinement effort',
    'No remaining search budget',
  ],
  [
    'C05',
    'Branch retention',
    'memory',
    'Retained PV detail, forecasts and reconstruction cost',
    'Short single line',
  ],
  ['C06', 'Forcing fluency', 'timing', 'Cost of proceduralized forcing chunks', 'Unfamiliar quiet moves'],
  [
    'S01',
    'Attack and initiative',
    'appraisal',
    'Initiative preference and cue activation',
    'No credible initiative',
  ],
  ['S02', 'Material security', 'appraisal', 'Material versus activity tradeoff', 'Equal material outcomes'],
  ['S03', 'Downside aversion', 'choice', 'Bounded lower-tail weight', 'Identical certain outcomes'],
  [
    'S04',
    'Complexity preference',
    'appraisal',
    'Attraction of perceived unresolved plans',
    'No known alternative plans',
  ],
  [
    'S05',
    'Simplification preference',
    'appraisal',
    'Exchange and transition attraction',
    'No reduction in decision burden',
  ],
  [
    'S06',
    'Prophylactic preference',
    'appraisal',
    'Value of reducing inspected enemy threats',
    'Unnoticed threats',
  ],
  [
    'S07',
    'Piece-role affinity',
    'appraisal',
    'Preference for credible role activity',
    'Merely retaining an inactive piece',
  ],
  ['S08', 'Draw preference', 'appraisal', 'Subjective value of known draws', 'Unrecognized drawing outcome'],
  ['P01', 'Goal persistence', 'memory', 'Retrieval and branch reuse advantage', 'Physically impossible goal'],
  [
    'P02',
    'Disconfirmation response',
    'memory',
    'Plan abandonment after inspected contradiction',
    'Hidden objective loss',
  ],
  [
    'P03',
    'Second-idea tendency',
    'scheduler',
    'Priority of a different candidate family',
    'No distinct available family',
  ],
  [
    'P04',
    'Expectation concentration',
    'search',
    'Concentration within considered reply mass',
    'Unknown mass is never removed',
  ],
  ['T01', 'Clock reserve', 'timing', 'Spendable clock relative to future demand', 'Untimed terminal outcome'],
  [
    'T02',
    'Deliberation persistence',
    'scheduler',
    'Stopping threshold under uncertainty',
    'No productive task remains',
  ],
  ['T03', 'Familiarity speed', 'timing', 'Recall and familiar operation time', 'Unsuccessful retrieval'],
  [
    'T04',
    'Anticipatory preparation',
    'preparation',
    'Work reused after actual waiting',
    'Zero opponent waiting time',
  ],
  [
    'X01',
    'Subjective certainty bias',
    'choice',
    'Confidence used for stopping',
    'Exact evidence is unchanged',
  ],
  [
    'X02',
    'Rechecking tendency',
    'scheduler',
    'Nonproductive checking time when alternatives exist',
    'Only one scored candidate',
  ],
  ['X03', 'Urgency onset', 'timing', 'Smooth clock-demand transition', 'Ample time'],
  ['X04', 'Urgent attention narrowing', 'attention', 'Optional breadth under urgency', 'Nonurgent clock'],
  [
    'X05',
    'Expected resourcefulness',
    'search',
    'Reply salience and unknown prior',
    'Actual opponent private state',
  ],
  [
    'X06',
    'Practical-trap preference',
    'appraisal',
    'Temptations with an inspected refutation',
    'No recognized trap',
  ],
  [
    'X07',
    'Resistance and resignation',
    'choice',
    'Persistence with perceived practical resources',
    'Already adjudicated terminal outcome',
  ],
  [
    'X08',
    'Conditional premoves',
    'preparation',
    'Prepared action accepted only under matched conditions',
    'Unanticipated reply',
  ],
  [
    'E01',
    'Sustained-effort fatigue',
    'session',
    'Accumulated effort raises operation cost',
    'Disabled or fresh session',
  ],
  [
    'E02',
    'Distraction episodes',
    'session',
    'Bounded nonproductive interruption',
    'Disabled experimental mode',
  ],
  [
    'E03',
    'Post-setback response',
    'session',
    'Signed rechecking or rushing after noticed loss',
    'Unnoticed objective loss',
  ],
  ['E04', 'Recovery dynamics', 'session', 'Decay of enabled temporary states', 'No temporary state'],
  [
    'E05',
    'Success complacency',
    'session',
    'Reduced checking after perceived progress',
    'Hidden engine advantage',
  ],
  [
    'E06',
    'State-dependent risk',
    'choice',
    'Risk shift with perceived advantage',
    'Neutral subjective position',
  ],
  [
    'E07',
    'Accepted input slips',
    'execution',
    'Legal adjacent input from explicit geometry',
    'No nearby legal input',
  ],
  [
    'E08',
    'Session variability',
    'session',
    'Shared session offsets with stable identity',
    'Disabled experimental mode',
  ],
];
export const CONTROL_REGISTRY: readonly ControlContract[] = freeze(
  rows.map(([id, label, owner, observable, counterexample]) => ({
    id,
    label,
    owner,
    observable,
    counterexample,
    tier: id.startsWith('E') ? 'experimental' : id.startsWith('X') ? 'advanced' : 'core',
    kind: id === 'K01' ? 'repertoire' : id === 'K03' ? 'curriculum' : id === 'S07' ? 'roles' : 'scalar',
    min: id === 'E03' ? -1 : 0,
    max: 1,
    nominal: id.startsWith('E') ? 0 : id === 'X08' ? 0.15 : id === 'X07' ? 0.75 : 0.5,
  })),
);
export const SCALAR_IDS: readonly ScalarId[] = freeze(
  CONTROL_REGISTRY.filter(c => c.kind === 'scalar').map(c => c.id as ScalarId),
);
export const MASTERY: readonly Mastery[] = ['absent', 'recognized', 'understood', 'proceduralized'];

/** A neutral design reference. Knowledge packs decide which schemas are elementary. */
export function nominalControls(manifest: KnowledgeManifest): Controls {
  const scalars = Object.fromEntries(
    CONTROL_REGISTRY.filter(c => c.kind === 'scalar').map(c => [c.id, c.nominal]),
  ) as Record<ScalarId, number>;
  const players = [...new Set(manifest.openings.flatMap(f => f.players))];
  return {
    ...scalars,
    K01: Object.fromEntries(
      players.map(player => {
        const families = manifest.openings.filter(f => f.players.includes(player));
        return [player, Object.fromEntries(families.map(f => [f.id, 1 / families.length]))];
      }),
    ),
    K03: Object.fromEntries(
      manifest.schemas.map(s => [s.id, s.prerequisites.length ? 'understood' : 'proceduralized']),
    ),
    S07: Object.fromEntries(manifest.roles.map(role => [role, 0.5])),
  };
}
export function compileProfile(spec: ProfileSpec, manifest: KnowledgeManifest): CompiledProfile {
  if (typeof spec.experimental !== 'boolean' || typeof spec.id !== 'string' || typeof spec.seed !== 'string')
    throw new Error('Invalid profile field types');
  if (spec.modelVersion !== MODEL_VERSION || spec.knowledgeVersion !== manifest.version)
    throw new Error('Profile version mismatch');
  if (!spec.id || !spec.seed) throw new Error('Profile id and seed are required');
  const controls = spec.controls;
  for (const map of [controls, controls?.K01, controls?.K03, controls?.S07])
    if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('Invalid structured controls');
  const validIds = new Set(CONTROL_REGISTRY.map(c => c.id));
  if (Object.keys(controls).length !== 48 || Object.keys(controls).some(id => !validIds.has(id as ControlId)))
    throw new Error('Exactly 48 declared controls are required');
  for (const contract of CONTROL_REGISTRY)
    if (contract.kind === 'scalar') {
      const value = controls[contract.id as ScalarId];
      if (!Number.isFinite(value) || value < contract.min || value > contract.max)
        throw new Error(`${contract.id} must be in [${contract.min}, ${contract.max}]`);
      if (contract.tier === 'experimental' && value !== 0 && !spec.experimental)
        throw new Error(`${contract.id} requires experimental mode`);
    }
  const schemas = new Map(manifest.schemas.map(s => [s.id, s]));
  if (schemas.size !== manifest.schemas.length) throw new Error('Duplicate schema id');
  for (const [id, mastery] of Object.entries(controls.K03)) {
    if (!schemas.has(id) || !MASTERY.includes(mastery)) throw new Error(`Unknown schema or mastery: ${id}`);
  }
  for (const schema of manifest.schemas) {
    if (!(schema.id in controls.K03)) throw new Error(`Missing curriculum entry: ${schema.id}`);
    for (const dependency of schema.prerequisites) {
      if (!schemas.has(dependency)) throw new Error(`Missing prerequisite: ${dependency}`);
      const level = MASTERY.indexOf(controls.K03[schema.id]);
      if (MASTERY.indexOf(controls.K03[dependency]) < Math.min(level, 2))
        throw new Error(`Unsatisfied prerequisite ${dependency} for ${schema.id}`);
    }
  }
  const visit = (id: string, path: Set<string>): void => {
    if (path.has(id)) throw new Error('Cyclic knowledge prerequisites');
    for (const prerequisite of schemas.get(id)!.prerequisites) visit(prerequisite, new Set([...path, id]));
  };
  for (const id of schemas.keys()) visit(id, new Set());
  if (controls.C06 > 0 && !manifest.schemas.some(s => s.forcing && controls.K03[s.id] === 'proceduralized'))
    throw new Error('Forcing fluency requires proceduralized forcing knowledge');
  const players = [...new Set(manifest.openings.flatMap(f => f.players))];
  if (Object.keys(controls.K01).some(p => !players.includes(p)))
    throw new Error('Unsupported repertoire player');
  for (const player of players) {
    const weights = controls.K01[player];
    if (!weights || !Object.keys(weights).length) throw new Error(`Missing repertoire for ${player}`);
    let sum = 0;
    for (const [family, weight] of Object.entries(weights)) {
      if (!manifest.openings.some(f => f.id === family && f.players.includes(player)))
        throw new Error(`Unsupported repertoire: ${player}/${family}`);
      if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error('Invalid repertoire weight');
      sum += weight;
    }
    if (Math.abs(sum - 1) > 1e-9) throw new Error(`Repertoire weights for ${player} must sum to one`);
  }
  if (Object.keys(controls.S07).length !== manifest.roles.length)
    throw new Error('Every installed role needs an affinity');
  for (const [role, weight] of Object.entries(controls.S07))
    if (!manifest.roles.includes(role) || !Number.isFinite(weight) || weight < 0 || weight > 1)
      throw new Error(`Invalid role affinity: ${role}`);
  const result: CompiledProfile = {
    ...structuredClone(spec),
    fingerprint: fingerprint({ spec, manifest }),
    coefficients: {
      eventBudget: Math.round(24 + 72 * controls.C01),
      nodes: Math.round(2048 * 2 ** (6 * controls.C01)),
      skill: Math.sqrt(controls.C01 * curriculum(controls.K03)),
      discovery: controls.C01 * (0.25 + 0.75 * curriculum(controls.K03)),
      qualityBand: 0.08 + 1.5 * (1 - Math.sqrt(controls.C01 * curriculum(controls.K03))) ** 2,
      candidates: Math.round(2 + 4 * controls.C02),
      replies: Math.round(1 + 3 * controls.C03),
      retained: Math.round(2 + 14 * controls.C05),
      risk: 0.75 * controls.S03,
      activation: 2 * (controls.K05 - 0.5),
      reserve: 0.02 + 0.18 * controls.T01,
    },
  };
  return freeze(result);
}
function curriculum(knowledge: Controls['K03']): number {
  const levels = { absent: 0, recognized: 0.25, understood: 0.65, proceduralized: 1 };
  const values = Object.values(knowledge);
  return values.reduce((sum, mastery) => sum + levels[mastery], 0) / Math.max(1, values.length);
}
