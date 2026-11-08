# Running the plugin with every scan

## Why a scan doesn't pick up the alerts

`node scan.mjs` loads only **provider** plugins, the ones listed as
`provider: <id>` entries in `portals.yml`. This is an **ingest** plugin, so a
scan never runs it, and new alert emails don't reach `data/pipeline.md` until
the plugin runs on its own:

```sh
node plugins.mjs run linkedin-alerts-fastmail
```

The two ways below make it part of every scan.

## When you scan with the agent: a house rule

Put a rule in `modes/_custom.md`, your career-ops file for house rules. It's a
user-layer file, so career-ops updates never overwrite it. If you don't have one
yet, copy `modes/_custom.template.md`. Add this under "House Rules":

```markdown
- After every scan, run `node plugins.mjs run linkedin-alerts-fastmail` and
  report its found / new / skipped counts alongside the scan summary. If it
  fails, or logs a WARNING, report the message and carry on: a plugin problem
  never fails the scan.
```

Problems the rule should report rather than stop on:

| Message | Cause | Fix |
| --- | --- | --- |
| `missing FASTMAIL_API_TOKEN in .env` | No token in the career-ops `.env` | Add it (see the README) |
| `files changed since you trusted it without a version bump` | The plugin's files changed without a `version` bump | Link a release tag (README, "Development"), or run `node plugins.mjs trust linkedin-alerts-fastmail` |
| `yielded no jobs — the email format may have changed` | LinkedIn changed its alert layout | Update `parseAlertText` in `_helpers.mjs`; those alerts stay unread until then |
| `failed the sender or DMARC check` | An email from the alert address didn't pass Fastmail's DMARC check | Usually spoofed mail; nothing to do unless every alert fails |

## When you scan unattended: chain the commands

career-ops's [`docs/AUTOMATION.md`](https://github.com/career-ops-hq/career-ops/blob/main/docs/AUTOMATION.md)
shows how to run `scan.mjs` from cron or launchd. Run the plugin in the same
job, joined with `;` rather than `&&` so it runs whatever the scan's exit code
was:

```cron
0 9 * * * cd /path/to/career-ops && /usr/local/bin/node scan.mjs >> data/scan.log 2>&1; /usr/local/bin/node plugins.mjs run linkedin-alerts-fastmail >> data/scan.log 2>&1
```

For launchd, run both through a shell:

```xml
<key>ProgramArguments</key>
<array>
  <string>/bin/sh</string>
  <string>-c</string>
  <string>/usr/local/bin/node scan.mjs; /usr/local/bin/node plugins.mjs run linkedin-alerts-fastmail</string>
</array>
```

A Claude Code `/loop` that runs the scan through the agent follows the house
rule above, but a `/loop` only lasts as long as its session. Use the OS
scheduler for anything meant to keep running.

## The leads still need checking

The plugin's leads are LinkedIn listings, which career-ops treats as aggregator
leads. Before it evaluates one, career-ops confirms the role on the employer's
own careers page, so a lead in `data/pipeline.md` isn't a confirmed opening yet.
