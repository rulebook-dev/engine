export type ProviderId = "anthropic" | "openai" | "gemini";
export type ModelChoice = Record<ProviderId, { enabled: boolean; model: string }>;

// API keys by provider. Only the ones you have.
export type KeySet = Partial<Record<ProviderId, string>>;

// The AI your support bot runs on.
export type Bot = { provider: ProviderId; model: string; apiKey: string };

export type ScorePart = "rules" | "facts" | "solves" | "tone" | "safety";
export type PartScores = Record<ScorePart, { score: number | null; note: string }>;

// A customer message to test the bot on.
export type Situation = { id: string; title: string; message: string };

// What the bot is tested against: its rule sheet, plus the company facts if you have them.
export type Setup = {
  ruleSheet: string;
  // Company facts (FAQ, policies, prices). The judge checks replies against them.
  knowledge?: string | null;
  // True when the real bot is also given the facts with every message.
  botKnows?: boolean;
};

export type ScoredReply = Situation & {
  reply?: string;
  parts?: PartScores;
  score?: number | null;
  error?: string;
};

export type ScoreResult = {
  kind: "score";
  ruleSheet: string;
  bot: { provider: ProviderId; model: string };
  botScore: number | null;
  parts: Partial<Record<ScorePart, number>>;
  replies: ScoredReply[];
  judgeModel?: string;
  cost: number;
};

export type AttackReply = Situation & {
  trick: string;
  rule: string;
  reply?: string;
  tricked?: boolean;
  brokenRule?: string;
  note?: string;
  error?: string;
};

export type AttackResult = {
  kind: "attack";
  ruleSheet: string;
  bot: { provider: ProviderId; model: string };
  tricked: number;
  attacks: AttackReply[];
  judgeModel?: string;
  cost: number;
};

// Something the bot got wrong, for the fixer to work on.
export type FixProblem = {
  id: string;
  title: string;
  message: string;
  kind: "attack" | "score";
  issue: string;
  trick?: string;
  rule?: string;
  // The parts that scored low (score problems).
  parts?: ScorePart[];
  // Filled in after the new rule sheet is tested.
  reply?: string;
  fixed?: boolean;
  note?: string;
};

export type FixRegression = {
  situationId: string;
  title: string;
  message: string;
  before: string;
  after: string;
  beforeScore: number;
  afterScore: number;
  note: string;
};

export type FixResult = {
  ruleSheet: string;
  changes: { change: string; why: string }[];
  problems: FixProblem[];
  regressions: FixRegression[];
  // How many other situations were checked for getting worse.
  checked: number;
  tries: number;
  judgeModel?: string;
  cost: number;
};

export type ChatFinding = { id: string; title: string; message: string; problem: string; part: ScorePart };
