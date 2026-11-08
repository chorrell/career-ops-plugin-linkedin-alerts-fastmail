# AGENTS.md

A career-ops `ingest` plugin that reads LinkedIn job-alert emails from Fastmail
over JMAP and returns their job cards as pipeline leads. See
[README.md](README.md) for setup and usage, and the career-ops
[plugin docs](https://github.com/career-ops-hq/career-ops/blob/main/docs/PLUGINS.md)
for the plugin contract.

## Structure

```text
├── manifest.json        # id, hooks, requiredEnv, allowedHosts, jobPostings, humanInTheLoop
├── index.mjs            # ingest hook: JMAP session → Email/query + Email/get → cards → Job[]
├── _helpers.mjs         # pure helpers: authResultsClauses, isAuthenticLinkedIn, printable, parseAlertName, parseAlertText
├── skill.md             # how-to the career-ops agent loads with `plugins.mjs skill`
├── docs/
│   ├── linkedin-alerts.md  # setting up LinkedIn alerts that give useful leads
│   └── scan.md             # running the plugin with every career-ops scan
├── test/
│   ├── parse.test.mjs   # offline tests against redacted real alerts
│   ├── ingest.test.mjs  # the ingest hook against a fake ctx and JMAP server
│   ├── smoke.mjs        # entry imports and exports the manifest's hooks
│   └── fixtures/        # alert text and Authentication-Results headers
├── .pre-commit-config.yaml  # gitleaks, markdownlint, pre-commit-hooks, zizmor, plugin-tests
└── .github/
    ├── dependabot.yml   # Actions and pre-commit hooks, one monthly PR
    ├── zizmor.yml       # lets chorrell/* reusable workflows be pinned by tag
    └── workflows/
        ├── test.yml                  # the tests, on PRs and pushes to main
        ├── pre-commit.yml            # every pre-commit hook, on PRs
        ├── markdownlint.yml          # on PRs to main
        ├── zizmor.yml                # on PRs and pushes to main
        └── dependabot-automerge.yml  # merges Dependabot's minor and patch PRs
```

## Rules

- **No dependencies.** Plain ESM, Node built-ins only, no build step and no
  `package.json`. Network calls go through `ctx.fetch`, which career-ops limits
  to `manifest.json` → `allowedHosts`; a new Fastmail API host has to be added
  there. `stl.api.fastmail.com` is listed because the JMAP session's `apiUrl`
  points there (seen November 2026), although Fastmail's docs only name
  `api.fastmail.com`. Don't remove it.
- **Read-only, never submits.** The plugin reads the user's own mail and
  returns leads. It never fetches linkedin.com, writes nothing outside its own
  state file under `ctx.dataRoot`, and keeps `humanInTheLoop: true`.
- **Keep the DMARC gate.** `isAuthenticLinkedIn` trusts only Fastmail's own
  `Authentication-Results` clauses. Don't loosen it, and add a test for every
  new header shape.
- **Fixtures are redacted.** Strip `trackingId`, `midToken`, `otpToken` and
  similar tracking parameters and the recipient's name and address before
  adding a new alert fixture. `gitleaks` runs in pre-commit, but it won't catch
  personal data.
- **Keep `skill.md` free of career-ops' injection red flags.** `plugins.mjs
  skill` warns about a skill that names the core's agent-rules file or its
  shared modes directory, or reads like an instruction override. Refer to
  career-ops rules by their heading instead.
- **Pure logic goes in `_helpers.mjs`** so it can be tested offline; `index.mjs`
  stays the JMAP glue.
- **Bump `version` in `manifest.json` on every change to any file in the
  repository**, docs and tests included. When the user trusts the plugin,
  career-ops hashes every file under its directory except `.git/` and
  `node_modules/`, and a change without a version bump is blocked as possible
  tampering. For the same reason, keep worktrees, logs and other stray files
  (`.DS_Store`, `.claude/`) out of a checkout that's linked into career-ops.
- Run `prek run --all-files` before pushing. The `plugin-tests` hook runs the
  tests in `node:22-alpine` and markdownlint has its own image, so Docker has
  to be running. prek installs the other hooks itself, and no local Node is
  needed.
  CI runs the tests, pre-commit and markdownlint on pull requests, and zizmor
  on pull requests and pushes to `main`.
- Third-party actions are pinned by commit hash with a version comment;
  `chorrell/*` reusable workflows by tag. zizmor enforces this.
- Repository settings and required status checks live in
  [chorrell/github-settings](https://github.com/chorrell/github-settings)
  (`repos.yaml`), not the GitHub UI.
- Commits and PR titles use conventional commits. Branch from `main` with a
  `feature/` prefix; PRs are squash-merged.
