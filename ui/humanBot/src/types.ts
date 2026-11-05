/** Variant-neutral runtime contracts. Engine adapters own score and coordinate conversion. */
export type Player = string;
export type Action = string;
export type Mastery = 'absent' | 'recognized' | 'understood' | 'proceduralized';
export type ScalarId =
  | 'K02'
  | 'K04'
  | 'K05'
  | 'K06'
  | 'A01'
  | 'A02'
  | 'A03'
  | 'A04'
  | 'C01'
  | 'C02'
  | 'C03'
  | 'C04'
  | 'C05'
  | 'C06'
  | 'S01'
  | 'S02'
  | 'S03'
  | 'S04'
  | 'S05'
  | 'S06'
  | 'S08'
  | 'P01'
  | 'P02'
  | 'P03'
  | 'P04'
  | 'T01'
  | 'T02'
  | 'T03'
  | 'T04'
  | 'X01'
  | 'X02'
  | 'X03'
  | 'X04'
  | 'X05'
  | 'X06'
  | 'X07'
  | 'X08'
  | 'E01'
  | 'E02'
  | 'E03'
  | 'E04'
  | 'E05'
  | 'E06'
  | 'E07'
  | 'E08';
export type Controls = Record<ScalarId, number> & {
  K01: Record<Player, Record<string, number>>;
  K03: Record<string, Mastery>;
  S07: Record<string, number>;
};
export type ControlId = keyof Controls;
export interface ProfileSpec {
  id: string;
  seed: string;
  modelVersion: string;
  knowledgeVersion: string;
  experimental: boolean;
  controls: Controls;
}
export interface CompiledProfile extends ProfileSpec {
  readonly fingerprint: string;
  readonly coefficients: {
    eventBudget: number;
    nodes: number;
    skill: number;
    discovery: number;
    qualityBand: number;
    candidates: number;
    replies: number;
    retained: number;
    risk: number;
    activation: number;
    reserve: number;
  };
}
export interface Piece {
  id: string;
  owner: Player;
  role: string;
  location: string;
  /** Optional public geometry for domain knowledge; never a hidden identity. */
  x?: number;
  y?: number;
}
export interface Move {
  action: Action;
  actor: Player;
  piece?: string;
  role?: string;
  from?: string;
  to?: string;
  capture?: string;
  captureRole?: string;
}
export interface Observation {
  /** Must identify the information set AND rule-relevant history, never just a board/FEN. */
  key: string;
  rulesVersion: string;
  variant: string;
  turn: Player;
  players: readonly Player[];
  ply: number;
  history?: readonly Action[];
  pieces: readonly Piece[];
  moves: readonly Move[];
  lastMove?: Move;
  checked: readonly Player[];
  /** Exact public utilities in [-1, 1]; zero is a draw. Supports ranked/multiple winners. */
  terminal?: Readonly<Record<Player, number>>;
  rulePressure: number;
}
export interface Question {
  id: string;
  schema: string;
  kind: string;
  subject: string;
  dependencies: readonly string[];
  distance: number;
  cost: number;
}
export interface Relation {
  question: string;
  subject: string;
  kind: string;
  targets: readonly string[];
  confidence: number;
}
export interface Belief extends Relation {
  evidenceKey: string;
  source: 'observed' | 'inspected' | 'assumed' | 'remembered';
  dependencies: Readonly<Record<string, string>>;
  learnedPly: number;
}
export interface Outcome<P> {
  probability: number;
  position: P;
}
export interface RulesAdapter<P, Snapshot = unknown> {
  readonly version: string;
  restore(snapshot: Snapshot): P;
  snapshot(position: P): Snapshot;
  observe(position: P, perspective: Player): Observation;
  /** Imperfect-information adapters return observation outcomes, never a private deal. */
  play(position: P, action: Action, perspective: Player): readonly Outcome<P>[];
  inspect(position: P, question: Question, perspective: Player): Relation;
}
export interface Schema {
  id: string;
  family: string;
  prerequisites: readonly string[];
  description: string;
  provenance: string;
  roles: readonly string[];
  forcing: boolean;
}
export interface OpeningFamily {
  id: string;
  players: readonly Player[];
  description: string;
}
export interface KnowledgeManifest {
  version: string;
  variant: string;
  schemas: readonly Schema[];
  openings: readonly OpeningFamily[];
  roles: readonly string[];
}
export interface Binding {
  schema: string;
  key: string;
  cue: number;
  similarity: number;
  actions: readonly Action[];
  questions: readonly string[];
  goal: string;
  role?: string;
  progress: number;
  forcing: boolean;
  recall?: { family: string; extent: number; exact: boolean };
}
export interface Retrieval {
  key: string;
  schema: string;
  binding: string;
  available: boolean;
  activation: number;
  confidence: number;
  cost: number;
  mastery: Mastery;
}
export interface Features {
  material: number;
  activity: number;
  safety: number;
  structure: number;
  initiative: number;
  complexity: number;
  simplification: number;
  prevention: number;
  progress: number;
  roles: Readonly<Record<string, number>>;
}
export interface Appraisal {
  features: Features;
  uncertainty: number;
  confidence: number;
  terminal?: number;
}
export interface KnowledgePack {
  readonly manifest: KnowledgeManifest;
  bindings(observation: Observation, player: Player): readonly Binding[];
  questions(observation: Observation, player: Player): readonly Question[];
  moveCues(
    observation: Observation,
    move: Move,
    known: readonly string[],
  ): { defensive: number; material: number; recapture: number };
  appraise(
    observation: Observation,
    beliefs: readonly Belief[],
    known: readonly string[],
    player: Player,
  ): Appraisal;
  replyClass(observation: Observation, move: Move): string;
  /** Salient temptation and recognizable refutation from an actually examined line, in [0,1]. */
  trapCue(
    observation: Observation,
    temptation: Move,
    refutation: Move,
    after: Observation,
    known: readonly string[],
  ): number;
  goalValid(goal: Plan, observation: Observation, player: Player): boolean;
  /** Only legal, geometrically nearby alternatives from the declared input model. */
  slipAlternatives(move: Move, observation: Observation): readonly Action[];
}
export interface Plan {
  goal: string;
  schema: string;
  role?: string;
  progress: number;
  stalled: number;
  createdPly: number;
  reviewedPly: number;
  assumptions: readonly string[];
  expected: Readonly<Record<string, number>>;
}
export interface ClockSnapshot {
  capturedAt: number;
  remainingMs: number;
  incrementMs: number;
  /** Remaining simple delay for this turn, not a future increment or lag refund. */
  delayMs: number;
  referenceMs: number;
  transportMs: number;
  deadline: number;
}
export interface Preparation {
  afterKey: string;
  action: Action;
  known: readonly string[];
  events: number;
  conditions: string;
}
export interface Forecast {
  afterKey: string;
  action: Action;
  conditions: string;
  known: readonly string[];
}
export interface BotState {
  version: string;
  profile: string;
  game: string;
  revision: number;
  lastPly: number;
  lastObservation?: Observation;
  beliefs: readonly Belief[];
  plan?: Plan;
  focus?: { schema: string; untilPly: number };
  expected: Readonly<Record<string, number>>;
  preparations: readonly Preparation[];
  forecasts: readonly Forecast[];
  urgency: number;
  subjectiveValue: number;
  session: CognitiveSession;
}
/** Optional cross-game state; never knowledge learning or an opponent's private data. */
export interface CognitiveSession {
  id: string;
  profile: string;
  fatigue: number;
  reaction: number;
  complacency: number;
  offset: number;
  updatedAt: number;
}
export interface Request<P> {
  id: string;
  game: string;
  player: Player;
  position: P;
  expectedRevision: number;
  clock: ClockSnapshot;
  now: number;
}
export type EventKind =
  | 'orient'
  | 'retrieve'
  | 'inspect'
  | 'generate'
  | 'reply'
  | 'continue'
  | 'reconstruct'
  | 'verify'
  | 'recheck'
  | 'reconsider'
  | 'interrupt'
  | 'execute';
export interface CognitiveEvent {
  kind: EventKind;
  key: string;
  units: number;
  milliseconds: number;
  detail?: string;
}
export interface DistributionEntry {
  probability: number;
  value: number;
  label: string;
}
export interface CandidateTrace {
  action: Action;
  goal?: string;
  value: number;
  confidence: number;
  unknownMass: number;
  replies: Readonly<Record<string, number>>;
  depth: number;
  engineValue: number;
  admittedBy: 'knowledge' | 'engine' | 'preparation';
}
export interface Trace {
  model: string;
  profile: string;
  knowledge: string;
  rules: string;
  observation: string;
  events: readonly CognitiveEvent[];
  retrievals: readonly Retrieval[];
  candidates: readonly CandidateTrace[];
  staleBeliefs: readonly string[];
  surprise: number;
  units: number;
  intendedMs: number;
  stop: 'confidence' | 'capacity' | 'clock' | 'terminal' | 'premove';
  engine: {
    version: string;
    searches: readonly SearchReceipt[];
    nodeBudget: number;
    discovery: number;
    qualityBand: number;
    computeMs: number;
  };
}
export interface PendingDecision {
  token: string;
  request: string;
  requestKey: string;
  game: string;
  player: Player;
  expectedRevision: number;
  observation: string;
  intendedAction?: Action;
  action: { kind: 'move'; move: Action } | { kind: 'resign' } | { kind: 'terminal' };
  submitAt: number;
  expiresAt: number;
  next: BotState;
  trace: Trace;
}
export interface ResourceLimits {
  maxEvents: number;
  maxBeliefs: number;
  maxNodes: number;
  maxComputeMs: number;
  maxCandidates: number;
  maxPvPlies: number;
}

/** Scores are adapter-defined decision units, comparable within this engine/version.
 * No negamax assumption: each player has a utility, including for chance/multiplayer games.
 * Forced outcomes are search claims; the RulesAdapter alone adjudicates the actual game. */
export interface EngineLine {
  action: Action;
  utilities: Readonly<Record<Player, number>>;
  forced?: Readonly<Record<Player, number>>;
  distance?: number;
  pv: readonly Action[];
  depth: number;
  uncertainty: number;
}
export interface EngineQuery<P> {
  position: P;
  player: Player;
  actions: readonly Action[];
  nodes: number;
  multiPv: number;
  maxTimeMs: number;
  signal?: AbortSignal;
}
export interface EngineEvidence {
  version: string;
  observation: string;
  bestAction: Action;
  /** A newer engine recommendation without a comparable published score. Not a selectable scored candidate. */
  unscoredBest?: Action;
  lines: readonly EngineLine[];
  nodes: number;
  elapsedMs: number;
  stopped: boolean;
}
export interface EngineAdapter<P> {
  readonly version: string;
  analyze(query: EngineQuery<P>): Promise<EngineEvidence>;
  close(): void;
}
export interface SearchReceipt {
  purpose: 'survey' | 'verify' | 'replies';
  requestedNodes: number;
  nodes: number;
  elapsedMs: number;
  depth: number;
  candidates: number;
  rootActions: number;
  stopped: boolean;
  unscoredBest?: Action;
}
