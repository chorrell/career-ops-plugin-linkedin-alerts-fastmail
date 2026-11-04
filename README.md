# template-repo

[![markdownlint](https://github.com/chorrell/template-repo/actions/workflows/markdownlint.yml/badge.svg)](https://github.com/chorrell/template-repo/actions/workflows/markdownlint.yml)

The GitHub template I start new repositories from. It holds the lint,
Dependabot and pre-commit defaults every project shares, so a new repository
starts with the same baseline instead of copying files by hand.

## What's included

| File | Purpose |
| --- | --- |
| [`.pre-commit-config.yaml`](.pre-commit-config.yaml) | gitleaks, markdownlint-cli2, zizmor and the standard `pre-commit-hooks` hygiene checks. zizmor is the workflow linter; actionlint isn't used because it rejects GitHub's `$/` self-repository `uses:` syntax ([rhysd/actionlint#711](https://github.com/rhysd/actionlint/issues/711)) |
| [`.github/dependabot.yml`](.github/dependabot.yml) | One monthly `tooling` PR for GitHub Actions and pre-commit hook updates, with a 7-day cooldown |
| [`.github/workflows/markdownlint.yml`](.github/workflows/markdownlint.yml) | Lints Markdown on pull requests with the shared [chorrell/workflows](https://github.com/chorrell/workflows) workflow |
| [`.github/workflows/pre-commit.yml`](.github/workflows/pre-commit.yml) | Runs every pre-commit hook on pull requests, so hook updates are tested |
| [`.github/workflows/dependabot-automerge.yml`](.github/workflows/dependabot-automerge.yml) | Auto-merges the Dependabot `tooling` PR once checks pass, when every update is minor or patch |
| [`.github/workflows/zizmor.yml`](.github/workflows/zizmor.yml) | Audits GitHub Actions workflows with zizmor on pull requests and pushes to `main`, using the shared chorrell/workflows workflow |
| [`.github/zizmor.yml`](.github/zizmor.yml) | Lets `chorrell/*` reusable workflows be pinned by tag; everything else must be pinned by commit hash |
| [`.github/CODEOWNERS`](.github/CODEOWNERS) | Requests my review on every change |
| [`.markdownlint.yaml`](.markdownlint.yaml) | Markdown lint rules (line length is not enforced) |
| [`.gitignore`](.gitignore) / [`.gitattributes`](.gitattributes) | Language-agnostic ignores and LF normalization |
| [`AGENTS.md`](AGENTS.md) / [`CLAUDE.md`](CLAUDE.md) | Guidance for coding agents; `CLAUDE.md` imports `AGENTS.md` |
| [`LICENSE`](LICENSE) | Mozilla Public License 2.0 |

## Creating a repository from this template

```sh
gh repo create chorrell/<name> --template chorrell/template-repo --public --clone
```

Then:

1. Retitle this README and describe the new project.
2. Rewrite `AGENTS.md` for the project. Keep `CLAUDE.md` as it is.
3. Add language-specific pre-commit hooks (ruff, shellcheck, hadolint,
   terraform, ...) and Dependabot ecosystems (`docker`, `uv`, `terraform`, ...).
4. Add language-specific entries to `.gitignore`.
5. Check that `CODEOWNERS` and `LICENSE` still fit.
6. Add the repository to
   [chorrell/github-settings](https://github.com/chorrell/github-settings)
   (its daily bot proposes it), with any CI checks it should require beyond
   `zizmor / zizmor`, which every repository requires.

## Local development

Install [prek](https://github.com/j178/prek) (`brew install prek`), a faster
drop-in replacement for pre-commit, and run the hooks before pushing:

```sh
prek install
prek run --all-files
```

The markdownlint hook runs in Docker, so Docker needs to be running.

## License

[MPL-2.0](LICENSE)
