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
// Manage API tokens; type "Read-only access", scope "Email").
// Run:  node plugins.mjs run linkedin-alerts-fastmail [--dry-run]

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import { isAuthenticLinkedIn, parseAlertName, parseAlertText, printable } from './_helpers.mjs';

const SESSION_URL = 'https://api.fastmail.com/jmap/session';
const MAIL = 'urn:ietf:params:jmap:mail';
const USING = ['urn:ietf:params:jmap:core', MAIL];
const DEFAULT_SENDER = 'jobalerts-noreply@linkedin.com';
const PAGE_SIZE = 256;
const GET_LIMIT = 100;
const STATE_FILE = join('data', 'linkedin-alerts-fastmail-state.json');
const MAX_REMEMBERED = 2000;
const MAX_JOB_ALERTS = 5000;
// career-ops stops waiting for an ingest hook after 15s but does not stop it.
// Finishing or failing inside a shorter budget means state is never saved for
// a run whose jobs the engine has already given up on.
const BUDGET_MS = 12_000;

const statePath = (ctx) => join(ctx.dataRoot, STATE_FILE);
const emptyState = () => ({ processed: [], jobAlerts: {} });

function loadState(ctx) {
  const path = statePath(ctx);
  if (!existsSync(path)) return emptyState();
  try {
    const state = JSON.parse(readFileSync(path, 'utf-8'));
    const ids = state?.processed_email_ids;
    const alerts = state?.job_alerts;
    return {
      processed: Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [],
      jobAlerts: alerts && typeof alerts === 'object' && !Array.isArray(alerts)
        ? Object.fromEntries(Object.entries(alerts).filter(([, names]) => Array.isArray(names)))
        : {},
    };
  } catch (err) {
    ctx.log(`linkedin-alerts-fastmail: WARNING could not read ${STATE_FILE} (${err.message}); starting over, so alerts in the window are read again`);
    return emptyState();
  }
}

// job_alerts maps a LinkedIn job id to the saved searches that surfaced it, so
// alerts can later be compared by what their jobs scored and how far they got.
// Written to a temp file and renamed, so a crash mid-write can't corrupt it.
function saveState(ids, jobAlerts, ctx) {
  try {
    const path = statePath(ctx);
    mkdirSync(dirname(path), { recursive: true });
    const keptAlerts = Object.fromEntries(Object.entries(jobAlerts).slice(-MAX_JOB_ALERTS));
    writeFileSync(`${path}.tmp`, JSON.stringify({ processed_email_ids: ids.slice(-MAX_REMEMBERED), job_alerts: keptAlerts }, null, 2), 'utf-8');
    renameSync(`${path}.tmp`, path);
  } catch (err) {
    console.warn(`linkedin-alerts-fastmail: could not persist processed-id state — ${err.message}`);
  }
}

/** POST one JMAP request and return its method responses, failing on any error response. */
async function jmap(ctx, apiUrl, auth, timeoutMs, methodCalls) {
  const res = await ctx.fetch(apiUrl, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ using: USING, methodCalls }),
    timeoutMs,
  });
  const { methodResponses } = (await res.json()) ?? {};
  if (!Array.isArray(methodResponses)) throw new Error('linkedin-alerts-fastmail: the JMAP response has no methodResponses');
  const failed = methodResponses.find(([name]) => name === 'error');
  if (failed) throw new Error(`linkedin-alerts-fastmail: JMAP ${failed[1].type}${failed[1].description ? ` — ${failed[1].description}` : ''}`);
  return methodResponses;
}

/** @type {{ ingest: (ctx: any) => Promise<object[]> }} */
export default {
  async ingest(ctx) {
    const deadline = Date.now() + BUDGET_MS;
    const timeLeft = () => {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`linkedin-alerts-fastmail: ran out of time after ${BUDGET_MS / 1000}s; nothing was saved, so the next run reads the same alerts`);
      return left;
    };

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
    const session = await (await ctx.fetch(SESSION_URL, { headers: auth, timeoutMs: timeLeft() })).json();
    const apiUrl = session.apiUrl;
    const accountId = session.primaryAccounts?.[MAIL];
    if (!apiUrl || !accountId) throw new Error('linkedin-alerts-fastmail: the JMAP session has no mail account (does the token have the Email scope?)');

    const after = new Date(Date.now() - daysBack * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    ctx.log(`linkedin-alerts-fastmail: alerts from ${sender} since ${after.slice(0, 10)}`);

    // Every id in the window, oldest first, so a backlog bigger than one run's
    // read is worked through in arrival order over the next runs.
    const ids = [];
    for (let total = Infinity; ids.length < total;) {
      const [[, page]] = await jmap(ctx, apiUrl, auth, timeLeft(), [['Email/query', {
        accountId,
        filter: { from: sender, after },
        sort: [{ property: 'receivedAt', isAscending: true }],
        position: ids.length,
        limit: PAGE_SIZE,
        calculateTotal: true,
      }, 'q']]);
      if (page.ids.length === 0) break;
      ids.push(...page.ids);
      total = page.total;
    }

    const { processed, jobAlerts } = loadState(ctx);
    const done = new Set(processed);
    const unread = ids.filter(id => !done.has(id));
    const batch = unread.slice(0, GET_LIMIT);
    if (unread.length > batch.length) {
      ctx.log(`linkedin-alerts-fastmail: ${unread.length} unread alerts in the window, reading the oldest ${GET_LIMIT}; the next run continues`);
    }
    if (batch.length === 0) {
      ctx.log('linkedin-alerts-fastmail: 0 new alert email(s), 0 job(s)');
      return [];
    }

    const [[, got]] = await jmap(ctx, apiUrl, auth, timeLeft(), [['Email/get', {
      accountId,
      ids: batch,
      properties: ['id', 'from', 'subject', 'receivedAt', 'header:Authentication-Results:asText:all', 'textBody', 'bodyValues'],
      fetchTextBodyValues: true,
    }, 'g']]);
    const byId = new Map(got.list.map(email => [email.id, email]));

    const seenIds = new Set();
    const jobs = [];
    let emails = 0;
    let unparsed = 0;
    let rejected = 0;

    // Only an email that yielded jobs is marked processed. One that failed the
    // sender or DMARC check, or parsed to nothing, stays unread, so a fixed
    // parser or a changed Authentication-Results shape picks it up next run.
    for (const email of batch.map(id => byId.get(id)).filter(Boolean)) {
      const fromAddr = (email.from?.[0]?.email || '').toLowerCase();
      if (fromAddr !== sender.toLowerCase() || !isAuthenticLinkedIn(email['header:Authentication-Results:asText:all'])) {
        // The subject is the sender's text, and this output is read by the agent.
        ctx.log(`linkedin-alerts-fastmail: skipping unauthenticated email ${JSON.stringify(printable(email.subject))}`);
        rejected++;
        continue;
      }
      emails++;
      const text = (email.textBody || []).map(p => email.bodyValues?.[p.partId]?.value || '').join('\n');
      const cards = parseAlertText(text);
      if (cards.length === 0) {
        unparsed++;
        continue;
      }
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
    if (unparsed) ctx.log(`linkedin-alerts-fastmail: WARNING ${unparsed} alert(s) yielded no jobs — the email format may have changed; they stay unread until days_back passes`);
    if (rejected) ctx.log(`linkedin-alerts-fastmail: WARNING ${rejected} email(s) from ${sender} failed the sender or DMARC check; they stay unread until days_back passes`);

    if (!ctx?.dryRun) {
      timeLeft();
      saveState(processed, jobAlerts, ctx);
    }
    return jobs;
  },
};
