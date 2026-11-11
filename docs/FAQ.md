# FAQ

**Is this the same as rulebook.tech?**
Same judge, prompts and scoring. The website adds teams, history, a dashboard, saved situations and sending each change to your engineers as a GitHub pull request with the test results attached.

**Can it change my live bot?**
No. It only prints or saves a new rule sheet. You decide what goes live.

**Which AI should be the judge?**
Whichever keys you set, in the order Claude, ChatGPT, Gemini. The judge can be a different AI than the bot.

**Why does the score move a little between runs?**
AIs don't answer the same way twice, and neither does the judge. Training allows for this: a change may lower the hidden score by 0.2 and still count as holding.

**What does it cost?**
Every command calls your AI provider on your key, and prints what it spent. As a rough guide with Claude Sonnet 5 as bot and judge: a score on 10 situations or a break run is around 10 to 20 cents, a fix up to about a dollar, and training a few dollars. Training stops by itself once a session reaches $10.

**Where does my data go?**
Nothing is sent anywhere except the AI provider you chose. Rule sheets, facts, situations and replies stay on your computer. `rulebook chats` blanks contact details before sending, and the AI is told to replace names with [name]. More in [SECURITY.md](../SECURITY.md).

**Can I use it for client work?**
Yes. You can read, run and change this code for your own bots, for research and for client work. You can't offer it, or something built from it, as a competing product or service. See the [license](../LICENSE.md).

**Something's broken. Where do I report it?**
Open an issue. For security problems, email hello@rulebook.tech instead (see [SECURITY.md](../SECURITY.md)).
