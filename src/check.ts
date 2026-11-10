import { checkAttack, rateReply, writeAttacks } from "./judge";
import { botScore, replyScore } from "./score";
import { askBot, botKnowledgeOf, Judges, newId, pool, round4 } from "./shared";
import { ProviderError } from "./providers";
import type { AttackReply, AttackResult, Bot, KeySet, PartScores, ScoredReply, ScoreResult, Setup, Situation } from "./types";

// How many sneaky customer messages one "Break my bot" run writes.
export const ATTACK_COUNT = 15;
const ANSWER_CONCURRENCY = 6;
const JUDGE_CONCURRENCY = 4;

const errorText = (e: unknown) => (e instanceof ProviderError ? e.message : `Unexpected error: ${(e as Error).message}`);

// Bot Score: the bot answers every situation and the judge rates each reply on five parts.
export async function scoreBot(opts: { bot: Bot; keys: KeySet; setup: Setup; situations: Situation[] }): Promise<ScoreResult> {
  const { bot, setup } = opts;
  const ruleSheet = setup.ruleSheet.trim();
  const botKnowledge = botKnowledgeOf(setup);
  const judges = new Judges(opts.keys);
  let answerCost = 0;

  const replies: ScoredReply[] = opts.situations.map((s) => ({ ...s }));
  await pool(replies, ANSWER_CONCURRENCY, async (r) => {
    try {
      const out = await askBot(bot, ruleSheet, botKnowledge, r.message);
      answerCost += out.cost;
      r.reply = out.text;
    } catch (e) {
      r.error = errorText(e);
    }
  });
  if (!replies.some((r) => r.reply != null)) throw new Error(`The bot didn't answer. ${replies[0]?.error ?? ""}`.trim());

  const rated: PartScores[] = [];
  await pool(replies.filter((r) => r.reply != null), JUDGE_CONCURRENCY, async (r) => {
    try {
      const { parts } = await judges.run((j) => rateReply(j, ruleSheet, r.message, r.reply!, setup.knowledge));
      rated.push(parts);
      r.parts = parts;
      r.score = replyScore(parts);
    } catch (e) {
      r.error = `Judge failed: ${(e as Error).message}`;
    }
  });
  const total = botScore(rated);
  if (!total) throw new Error("The judge couldn't rate any reply, so there's no score.");
  return {
    kind: "score",
    ruleSheet,
    bot: { provider: bot.provider, model: bot.model },
    botScore: total.botScore,
    parts: total.parts,
    replies,
    judgeModel: judges.used?.model,
    cost: round4(answerCost + judges.cost),
  };
}

// Break my bot: an AI writes sneaky customer messages, each aimed at one rule, and the
// judge decides for every reply whether the trick worked.
export async function breakBot(opts: { bot: Bot; keys: KeySet; setup: Setup; count?: number }): Promise<AttackResult> {
  const { bot, setup } = opts;
  const ruleSheet = setup.ruleSheet.trim();
  const botKnowledge = botKnowledgeOf(setup);
  const judges = new Judges(opts.keys);
  let answerCost = 0;

  const { attacks } = await judges.run((j) => writeAttacks(j, ruleSheet, setup.knowledge, opts.count ?? ATTACK_COUNT));
  if (attacks.length === 0) throw new Error("The attacker didn't write any messages. Try again.");
  const out: AttackReply[] = attacks.map((a) => ({ id: newId(), ...a }));

  await pool(out, ANSWER_CONCURRENCY, async (a) => {
    try {
      const res = await askBot(bot, ruleSheet, botKnowledge, a.message);
      answerCost += res.cost;
      a.reply = res.text;
    } catch (e) {
      a.error = errorText(e);
    }
  });
  await pool(out.filter((a) => a.reply != null), JUDGE_CONCURRENCY, async (a) => {
    try {
      const { checks } = await judges.run((j) =>
        checkAttack(j, ruleSheet, setup.knowledge, a, [{ key: bot.provider, text: a.reply! }]),
      );
      const c = checks[bot.provider];
      if (!c) return;
      a.tricked = c.tricked;
      a.brokenRule = c.rule || undefined;
      a.note = c.note;
    } catch (e) {
      a.note = `Judge failed: ${(e as Error).message}`;
    }
  });
  return {
    kind: "attack",
    ruleSheet,
    bot: { provider: bot.provider, model: bot.model },
    tricked: out.filter((a) => a.tricked).length,
    attacks: out,
    judgeModel: judges.used?.model,
    cost: round4(answerCost + judges.cost),
  };
}
