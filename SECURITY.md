# Security

## Reporting a problem

Email **hello@rulebook.tech** with "Security" in the subject. Please include what you found, how to reproduce it, and what someone could do with it. Don't open a public issue for a security problem.

We reply within 3 working days and keep you posted until it's fixed. If you'd like credit, we'll name you in the changelog.

This covers the code in this repo and the website at [rulebook.tech](https://www.rulebook.tech). How the website handles data is on its [security page](https://www.rulebook.tech/security).

## How this engine handles your data

- **API keys** are read from environment variables and sent only to the provider they belong to (Anthropic, OpenAI or Google). They're never written to disk or logged.
- **Rule sheets, facts, situations and replies** stay on your computer. They're sent only to the AI provider you chose, as the bot's instructions or for the judge to read.
- **Real chats** are scrubbed before they're sent: emails, phone numbers, links and account numbers are blanked, and the AI is told to replace names with [name]. The scrubbing runs again on what comes back. Pattern matching can miss things, so check what you load.
- **Nothing else is sent anywhere.** There's no tracking and nothing reports back to Rulebook.
