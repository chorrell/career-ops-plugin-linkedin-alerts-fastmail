---
name: career-ops-plugin-linkedin-alerts-fastmail
description: How to pull LinkedIn job-alert leads from a Fastmail mailbox into the career-ops pipeline.
license: MIT
---

# linkedin-alerts-fastmail

Reads LinkedIn job-alert emails (`jobalerts-noreply@linkedin.com`) from the
user's Fastmail account over JMAP, parses each job card, and returns the jobs as
leads. The engine applies the blacklist and `portals.yml` title/location filters,
dedups against the tracker, pipeline and scan history, and writes the rest to
`data/pipeline.md`. It never contacts linkedin.com.

## How to run it

- `node plugins.mjs run linkedin-alerts-fastmail --dry-run`: list what it would add.
- `node plugins.mjs run linkedin-alerts-fastmail`: add the leads to the pipeline.

## Setup

`FASTMAIL_API_TOKEN` in `.env`: a Fastmail API token of type JMAP with only the
"Read-only access" scope. Enable it with
`node plugins.mjs enable linkedin-alerts-fastmail --confirm`. Settings in
`config/plugins.yml`:

```yaml
plugins:
  linkedin-alerts-fastmail: { enabled: true, days_back: 7 }
```

Optional `sender` overrides the alert address. It has to be a `linkedin.com`
address, because the DMARC check only accepts mail from `linkedin.com`.

## What it produces

`Job[]` of `{ title, company, location, url }`, where `url` is the canonical
`https://www.linkedin.com/jobs/view/{id}/`. These are aggregator leads: before
evaluating one, confirm the role on the employer's own careers page (the
career-ops rule "Aggregator Listings -- Confirm at the Employer"). State is kept
in `data/linkedin-alerts-fastmail-state.json` under the data root:
`processed_email_ids` (alerts that yielded jobs) and `job_alerts` (LinkedIn job id →
the saved searches that surfaced it).

If a run logs "yielded no jobs — the email format may have changed", LinkedIn
changed its alert layout and `_helpers.mjs` → `parseAlertText` needs updating.
Those alerts stay unread, so the first run after the fix picks them up.
