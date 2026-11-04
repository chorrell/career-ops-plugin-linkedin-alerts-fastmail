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

`FASTMAIL_API_TOKEN` in `.env` (Fastmail API token, protocol JMAP, Mail,
read-only). Settings in `config/plugins.yml`:

```yaml
plugins:
  linkedin-alerts-fastmail: { enabled: true, days_back: 7 }
```

Optional `sender` overrides the alert address.

## What it produces

`Job[]` of `{ title, company, location, url }`, where `url` is the canonical
`https://www.linkedin.com/jobs/view/{id}/`. These are aggregator leads: before
evaluating one, confirm the role on the employer's own careers page (AGENTS.md,
"Aggregator Listings"). Processed email ids are kept in
`data/linkedin-alerts-fastmail-state.json` under the data root.

If a run logs "yielded no jobs — the email format may have changed", LinkedIn
changed its alert layout and `_helpers.mjs` → `parseAlertText` needs updating.
