// Offline tests for the ingest hook: a fake ctx and a fake JMAP server built
// from the redacted alert fixtures, so state, ordering and the skip rules are
// checked without a Fastmail account.
import assert from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import plugin from '../index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(here, 'fixtures', name), 'utf8');
const AUTH = JSON.parse(fixture('auth-results.json'));
const SENDER = 'jobalerts-noreply@linkedin.com';
const API_URL = 'https://api.fastmail.com/jmap/api/';

const email = (id, text, { from = SENDER, auth = AUTH, receivedAt }) => ({
  id,
  from: [{ email: from }],
  subject: `alert ${id}`,
  receivedAt,
  'header:Authentication-Results:asText:all': auth,
  textBody: [{ partId: '1' }],
  bodyValues: { 1: { value: text } },
});

/** A mailbox served over a fake JMAP API. `onGet` runs before each Email/get answers. */
function fakeFastmail(mailbox, { onGet } = {}) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    assert(opts.timeoutMs > 0, 'every request carries a timeout');
    calls.push(url);
    if (url === 'https://api.fastmail.com/jmap/session') {
      return { json: async () => ({ apiUrl: API_URL, primaryAccounts: { 'urn:ietf:params:jmap:mail': 'u1' } }) };
    }
    assert.strictEqual(url, API_URL);
    const { methodCalls } = JSON.parse(opts.body);
    const methodResponses = methodCalls.map(([name, args, tag]) => {
      if (name === 'Email/query') {
        assert.strictEqual(args.sort[0].isAscending, true);
        const sorted = [...mailbox].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
        const ids = sorted.slice(args.position, args.position + args.limit).map(e => e.id);
        return [name, { ids, total: mailbox.length }, tag];
      }
      if (name === 'Email/get') {
        onGet?.();
        // Servers need not answer in request order.
        return [name, { list: mailbox.filter(e => args.ids.includes(e.id)).reverse() }, tag];
      }
      return ['error', { type: 'unknownMethod' }, tag];
    });
    return { json: async () => ({ methodResponses }) };
  };
  return { fetch, calls };
}

function makeCtx(fetch, { dryRun = false, dataRoot } = {}) {
  const logs = [];
  return {
    ctx: {
      env: { FASTMAIL_API_TOKEN: 'fmu1-test' },
      settings: { days_back: 7 },
      fetch,
      log: (line) => logs.push(line),
      dryRun,
      dataRoot,
      // career-ops' url-key.mjs, reduced to the LinkedIn shapes the fixtures use.
      aggregatorPostingId: (url) => {
        const m = /^https:\/\/(?:[\w-]+\.)*linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/.exec(url);
        return m ? { domain: 'linkedin.com', id: m[1] } : null;
      },
    },
    logs,
  };
}

const dataRoot = mkdtempSync(path.join(tmpdir(), 'linkedin-alerts-fastmail-'));
const stateFile = path.join(dataRoot, 'data', 'linkedin-alerts-fastmail-state.json');
const readState = () => JSON.parse(readFileSync(stateFile, 'utf8'));

try {
  const forgedAuth = ['evil.test; dmarc=pass header.from=linkedin.com'];
  const mailbox = [
    email('digest', fixture('alert-digest.txt'), { receivedAt: '2026-11-01T01:00:00Z' }),
    email('hiring', fixture('alert-actively-hiring.txt'), { receivedAt: '2026-11-01T02:00:00Z' }),
    email('forged', fixture('alert-digest.txt'), { auth: forgedAuth, receivedAt: '2026-11-01T03:00:00Z' }),
    email('lookalike', fixture('alert-digest.txt'), { from: 'jobalerts-noreply@linkedin.com.evil.test', receivedAt: '2026-11-01T04:00:00Z' }),
    email('newlayout', 'Your job alert for anything\nnothing we can parse', { receivedAt: '2026-11-01T05:00:00Z' }),
  ];
  const server = fakeFastmail(mailbox);

  // A dry run returns the jobs but writes no state.
  {
    const { ctx } = makeCtx(server.fetch, { dryRun: true, dataRoot });
    const jobs = await plugin.ingest(ctx);
    assert.strictEqual(jobs.length, 12);
    assert(!existsSync(stateFile));
  }

  // A real run returns the same jobs as canonical view URLs, oldest email first.
  {
    const { ctx, logs } = makeCtx(server.fetch, { dataRoot });
    const jobs = await plugin.ingest(ctx);
    assert.strictEqual(jobs.length, 12);
    assert.deepStrictEqual(jobs[0], {
      title: 'Staff Engineer - Developer Productivity',
      url: 'https://www.linkedin.com/jobs/view/4485455514/',
      company: 'Jobgether',
      location: 'Canada',
    });
    assert.strictEqual(jobs[6].title, 'Staff Platform Engineer');
    // Only the emails that yielded jobs are marked processed.
    assert.deepStrictEqual(readState().processed_email_ids, ['digest', 'hiring']);
    assert.deepStrictEqual(readState().job_alerts['4485455514'], ['platform engineer in Canada']);
    assert(logs.some(l => /WARNING 1 alert\(s\) yielded no jobs/.test(l)));
    assert(logs.some(l => /WARNING 2 email\(s\) .* failed the sender or DMARC check/.test(l)));
  }

  // The next run adds nothing new, and the skipped emails are still reported.
  {
    const { ctx, logs } = makeCtx(server.fetch, { dataRoot });
    assert.deepStrictEqual(await plugin.ingest(ctx), []);
    assert(logs.some(l => /WARNING 1 alert\(s\) yielded no jobs/.test(l)));
    assert(logs.some(l => /WARNING 2 email\(s\)/.test(l)));
  }

  // A corrupt state file is reported and replaced, not a crash.
  {
    writeFileSync(stateFile, '{', 'utf8');
    const { ctx, logs } = makeCtx(server.fetch, { dataRoot });
    assert.strictEqual((await plugin.ingest(ctx)).length, 12);
    assert(logs.some(l => /WARNING could not read/.test(l)));
    assert.deepStrictEqual(readState().processed_email_ids, ['digest', 'hiring']);
  }

  // A backlog bigger than one run is read oldest first across runs, over
  // more than one Email/query page.
  {
    rmSync(path.join(dataRoot, 'data'), { recursive: true });
    const backlog = Array.from({ length: 300 }, (_, i) => email(`b${String(i).padStart(3, '0')}`, fixture('alert-digest.txt'), {
      receivedAt: new Date(Date.UTC(2026, 10, 1, 0, 0, i)).toISOString(),
    }));
    const big = fakeFastmail(backlog);
    const counts = [];
    for (let run = 0; run < 4; run++) {
      const { ctx, logs } = makeCtx(big.fetch, { dataRoot });
      await plugin.ingest(ctx);
      counts.push(readState().processed_email_ids.length);
      if (run < 2) assert(logs.some(l => /reading the oldest 100; the next run continues/.test(l)));
    }
    assert.deepStrictEqual(counts, [100, 200, 300, 300]);
    assert.strictEqual(readState().processed_email_ids[0], 'b000');
  }

  // A run that overruns its time budget saves nothing, so its alerts are read again.
  {
    rmSync(path.join(dataRoot, 'data'), { recursive: true });
    const realNow = Date.now;
    const slow = fakeFastmail(mailbox, { onGet: () => { const t = realNow() + 13_000; Date.now = () => t; } });
    try {
      const { ctx } = makeCtx(slow.fetch, { dataRoot });
      await assert.rejects(plugin.ingest(ctx), /ran out of time/);
    } finally {
      Date.now = realNow;
    }
    assert(!existsSync(stateFile));
  }

  // A JMAP method error fails the run with its type.
  {
    const broken = async (url) => (url.endsWith('/session')
      ? { json: async () => ({ apiUrl: API_URL, primaryAccounts: { 'urn:ietf:params:jmap:mail': 'u1' } }) }
      : { json: async () => ({ methodResponses: [['error', { type: 'invalidArguments', description: 'bad filter' }, 'q']] }) });
    const { ctx } = makeCtx(broken, { dataRoot });
    await assert.rejects(plugin.ingest(ctx), /JMAP invalidArguments — bad filter/);
  }

  // A missing token fails before any request.
  {
    const { fetch, calls } = fakeFastmail(mailbox);
    const { ctx } = makeCtx(fetch, { dataRoot });
    await assert.rejects(plugin.ingest({ ...ctx, env: {} }), /missing FASTMAIL_API_TOKEN/);
    assert.strictEqual(calls.length, 0);
  }
} finally {
  rmSync(dataRoot, { recursive: true, force: true });
}

console.log('✓ ingest tests ok');
