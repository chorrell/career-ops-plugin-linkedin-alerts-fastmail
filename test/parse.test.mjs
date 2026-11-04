// Offline tests for the alert parser and the DMARC gate, against real 2026
// LinkedIn alerts (tracking params and recipient redacted).
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseAlertText, parseAlertName, isAuthenticLinkedIn } from '../_helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(here, 'fixtures', name), 'utf8');

// Digest alert: header lines in the first block, "Top applicant" badges.
const digest = parseAlertText(fixture('alert-digest.txt'));
assert.strictEqual(digest.length, 6);
assert.deepStrictEqual(
  { ...digest[0], link: undefined },
  { title: 'Staff Engineer - Developer Productivity', company: 'Jobgether', location: 'Canada', link: undefined },
);
assert.deepStrictEqual(digest[2].title, 'Senior Release Engineer');
assert.deepStrictEqual(digest[2].location, 'North York, ON');
assert.match(digest[0].link, /^https:\/\/www\.linkedin\.com\/comm\/jobs\/view\/4485455514\//);
// The "See all jobs" search link is not a card.
assert(digest.every(c => /\/jobs\/view\/\d+\//.test(c.link)));

// Alert with a blank line and "This company is actively hiring" under the card.
const hiring = parseAlertText(fixture('alert-actively-hiring.txt'));
assert.strictEqual(hiring.length, 6);
assert.deepStrictEqual(
  hiring.map(c => [c.title, c.company, c.location]).slice(0, 2),
  [['Staff Platform Engineer', 'Sage Recruiting Inc.', 'Canada'], ['Senior DevSecOps Engineer', 'ComPsych', 'Canada']],
);

// A card missing its company is dropped, never emitted with a placeholder.
assert.deepStrictEqual(parseAlertText('Some Title\nTop applicant\nView job: https://www.linkedin.com/comm/jobs/view/1/\n'), []);
assert.deepStrictEqual(parseAlertText('no cards here'), []);

// DMARC gate: Fastmail's real verdict passes.
const real = JSON.parse(fixture('auth-results.json'));
assert.strictEqual(isAuthenticLinkedIn(real), true);
// Fastmail says fail → rejected, even with a forged pass from the sender below it.
const failed = real.map(h => h.replace('dmarc=pass', 'dmarc=fail'));
assert.strictEqual(isAuthenticLinkedIn([...failed, 'evil.test; dmarc=pass header.from=linkedin.com']), false);
// A sender-written header under another authserv-id is ignored.
assert.strictEqual(isAuthenticLinkedIn(['evil.test; dmarc=pass header.from=linkedin.com']), false);
// A pass for a look-alike domain does not count.
assert.strictEqual(isAuthenticLinkedIn(['phl-mx-01.messagingengine.com; dmarc=pass header.from=linkedin.com.evil.test']), false);
// A quoted ";" cannot open a forged clause.
assert.strictEqual(isAuthenticLinkedIn(['phl-mx-01.messagingengine.com; spf=pass smtp.mailfrom="x;dmarc=pass header.from=linkedin.com"@evil.test']), false);
// No headers at all → rejected.
assert.strictEqual(isAuthenticLinkedIn([]), false);

// The saved search each alert belongs to, from the header line.
assert.strictEqual(parseAlertName(fixture('alert-digest.txt')), 'build and release engineer in Toronto');
assert.strictEqual(parseAlertName(fixture('alert-actively-hiring.txt')), 'Senior devops engineer in Toronto');
assert.strictEqual(parseAlertName('no header here'), '');

console.log('✓ parse + auth tests ok');
