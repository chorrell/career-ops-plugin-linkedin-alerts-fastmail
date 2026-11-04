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
├── _helpers.mjs         # pure helpers: parseAlertText, parseAlertName, isAuthenticLinkedIn
├── skill.md             # how-to the career-ops agent loads with `plugins.mjs skill`
├── test/
│   ├── parse.test.mjs   # offline tests against redacted real alerts
│   ├── smoke.mjs        # entry imports and exports the manifest's hooks
│   └── fixtures/        # alert text and Authentication-Results headers
└── .github/workflows/
    └── test.yml         # runs both tests on PRs and pushes to main
```

## Rules

- **No dependencies.** Plain ESM, Node built-ins only, no build step and no
  `package.json`. Network calls go through `ctx.fetch`, which career-ops limits
  to `manifest.json` → `allowedHosts`; a new Fastmail API host has to be added
  there.
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
- **Pure logic goes in `_helpers.mjs`** so it can be tested offline; `index.mjs`
  stays the JMAP glue.
- **Bump `version` in `manifest.json` on every change to plugin files.**
  career-ops pins the file hashes when the user trusts the plugin, and an edit
  without a version bump is blocked as possible tampering.
- Run `prek run --all-files` before pushing. Hooks run in Docker rather than
  needing local tools: the `plugin-tests` hook runs both tests in
  `node:22-alpine`, and markdownlint has its own image, so Docker has to be
  running.
  CI runs the tests, pre-commit and markdownlint on pull requests, and zizmor
  on pull requests and pushes to `main`.
- Third-party actions are pinned by commit hash with a version comment;
  `chorrell/*` reusable workflows by tag. zizmor enforces this.
- Repository settings and required status checks live in
  [chorrell/github-settings](https://github.com/chorrell/github-settings)
  (`repos.yaml`), not the GitHub UI.
- Commits and PR titles use conventional commits. Branch from `main` with a
  `feature/` prefix; PRs are squash-merged.
