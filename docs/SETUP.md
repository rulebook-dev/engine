# Setup

## Requirements

- Node 22 or newer
- A key for at least one AI: Claude (Anthropic), ChatGPT (OpenAI) or Gemini (Google)

## Install

```bash
git clone https://github.com/rulebook-dev/engine.git
cd engine
npm install
```

`npm install` also builds the engine, so the `rulebook` command is ready straight away.

## Add a key

The engine reads keys from environment variables. Set one or more:

| AI | Variable | Where to get it |
|---|---|---|
| Claude | `ANTHROPIC_API_KEY` | console.anthropic.com |
| ChatGPT | `OPENAI_API_KEY` | platform.openai.com |
| Gemini | `GEMINI_API_KEY` | aistudio.google.com |

macOS and Linux:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Windows, PowerShell:

```powershell
$env:ANTHROPIC_API_KEY="sk-ant-..."
```

Windows, cmd:

```bat
set ANTHROPIC_API_KEY=sk-ant-...
```

With more than one key set, the judge falls back from Claude to ChatGPT to Gemini when one runs out of credit.

## Verify

```bash
npm test
```

This builds the engine and runs every feature against a fake AI that ships with the repo. It needs no key and costs nothing. You should see `pass 7` and `fail 0`.

```bash
npx rulebook --help
```

This prints every command and option.

## First run

The `examples` folder has a small rule sheet, situations, company facts and chats to try:

```bash
npx rulebook score examples/rule-sheet.txt examples/situations.json --facts examples/facts.txt
npx rulebook break examples/rule-sheet.txt --out break.json
npx rulebook fix   examples/rule-sheet.txt --from break.json --situations examples/situations.json
```

Then swap in your own bot's rule sheet. See [REFERENCE.md](REFERENCE.md) for the file formats and every option.
