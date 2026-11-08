# Setting up LinkedIn job alerts

The plugin can only pass on what LinkedIn puts in the alert emails, so how the
alerts are set up matters more than how the plugin is configured. An audit of 60
days of alerts (November 2026) is behind most of the advice here.

## Create an alert

1. Run a job search on LinkedIn and set its filters (location, Remote, date
   posted, experience level).
2. Turn on **Set alert** above the results.
3. In the alert's settings, deliver it by **email** to the address on the
   Fastmail account your API token reads.

The plugin reads alerts from `jobalerts-noreply@linkedin.com`. If yours come
from another `linkedin.com` address, set `sender` in `config/plugins.yml`.

## Choose daily, not weekly

Each alert email lists only about 6 jobs, even when its header says "30+ new
jobs match your preferences". A weekly digest hides most of a week's matches,
and the plugin never sees the ones that aren't in the email. Set every alert to
**daily**.

## Write the keywords

- Quote phrases, and join alternatives with uppercase `OR`:
  `"developer productivity" OR "developer experience" OR "platform engineer"`.
  A lowercase `or` is searched as a word.
- Exclude with uppercase `NOT`: `"platform engineer" NOT salesforce`.
- LinkedIn matches keywords anywhere in the posting, not only in the title, so a
  broad phrase brings in unrelated roles. Narrow it with `NOT` terms, or let the
  career-ops title filter drop them.

## Set the location

A country plus the **Remote** filter usually finds more than a single city. In
the audit, 46 of 59 jobs listed their location as just "Canada".

LinkedIn writes locations its own way, such as "North York, ON" or "Greater
Toronto Area". Check that your `portals.yml` `location_filter` allows the
strings your alerts use, or career-ops drops those leads as "location filter" in
the run summary.

## Avoid overlapping alerts

Two wordings of the same search mostly return the same jobs: 31 of 59 in the
audit. Give each alert a distinct title family. If one phrase fills most of a
combined alert's 6 slots, split it into its own alert.

## Measure which alerts work

The plugin records each job's saved search in `job_alerts` in
`data/linkedin-alerts-fastmail-state.json`, keyed by LinkedIn job id:

```json
"job_alerts": {
  "4485455514": ["build and release engineer in Toronto"]
}
```

Match those ids against the tracker to see which alerts lead to jobs that score
well and get furthest, and drop or reword the ones that don't.

## Tune career-ops too

- **`portals.yml` `title_filter`:** add the titles your alerts are meant to find,
  and negative terms for the ones they keep pulling in. The run summary's
  "title filter" count shows how many leads it dropped.
- **`portals.yml` `location_filter`:** see [Set the location](#set-the-location).
- **`data/blacklist.md`:** add aggregators that repost jobs without naming the
  employer, such as Jobgether, so their listings are skipped.
