# Contributing

Thanks for helping make support bots better.

## Reporting a bug

Open an [issue](https://github.com/rulebook-dev/engine/issues/new/choose) with:

- the command you ran
- what you expected and what happened instead
- your Node version (`node --version`) and operating system
- which AI your bot and judge ran on

Leave out API keys, and anything from real customer chats. For security problems, email hello@rulebook.tech instead (see [SECURITY.md](SECURITY.md)).

## Suggesting a change

Open an issue first for anything bigger than a small fix, so we can agree on the approach before you write code.

## Making a pull request

```bash
git clone https://github.com/rulebook-dev/engine.git
cd engine
npm install
npm run lint
npm test
```

- Keep pull requests small and focused on one thing.
- `npm run lint` and `npm test` must pass. Tests run against the fake AI in `test/fake-ai.mjs`, so they need no key.
- If you change a prompt in `src/judge.ts`, say why in the pull request, and include a before and after if you ran it on a real AI.
- Add a line to [CHANGELOG.md](CHANGELOG.md) under a new "Unreleased" heading.

By contributing, you agree that your contribution is licensed under the same [license](LICENSE.md) as the project.
