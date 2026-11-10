// The company's facts: how they reach the bot under test and the judge.

export const MAX_KNOWLEDGE_CHARS = 50_000;

// What the bot is sent as instructions: the rule sheet, plus the company facts when the
// real bot gets them too.
export function botSystem(ruleSheet: string, botKnowledge: string | null | undefined): string {
  if (!botKnowledge?.trim()) return ruleSheet;
  return `${ruleSheet}\n\n<company_information>\n${botKnowledge.trim()}\n</company_information>`;
}

// The facts block given to the judge and the chat reader.
export function factsBlock(knowledge: string | null | undefined): string[] {
  if (!knowledge?.trim()) return [];
  return [
    `<company_facts>\n${knowledge.trim()}\n</company_facts>`,
    `The company facts above are the truth. A reply that contradicts them is wrong, even if it sounds reasonable.`,
  ];
}
