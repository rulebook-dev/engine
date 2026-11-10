import { randomBytes } from "node:crypto";
import { complete } from "./providers";
import { costOf } from "./models";
import { judgesFor, type Judge } from "./judge";
import { botSystem } from "./knowledge";
import type { Bot, KeySet } from "./types";

export function newId(bytes = 8): string {
  return randomBytes(bytes).toString("base64url");
}

// Runs fn over items with at most `limit` running at once.
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

export const round4 = (n: number) => Math.round(n * 10000) / 10000;

// The judges available for a set of keys, tried in order. A key can exist and still fail
// (no credit, revoked), so once a judge fails the rest of the job skips it.
export class Judges {
  cost = 0;
  used: Judge | null = null;
  private list: Judge[];
  private idx = 0;

  constructor(keys: KeySet) {
    this.list = judgesFor(keys);
    if (this.list.length === 0) throw new Error("No API key available for the judge.");
  }

  async run<T extends { cost: number }>(fn: (j: Judge) => Promise<T>): Promise<T> {
    for (let i = this.idx; ; i++) {
      try {
        const out = await fn(this.list[i]);
        this.used = this.list[i];
        this.cost += out.cost;
        return out;
      } catch (e) {
        if (i >= this.list.length - 1) throw e;
        this.idx = Math.max(this.idx, i + 1);
      }
    }
  }
}

// Sends one customer message to the bot under a rule sheet. Returns the reply and its cost.
export async function askBot(bot: Bot, ruleSheet: string, botKnowledge: string | null | undefined, message: string) {
  const res = await complete({ ...bot, system: botSystem(ruleSheet, botKnowledge), user: message });
  return { text: res.text, cost: costOf(bot.provider, bot.model, res.inputTokens, res.outputTokens) };
}

// The facts the bot itself is given: only when the real bot gets them too.
export function botKnowledgeOf(setup: { knowledge?: string | null; botKnows?: boolean }): string | null {
  return setup.botKnows ? setup.knowledge?.trim() || null : null;
}
