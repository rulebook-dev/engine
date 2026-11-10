#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { scoreBot, breakBot } from "./check";
import { fixRuleSheet } from "./fix";
import { trainBot } from "./train";
import { readChats } from "./chats";
import { PARTS } from "./score";
import { DEFAULT_MODELS, PROVIDER_IDS, PROVIDERS } from "./models";
import { MAX_KNOWLEDGE_CHARS } from "./knowledge";
import type { AttackResult, Bot, KeySet, ProviderId, ScoreResult, Setup, Situation } from "./types";

const HELP = `rulebook: score, break, fix and train an AI support bot from the command line.

Usage
  rulebook score  <rule-sheet.txt> <situations.json>   Bot Score from 0 to 10, in five parts
  rulebook break  <rule-sheet.txt>                     Break my bot: 15 sneaky customers
  rulebook fix    <rule-sheet.txt> --from <result.json> Fix it for me, from a score or break result
  rulebook train  <rule-sheet.txt> [--minutes 30]      Train my bot on its weak spots
  rulebook chats  <chats.txt> [--rules rule-sheet.txt] Learn from real chats

Options
  --facts <file>       Company facts (FAQ, policies, prices). The judge checks replies against them.
  --bot-knows          Your real bot is given the facts too, so send them to it in tests.
  --bot <provider>     The AI your bot runs on: anthropic, openai or gemini.
  --model <id>         The model your bot runs on. Defaults to ${PROVIDER_IDS.map((p) => DEFAULT_MODELS[p].model).join(", ")}.
  --situations <file>  Situations to check a fix against, or to start training from.
  --minutes <n>        How long training runs (default 30).
  --out <file>         Where to save the result (JSON, or the new rule sheet for fix and train).

Keys are read from ANTHROPIC_API_KEY, OPENAI_API_KEY and GEMINI_API_KEY.
Situations are a JSON list: [{ "title": "Angry about a late order", "message": "Where is my order??" }]`;

class CliError extends Error {}

function fail(message: string): never {
  throw new CliError(message);
}

function read(path: string, what: string): string {
  try {
    return readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  } catch {
    fail(`can't read the ${what} at ${path}`);
  }
}

function readJson<T>(path: string, what: string): T {
  const text = read(path, what);
  try {
    return JSON.parse(text) as T;
  } catch {
    fail(`the ${what} at ${path} isn't valid JSON`);
  }
}

function readSituations(path: string): Situation[] {
  const list = readJson<unknown>(path, "situations file");
  if (!Array.isArray(list)) fail(`${path} should be a JSON list of { "title", "message" }`);
  return list.map((s, i) => {
    const item = s as Partial<Situation>;
    if (typeof item?.message !== "string" || !item.message.trim()) fail(`situation ${i + 1} in ${path} has no message`);
    return { id: item.id ?? `s${i + 1}`, title: item.title?.trim() || item.message.slice(0, 60), message: item.message };
  });
}

function keysFromEnv(): KeySet {
  const keys: KeySet = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
  };
  for (const p of PROVIDER_IDS) if (!keys[p]?.trim()) delete keys[p];
  if (Object.keys(keys).length === 0) fail("set ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY first");
  return keys;
}

function botFrom(keys: KeySet, provider?: string, model?: string): Bot {
  if (provider && !(PROVIDER_IDS as string[]).includes(provider)) fail(`--bot must be one of ${PROVIDER_IDS.join(", ")}`);
  const p = (provider as ProviderId | undefined) ?? PROVIDER_IDS.find((id) => keys[id])!;
  if (!keys[p]) fail(`your bot runs on ${PROVIDERS[p].label}, so set the ${PROVIDERS[p].company} key too`);
  return { provider: p, model: model ?? DEFAULT_MODELS[p].model, apiKey: keys[p]! };
}

function save(path: string | undefined, data: unknown) {
  if (!path) return;
  writeFileSync(path, typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n");
  console.log(`\nSaved to ${path}`);
}

const fmt = (n: number | null | undefined) => (n == null ? "–" : n.toFixed(1));
const dollars = (n: number) => `$${n.toFixed(4)}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      facts: { type: "string" },
      "bot-knows": { type: "boolean" },
      bot: { type: "string" },
      model: { type: "string" },
      situations: { type: "string" },
      from: { type: "string" },
      rules: { type: "string" },
      minutes: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, first, second] = positionals;
  if (!command || values.help) {
    console.log(HELP);
    return;
  }

  const knowledge = values.facts ? read(values.facts, "facts file") : null;
  if (knowledge && knowledge.length > MAX_KNOWLEDGE_CHARS) fail(`the facts file is over ${MAX_KNOWLEDGE_CHARS / 1000}k characters`);
  const setupFor = (ruleSheet: string): Setup => {
    if (!ruleSheet.trim()) fail("the rule sheet is empty");
    return { ruleSheet, knowledge, botKnows: values["bot-knows"] };
  };

  if (command === "chats") {
    if (!first) fail("which file are the chats in? rulebook chats <chats.txt>");
    const keys = keysFromEnv();
    console.log("Reading the chats (contact details are blanked first)…");
    const out = await readChats({ keys, text: read(first, "chats file"), ruleSheet: values.rules ? read(values.rules, "rule sheet") : "", knowledge });
    console.log(`\nRead ${plural(out.chatCount, "chat")}. Found ${plural(out.findings.length, "place")} where the bot let a customer down:\n`);
    for (const f of out.findings) console.log(`- ${f.title} [${f.part}]\n  Customer: ${f.message}\n  Problem: ${f.problem}\n`);
    console.log(`Cost: ${dollars(out.cost)}`);
    save(values.out, out.findings.map((f) => ({ title: f.title, message: f.message })));
    return;
  }

  if (!first) fail(`which rule sheet? rulebook ${command} <rule-sheet.txt>`);
  const setup = setupFor(read(first, "rule sheet"));
  const keys = keysFromEnv();

  if (command === "score") {
    if (!second) fail("which situations? rulebook score <rule-sheet.txt> <situations.json>");
    const bot = botFrom(keys, values.bot, values.model);
    const situations = readSituations(second);
    console.log(`Scoring ${plural(situations.length, "situation")} on ${bot.model}…`);
    const out = await scoreBot({ bot, keys, setup, situations });
    for (const r of out.replies) {
      console.log(`\n${fmt(r.score)}  ${r.title}`);
      if (r.error) console.log(`     ${r.error}`);
      else if (r.parts) {
        for (const p of PARTS) if (r.parts[p.id].score != null && r.parts[p.id].score! < 7) console.log(`     ${p.label}: ${r.parts[p.id].note}`);
      }
    }
    console.log(`\nBot Score: ${fmt(out.botScore)} / 10`);
    for (const p of PARTS) if (out.parts[p.id] != null) console.log(`  ${p.label.padEnd(22)} ${fmt(out.parts[p.id])}`);
    console.log(`Judge: ${out.judgeModel}. Cost: ${dollars(out.cost)}`);
    save(values.out, out);
    return;
  }

  if (command === "break") {
    const bot = botFrom(keys, values.bot, values.model);
    console.log(`Writing sneaky customers and sending them to ${bot.model}…`);
    const out = await breakBot({ bot, keys, setup });
    for (const a of out.attacks) {
      const mark = a.error ? "ERROR  " : a.tricked ? "TRICKED" : "HELD UP";
      console.log(`\n${mark}  ${a.title} (${a.trick})`);
      if (a.error) console.log(`         ${a.error}`);
      else if (a.note) console.log(`         ${a.note}`);
    }
    console.log(`\nTricked ${out.tricked} of ${out.attacks.length}. Judge: ${out.judgeModel}. Cost: ${dollars(out.cost)}`);
    save(values.out, out);
    return;
  }

  if (command === "fix") {
    if (!values.from) fail("fix needs a result to work from: rulebook fix <rule-sheet.txt> --from <result.json>");
    const from = readJson<AttackResult | ScoreResult>(values.from, "result");
    if (from.kind !== "score" && from.kind !== "attack") fail(`${values.from} isn't a score or break result`);
    if (from.ruleSheet.trim() !== setup.ruleSheet.trim()) fail(`${values.from} was made with a different rule sheet. Run score or break again first.`);
    const bot = botFrom(keys, values.bot ?? from.bot.provider, values.model ?? from.bot.model);
    const situations = values.situations ? readSituations(values.situations) : from.kind === "score" ? from.replies : [];
    const out = await fixRuleSheet({ bot, keys, setup, from, situations, onProgress: (t) => console.log(t) });
    const fixed = out.problems.filter((p) => p.fixed).length;
    console.log(`\nFixed ${fixed} of ${out.problems.length}. Checked ${plural(out.checked, "other situation")}, ${out.regressions.length} got worse.`);
    console.log(`\nChanges:`);
    for (const c of out.changes) console.log(`- ${c.change}\n  Why: ${c.why}`);
    for (const r of out.regressions) console.log(`\nGot worse: ${r.title} (${fmt(r.beforeScore)} → ${fmt(r.afterScore)}). ${r.note}`);
    console.log(`\nCost: ${dollars(out.cost)}`);
    if (values.out) save(values.out, out.ruleSheet + "\n");
    else console.log(`\nNew rule sheet:\n\n${out.ruleSheet}`);
    return;
  }

  if (command === "train") {
    const bot = botFrom(keys, values.bot, values.model);
    const minutes = values.minutes ? Number(values.minutes) : 30;
    if (!(minutes > 0)) fail("--minutes must be a number above 0");
    const situations = values.situations ? readSituations(values.situations) : [];
    console.log(`Training ${bot.model} for ${minutes} minute${minutes === 1 ? "" : "s"}…`);
    const out = await trainBot({
      bot,
      keys,
      setup,
      situations,
      minutes,
      onPhase: (p) => console.log(`  ${p}`),
      onLog: (l) => console.log(`${l.tone === "good" ? "+" : l.tone === "bad" ? "-" : "·"} ${l.text}`),
    });
    console.log(`\nHidden test: ${fmt(out.startScore)} → ${fmt(out.score)} after ${plural(out.rounds, "round")}. ${plural(out.changes.length, "change")} kept.`);
    for (const c of out.changes) console.log(`- Round ${c.round}: ${c.change}`);
    console.log(`Cost: ${dollars(out.cost)}`);
    if (values.out) save(values.out, out.ruleSheet + "\n");
    else console.log(`\nNew rule sheet:\n\n${out.ruleSheet}`);
    return;
  }

  fail(`unknown command "${command}". Run rulebook --help.`);
}

// Sets the exit code instead of calling process.exit, so open connections close cleanly.
main().catch((e) => {
  console.error(`rulebook: ${(e as Error).message}`);
  process.exitCode = 1;
});
