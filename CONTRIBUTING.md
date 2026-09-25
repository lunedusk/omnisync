# Contributing to OmniSync

Thank you for your interest in contributing to **OmniSync** (Lunedusk).

## Code of Conduct

Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By
contributing, you agree to uphold it.

## How to contribute

1. **Issues** — Search existing issues before opening a new one. Include steps
   to reproduce, Obsidian version, OS, and relevant logs for bugs.
2. **Pull requests** — Fork, create a focused branch, and open a PR against
   `main`. Keep changes small and well-described.
3. **Security** — Do **not** open public issues for vulnerabilities. See
   [SECURITY.md](SECURITY.md).

## Development setup

```bash
git clone https://github.com/lunedusk/omnisync.git
cd omnisync
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` into:

```text
<vault>/.obsidian/plugins/omnisync/
```

Enable the plugin in Obsidian settings.

### Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Watch rebuild |
| `npm run build` | Typecheck + production bundle |
| `npm run typecheck` | TypeScript only |
| `npm test` | Unit tests |

## Project layout

- `src/` — TypeScript source
- `docs/adr/` — Architectural decision records
- `CONTEXT.md` — Domain language (glossary)
- `.github/workflows/` — Release pipeline

## Style

- Match existing TypeScript style and naming in `CONTEXT.md` / ADRs.
- Prefer small, reviewable PRs.
- Do not commit secrets, tokens, or `node_modules`.
- Do not commit built `main.js` on feature branches unless releasing.

## License

By contributing, you agree that your contributions are licensed under the
MIT License (see [LICENSE](LICENSE)).
