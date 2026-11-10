import { rateReply, writeFix, writeTrainingQuestions } from "./judge";
import { botScore, PART_IDS, PARTS } from "./score";
import { askBot, botKnowledgeOf, Judges, newId, pool, round4 } from "./shared";
import type { Bot, KeySet, PartScores, ScorePart, Setup, Situation } from "./types";

const QUESTIONS_PER_ROUND = 8;
const HIDDEN_COUNT = 12;
// Your situations that join the hidden test; the asker fills the rest.
const HIDDEN_FROM_SITUATIONS = 8;
// A part below this counts as a slip.
const GOOD_PART = 7;
// Judges aren't perfectly consistent, so a change may lower the hidden score by this much
// and still count as holding.
const NOISE = 0.2;
// Several failed rounds in a row end the session with what it has.
const MAX_ERRORS = 3;
// Limits that keep one session's AI bill in check, however fast the AI answers.
const MAX_ROUNDS = 25;
// Rounds in a row that kept no change before training stops early.
const MAX_IDLE_ROUNDS = 6;
// US dollars of AI use per session.
export const MAX_SESSION_COST = 10;
const CONCURRENCY = 6;

export type TrainingLog = { at: string; text: string; tone: "info" | "good" | "bad" };

export type TrainingResult = {
  ruleSheet: string;
  startScore: number;
  score: number;
  parts: Partial<Record<ScorePart, number>>;
  history: { round: number; score: number }[];
  changes: { round: number; change: string; why: string }[];
  rounds: number;
  questionsAsked: number;
  hidden: Situation[];
  feed: TrainingLog[];
  cost: number;
};

type Slip = { message: string; issue: string };

// Train my bot: an asker writes new customer messages aimed at the bot's weak spots, the
// fixer rewrites the rule sheet for the ones it slips on, and a change is only kept if it
// fixes something and holds up on a hidden test the trainer never sees.
export async function trainBot(opts: {
  bot: Bot;
  keys: KeySet;
  setup: Setup;
  situations?: Situation[];
  minutes?: number;
  onLog?: (entry: TrainingLog) => void;
  onPhase?: (phase: string) => void;
}): Promise<TrainingResult> {
  const t = new Trainer(opts);
  await t.setup();
  const endsAt = Date.now() + (opts.minutes ?? 30) * 60_000;
  let errors = 0;
  while (Date.now() < endsAt) {
    const limit = t.endReason();
    if (limit) {
      t.log(limit);
      break;
    }
    try {
      await t.round();
      errors = 0;
    } catch (e) {
      t.log(`Something went wrong: ${(e as Error).message}`, "bad");
      if (++errors >= MAX_ERRORS) break;
    }
  }
  return t.result();
}

class Trainer {
  sheet: string;
  private judges: Judges;
  private answerCost = 0;
  private botKnowledge: string | null;
  private hidden: Situation[] = [];
  private startScore = 0;
  private score = 0;
  private parts: Partial<Record<ScorePart, number>> = {};
  private history: { round: number; score: number }[] = [];
  private changes: { round: number; change: string; why: string }[] = [];
  private asked: string[] = [];
  private open: Slip[] = [];
  private feed: TrainingLog[] = [];
  private questionsAsked = 0;
  private n = 1;
  private idle = 0;

  constructor(
    private opts: {
      bot: Bot;
      keys: KeySet;
      setup: Setup;
      situations?: Situation[];
      onLog?: (entry: TrainingLog) => void;
      onPhase?: (phase: string) => void;
    },
  ) {
    this.sheet = opts.setup.ruleSheet.trim();
    this.botKnowledge = botKnowledgeOf(opts.setup);
    this.judges = new Judges(opts.keys);
  }

  private get knowledge() {
    return this.opts.setup.knowledge;
  }

  private get cost() {
    return this.answerCost + this.judges.cost;
  }

  log(text: string, tone: TrainingLog["tone"] = "info") {
    const entry = { at: new Date().toISOString(), text, tone };
    this.feed.push(entry);
    this.opts.onLog?.(entry);
  }

  private phase(text: string) {
    this.opts.onPhase?.(text);
  }

  // Why the session should end early, if it should.
  endReason(): string | null {
    if (this.n > MAX_ROUNDS) return `Stopped after ${MAX_ROUNDS} rounds, the most one session runs.`;
    if (this.idle >= MAX_IDLE_ROUNDS) return `Stopped early: ${MAX_IDLE_ROUNDS} rounds in a row found nothing more to improve.`;
    if (this.cost >= MAX_SESSION_COST) return `Stopped early: reached the $${MAX_SESSION_COST} spending limit for one session.`;
    return null;
  }

  private async answer(sheet: string, message: string) {
    const res = await askBot(this.opts.bot, sheet, this.botKnowledge, message);
    this.answerCost += res.cost;
    return res.text;
  }

  // Answers and rates each message under a rule sheet. Messages that fail are left out.
  private async tryAll(sheet: string, messages: string[]) {
    const out: { message: string; reply: string; parts: PartScores }[] = [];
    await pool(messages, CONCURRENCY, async (message) => {
      try {
        const reply = await this.answer(sheet, message);
        const { parts } = await this.judges.run((j) => rateReply(j, sheet, message, reply, this.knowledge));
        out.push({ message, reply, parts });
      } catch {
        // Skipped; one missing reply doesn't stop training.
      }
    });
    return out;
  }

  private async hiddenScore(sheet: string) {
    const rated = await this.tryAll(sheet, this.hidden.map((h) => h.message));
    if (rated.length < Math.ceil(this.hidden.length / 2)) {
      throw new Error("Too many hidden-test replies failed to come back.");
    }
    return botScore(rated.map((r) => r.parts));
  }

  async setup() {
    const picked = [...(this.opts.situations ?? [])].sort(() => Math.random() - 0.5).slice(0, HIDDEN_FROM_SITUATIONS);
    const hidden = picked.map((s) => ({ id: s.id, title: s.title, message: s.message }));
    if (hidden.length < HIDDEN_COUNT) {
      this.phase("Writing a hidden test the trainer never sees");
      const { questions } = await this.judges.run((j) =>
        writeTrainingQuestions(j, this.sheet, this.knowledge, { count: HIDDEN_COUNT - hidden.length, focus: [], open: [], avoid: [], broad: true }),
      );
      hidden.push(...questions.map((q) => ({ id: newId(), title: q.title, message: q.message })));
    }
    this.hidden = hidden;
    this.phase("Measuring the starting score on the hidden test");
    const start = await this.hiddenScore(this.sheet);
    if (!start) throw new Error("The judge couldn't rate the hidden test.");
    this.startScore = start.botScore;
    this.score = start.botScore;
    this.parts = start.parts;
    this.history = [{ round: 0, score: start.botScore }];
    this.log(`Starting score on the hidden test: ${start.botScore.toFixed(1)}. Training begins.`);
  }

  async round() {
    const n = this.n;
    // The two weakest parts of the score set this round's focus.
    const focus = (Object.entries(this.parts) as [ScorePart, number][])
      .filter(([, v]) => v < 9)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 2)
      .map(([id]) => PARTS.find((p) => p.id === id)!.label.toLowerCase());

    this.phase(`Round ${n}: writing ${QUESTIONS_PER_ROUND} questions${focus.length ? ` aimed at ${focus.join(" and ")}` : ""}`);
    const { questions } = await this.judges.run((j) =>
      writeTrainingQuestions(j, this.sheet, this.knowledge, {
        count: QUESTIONS_PER_ROUND,
        focus,
        open: this.open.slice(0, 5),
        avoid: this.asked.slice(-40),
      }),
    );
    this.asked = [...this.asked, ...questions.map((q) => q.title)].slice(-80);
    this.questionsAsked += questions.length;

    this.phase(`Round ${n}: the bot answers ${questions.length} new questions`);
    const tried = await this.tryAll(this.sheet, questions.map((q) => q.message));
    const slips: Slip[] = tried
      .map((r) => {
        const low = PART_IDS.filter((id) => (r.parts[id]?.score ?? 10) < GOOD_PART);
        return low.length ? { message: r.message, issue: low.map((id) => r.parts[id].note).join(" ") } : null;
      })
      .filter((x): x is Slip => x !== null);

    this.n = n + 1;
    // Counted as idle until a change is kept below.
    this.idle++;
    if (slips.length === 0) {
      this.open = [];
      this.log(`Round ${n}: handled all ${tried.length} new questions well.`, "good");
      return;
    }
    this.log(`Round ${n}: slipped on ${slips.length} of ${tried.length}${focus.length ? ` (aimed at ${focus.join(" and ")})` : ""}.`);

    this.phase(`Round ${n}: rewriting the rule sheet`);
    const problems = [...slips, ...this.open.filter((o) => !slips.some((x) => x.message === o.message))].slice(0, 8);
    const fix = await this.judges.run((j) => writeFix(j, this.sheet, this.knowledge, problems, null));
    const before = this.sheet;
    if (!fix.ruleSheet || fix.ruleSheet === before) {
      this.open = slips;
      this.log(`Round ${n}: no change found for these.`, "bad");
      return;
    }
    // Patches that bloat the rule sheet are a sign of special cases piling up.
    if (fix.ruleSheet.length > Math.max(before.length * 1.4, before.length + 600)) {
      this.open = slips;
      this.log(`Round ${n}: the change made the rule sheet much longer, so it was thrown away.`, "bad");
      return;
    }

    this.phase(`Round ${n}: testing the change`);
    const retried = await this.tryAll(fix.ruleSheet, slips.map((x) => x.message));
    const stillLow = retried.filter((r) => PART_IDS.some((id) => (r.parts[id]?.score ?? 10) < GOOD_PART));
    const fixed = retried.length - stillLow.length;
    if (fixed === 0) {
      this.open = slips;
      this.log(`Round ${n}: the change didn't fix any of them, so it was thrown away.`, "bad");
      return;
    }

    this.phase(`Round ${n}: checking the change on the hidden test`);
    const after = await this.hiddenScore(fix.ruleSheet);
    const prev = this.score;
    if (!after || after.botScore < prev - NOISE) {
      this.open = slips;
      this.log(
        `Round ${n}: a change fixed ${fixed} of ${slips.length} but lowered the hidden score (${prev.toFixed(1)} → ${after?.botScore.toFixed(1) ?? "?"}), so it was thrown away.`,
        "bad",
      );
      return;
    }
    this.sheet = fix.ruleSheet;
    this.idle = 0;
    this.score = after.botScore;
    this.parts = after.parts;
    this.history.push({ round: n, score: after.botScore });
    this.changes.push(...fix.changes.map((c) => ({ round: n, ...c })));
    this.open = slips.filter((x) => stillLow.some((r) => r.message === x.message));
    this.log(`Round ${n}: kept a change. Fixed ${fixed} of ${slips.length}, hidden score ${prev.toFixed(1)} → ${after.botScore.toFixed(1)}.`, "good");
  }

  result(): TrainingResult {
    return {
      ruleSheet: this.sheet,
      startScore: this.startScore,
      score: this.score,
      parts: this.parts,
      history: this.history,
      changes: this.changes,
      rounds: this.n - 1,
      questionsAsked: this.questionsAsked,
      hidden: this.hidden,
      feed: this.feed,
      cost: round4(this.cost),
    };
  }
}
