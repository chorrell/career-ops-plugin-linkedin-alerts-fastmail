# career-ops-plugin-linkedin-alerts-fastmail

[![test](https://github.com/chorrell/career-ops-plugin-linkedin-alerts-fastmail/actions/workflows/test.yml/badge.svg)](https://github.com/chorrell/career-ops-plugin-linkedin-alerts-fastmail/actions/workflows/test.yml)

An `ingest` plugin for [career-ops](https://github.com/career-ops-hq/career-ops).
It reads the LinkedIn job-alert emails in your Fastmail mailbox over JMAP with a
read-only API token, parses each job card, and hands the jobs to career-ops,
which applies your blacklist and `portals.yml` title and location filters,
dedups them against the tracker, pipeline and scan history, and adds the rest
to `data/pipeline.md`.

It never contacts linkedin.com. Each card's tracking link is reduced to its job
id and returned as `https://www.linkedin.com/jobs/view/{id}/`. These are
aggregator leads, so career-ops confirms each role on the employer's own
careers page before evaluating it.

Emails are accepted only from `jobalerts-noreply@linkedin.com` (or the
`sender` you configure) with a DMARC pass for `linkedin.com` recorded by
Fastmail's own mail servers, so a forged alert can't inject leads.

## Install

Until the plugin is in the career-ops registry, link a checkout into your
career-ops install:

```sh
git clone https://github.com/chorrell/career-ops-plugin-linkedin-alerts-fastmail.git
ln -s "$PWD/career-ops-plugin-linkedin-alerts-fastmail" \
  /path/to/career-ops/plugins.local/linkedin-alerts-fastmail
```

## Configure

1. Create a Fastmail API token: Settings → Privacy & Security → Connected apps
   & API tokens → Manage API tokens → New API token. Choose type **Read-only
   access** and the **Email** scope. The plugin needs Email to read mail, and
   read-only access stops the token from changing or deleting it. Fastmail's
   Basic plan has no API tokens. Add the token to the career-ops `.env`:

   ```sh
   FASTMAIL_API_TOKEN=fmu1-...
   ```

2. Enable the plugin. The first command shows what it can reach; the second
   records your consent and sets `enabled: true` in `config/plugins.yml`:

   ```sh
   node plugins.mjs enable linkedin-alerts-fastmail
   node plugins.mjs enable linkedin-alerts-fastmail --confirm
   ```

3. Set its options in `config/plugins.yml`:

   ```yaml
   plugins:
     linkedin-alerts-fastmail:
       enabled: true
       days_back: 7   # how far back to look for alert emails
       # sender: jobalerts-noreply@linkedin.com   # optional override
   ```

   A `sender` override has to be a `linkedin.com` address. The DMARC check only
   accepts mail from `linkedin.com`, so alerts from any other sender are
   rejected.

## Guides

- [Setting up LinkedIn job alerts](docs/linkedin-alerts.md): which alerts to
  create and how, so the plugin gets useful leads.
- [Running the plugin with every scan](docs/scan.md): a plain `scan` doesn't
  run it; a house rule or a scheduled job does.

## Usage

```sh
node plugins.mjs run linkedin-alerts-fastmail --dry-run   # list what it would add
node plugins.mjs run linkedin-alerts-fastmail             # add the leads to the pipeline
```

State lives in `data/linkedin-alerts-fastmail-state.json` under the career-ops
data root:

- `processed_email_ids`: alert emails that yielded jobs, so each is ingested
  once. An email that fails the sender or DMARC check, or parses to no jobs,
  isn't recorded, so later runs keep trying it until it falls out of
  `days_back`.
- `job_alerts`: LinkedIn job id → the saved searches ("platform engineer
  in Canada") that surfaced it, so alerts can be compared by how their
  jobs scored and how far they got.

If a run logs `yielded no jobs — the email format may have changed`, LinkedIn
changed its alert layout and `parseAlertText` in `_helpers.mjs` needs updating.
Those alerts stay unread, so the first run after the fix picks them up.

Each run reads at most 100 unread alerts, oldest first. A bigger backlog is
worked through over the next runs.

## Development

The plugin tests and markdownlint run in Docker, and prek installs the other
hooks itself. So you need [prek](https://github.com/j178/prek) and a running
Docker, not a local Node install:

```sh
prek install
prek run --all-files          # every hook, including the plugin tests
prek run plugin-tests --all-files
```

`plugin-tests` runs `test/parse.test.mjs` (parser, alert-name and DMARC tests
against redacted real alerts), `test/ingest.test.mjs` (the ingest hook against
a fake Fastmail) and `test/smoke.mjs` (the entry imports and exports the
manifest's hooks) in `node:22-alpine`.

Releases are cut by release-please from conventional commits: merging its
release PR bumps `version` in `manifest.json`, updates `CHANGELOG.md` and tags
`vX.Y.Z`. Don't bump the version by hand.

career-ops pins a plugin's files when you trust it: every file except `.git`
and `node_modules`, docs and tests included. A change without a version bump is
blocked as possible tampering, and `main` changes between releases. So to run
the plugin from source, link career-ops to a worktree at the latest release
tag, kept outside your working checkout:

```sh
git -C career-ops-plugin-linkedin-alerts-fastmail worktree add \
  ../linkedin-alerts-fastmail-release v0.4.0
ln -sfn "$PWD/linkedin-alerts-fastmail-release" \
  /path/to/career-ops/plugins.local/linkedin-alerts-fastmail
```

To upgrade, check out the next tag there
(`git -C linkedin-alerts-fastmail-release checkout v0.4.1`). The version goes
up with it, so career-ops re-pins quietly. To try unreleased changes, run
`node plugins.mjs trust linkedin-alerts-fastmail` after switching.

## License

[MIT](LICENSE)
