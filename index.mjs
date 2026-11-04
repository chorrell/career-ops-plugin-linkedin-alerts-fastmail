// @ts-check
// linkedin-alerts-fastmail — pulls the jobs listed in LinkedIn job-alert emails
// from a Fastmail mailbox (JMAP, read-only API token) into the pipeline.
//
// It reads only the user's own mail; it never fetches linkedin.com. Each card's
// tracking link is reduced to its job id and returned as the canonical
// https://www.linkedin.com/jobs/view/{id}/ URL, so the pipeline's aggregator
// rule (confirm at the employer) takes over from there.
//
// Enable in config/plugins.yml:
//   linkedin-alerts-fastmail: { enabled: true, days_back: 7 }
// Add to .env: FASTMAIL_API_TOKEN (Fastmail → Settings → Privacy & Security →
// Manage API tokens; type JMAP, scope "Read-only access" only).
// Run:  node plugins.mjs run linkedin-alerts-fastmail [--dry-run]

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { isAuthenticLinkedIn, parseAlertName, parseAlertText } from './_helpers.mjs';

const SESSION_URL = 'https://api.fastmail.com/jmap/session';
const MAIL = 'urn:ietf:params:jmap:mail';
const USING = ['urn:ietf:params:jmap:core', MAIL];
const DEFAULT_SENDER = 'jobalerts-noreply@linkedin.com';
const QUERY_LIMIT = 100;
const STATE_FILE = join('data', 'linkedin-alerts-fastmail-state.json');
const MAX_REMEMBERED = 2000;
const MAX_JOB_ALERTS = 5000;

const statePath = (ctx) => join(ctx.dataRoot, STATE_FILE);

function loadState(ctx) {
  const path = statePath(ctx);
  if (!existsSync(path)) return { processed: [], jobAlerts: {} };
  try {
    const state = JSON.parse(readFileSync(path, 'utf-8'));
    return { processed: state.processed_email_ids || [], jobAlerts: state.job_alerts || {} };
  } catch {
    return { processed: [], jobAlerts: {} };
  }
}

// job_alerts maps a LinkedIn job id to the saved searches that surfaced it, so
// alerts can later be compared by what their jobs scored and how far they got.
function saveState(ids, jobAlerts, ctx) {
  try {
    const path = statePath(ctx);
    mkdirSync(dirname(path), { recursive: true });
    const keptAlerts = Object.fromEntries(Object.entries(jobAlerts).slice(-MAX_JOB_ALERTS));
    writeFileSync(path, JSON.stringify({ processed_email_ids: ids.slice(-MAX_REMEMBERED), job_alerts: keptAlerts }, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`linkedin-alerts-fastmail: could not persist processed-id state — ${err.message}`);
  }
}

/** POST one JMAP request and return its method responses, failing on any error response. */
async function jmap(ctx, apiUrl, auth, methodCalls) {
  const res = await ctx.fetch(apiUrl, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ using: USING, methodCalls }),
  });
  const { methodResponses } = await res.json();
  const failed = methodResponses.find(([name]) => name === 'error');
  if (failed) throw new Error(`linkedin-alerts-fastmail: JMAP ${failed[1].type}${failed[1].description ? ` — ${failed[1].description}` : ''}`);
  return methodResponses;
}

/** @type {{ ingest: (ctx: any) => Promise<object[]> }} */
export default {
  async ingest(ctx) {
    const token = ctx?.env?.FASTMAIL_API_TOKEN;
    if (!token) throw new Error('linkedin-alerts-fastmail: missing FASTMAIL_API_TOKEN in .env');

    const daysBack = Number(ctx?.settings?.days_back ?? 7);
    if (!Number.isInteger(daysBack) || daysBack <= 0) {
      throw new Error(`linkedin-alerts-fastmail: invalid days_back "${ctx?.settings?.days_back}" (must be a positive integer)`);
    }
    const sender = ctx?.settings?.sender || DEFAULT_SENDER;
    const auth = { Authorization: `Bearer ${token}` };

    // The session names the API endpoint and account; both can change, so they
    // are never hardcoded. A new API host has to be added to allowedHosts.
    const session = await (await ctx.fetch(SESSION_URL, { headers: auth })).json();
    const apiUrl = session.apiUrl;
    const accountId = session.primaryAccounts?.[MAIL];
    if (!apiUrl || !accountId) throw new Error('linkedin-alerts-fastmail: the JMAP session has no mail account (does the token have Mail access?)');

    const after = new Date(Date.now() - daysBack * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    ctx.log(`linkedin-alerts-fastmail: alerts from ${sender} since ${after.slice(0, 10)}`);
    const [[, query], [, got]] = await jmap(ctx, apiUrl, auth, [
      ['Email/query', {
        accountId,
        filter: { from: sender, after },
        sort: [{ property: 'receivedAt', isAscending: false }],
        limit: QUERY_LIMIT,
        calculateTotal: true,
      }, 'q'],
      ['Email/get', {
        accountId,
        '#ids': { resultOf: 'q', name: 'Email/query', path: '/ids' },
        properties: ['id', 'from', 'subject', 'receivedAt', 'header:Authentication-Results:asText:all', 'textBody', 'bodyValues'],
        fetchTextBodyValues: true,
      }, 'g'],
    ]);
    if (query.total > QUERY_LIMIT) {
      ctx.log(`linkedin-alerts-fastmail: ${query.total} alerts in the window, reading the newest ${QUERY_LIMIT}; lower days_back or run more often`);
    }

    const { processed, jobAlerts } = loadState(ctx);
    const done = new Set(processed);
    const seenIds = new Set();
    const jobs = [];
    let emails = 0;
    let unparsed = 0;

    // Oldest first, so the cursor's order matches arrival order.
    for (const email of [...got.list].reverse()) {
      if (done.has(email.id)) continue;
      const fromAddr = (email.from?.[0]?.email || '').toLowerCase();
      if (fromAddr !== sender.toLowerCase() || !isAuthenticLinkedIn(email['header:Authentication-Results:asText:all'])) {
        ctx.log(`linkedin-alerts-fastmail: skipping unauthenticated email "${email.subject}"`);
        processed.push(email.id);
        continue;
      }
      emails++;
      const text = (email.textBody || []).map(p => email.bodyValues?.[p.partId]?.value || '').join('\n');
      const cards = parseAlertText(text);
      if (cards.length === 0) unparsed++;
      const alertName = parseAlertName(text);
      for (const card of cards) {
        const ref = ctx.aggregatorPostingId(card.link);
        if (ref?.domain !== 'linkedin.com') continue;
        if (alertName) {
          const alerts = jobAlerts[ref.id] ||= [];
          if (!alerts.includes(alertName)) alerts.push(alertName);
        }
        if (seenIds.has(ref.id)) continue;
        seenIds.add(ref.id);
        jobs.push({
          title: card.title,
          url: `https://www.linkedin.com/jobs/view/${ref.id}/`,
          company: card.company,
          location: card.location,
        });
      }
      processed.push(email.id);
    }

    ctx.log(`linkedin-alerts-fastmail: ${emails} new alert email(s), ${jobs.length} job(s)`);
    // An alert with no parseable card means LinkedIn changed the layout; say so
    // rather than let the leads vanish quietly.
    if (unparsed) ctx.log(`linkedin-alerts-fastmail: WARNING ${unparsed} alert(s) yielded no jobs — the email format may have changed`);

    if (!ctx?.dryRun) saveState(processed, jobAlerts, ctx);
    return jobs;
  },
};
