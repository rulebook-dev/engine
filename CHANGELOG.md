# Changelog

## 0.1.0 (2026-11-10)

First public version of the engine behind rulebook.tech.

- **Bot Score:** rates every reply on five parts (follows the rules, gets the facts right, solves the problem, tone, can't be tricked) and averages them into one score from 0 to 10.
- **Break my bot:** writes 15 sneaky customer messages, each aimed at one rule, and marks every reply tricked or held up.
- **Fix it for me:** up to three rewrites of the rule sheet, each tested on the problems and on every other situation, keeping the best.
- **Train my bot:** rounds of new questions aimed at the weakest parts, with changes kept only if they hold up on a hidden test. Stops after 25 rounds, 6 idle rounds or $10.
- **Learn from real chats:** finds where the bot let customers down in past conversations and turns them into situations, with contact details blanked first.
- **Company facts:** the judge checks every reply against your FAQ and policies.
- Claude, ChatGPT and Gemini, with the judge falling back to the next key when one fails.
- The `rulebook` command, and tests that run against a fake AI with no key.
