// @ts-check
// Pure helpers for the linkedin-alerts-fastmail plugin: no network, no fs, so
// test/parse.test.mjs can exercise them against a saved alert.

// Fastmail's MX hosts stamp Authentication-Results with their own hostname as
// the authserv-id (seen: `phl-mx-05.messagingengine.com`). A receiver prepends
// its headers, so Fastmail's verdicts are the leading run; anything below that
// run arrived with the message and is the sender grading their own homework.
const FASTMAIL_AUTHSERV_ID = /^(?:[a-z0-9-]+\.)*messagingengine\.com$/i;

/**
 * Split an Authentication-Results value into clauses, dropping (nested)
 * comments and keeping `;` inside quoted strings, so a sender cannot forge a
 * clause boundary through a quoted local-part.
 * @param {string} value
 * @returns {string[]}
 */
export function authResultsClauses(value) {
  const clauses = [];
  let current = '';
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '\\' && (quoted || depth > 0) && i + 1 < value.length) {
      if (depth === 0) current += ch + value[i + 1];
      i++;
      continue;
    }
    if (quoted) {
      current += ch;
      if (ch === '"') quoted = false;
      continue;
    }
    if (depth > 0) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      continue;
    }
    if (ch === '(') { depth = 1; continue; }
    if (ch === '"') quoted = true;
    if (ch === ';') { clauses.push(current.replace(/\s+/g, ' ').trim()); current = ''; continue; }
    current += ch;
  }
  clauses.push(current.replace(/\s+/g, ' ').trim());
  return clauses.filter(Boolean);
}

/**
 * True when Fastmail's own verdict says DMARC passed for header.from=linkedin.com,
 * and no Fastmail DMARC verdict says otherwise.
 * @param {string[]} headers  Authentication-Results values, top of message first.
 */
export function isAuthenticLinkedIn(headers) {
  const dmarc = [];
  for (const h of headers || []) {
    const [id, ...rest] = authResultsClauses(String(h));
    // The authserv-id may carry an RFC 8601 version number after it.
    if (!FASTMAIL_AUTHSERV_ID.test((id || '').split(' ')[0])) break;
    dmarc.push(...rest.filter(c => /^dmarc=/i.test(c)));
  }
  return dmarc.length > 0 && dmarc.every(c =>
    /^dmarc=pass\b/i.test(c) && /(?:^|\s)header\.from=linkedin\.com(?:\s|$)/i.test(c));
}

// Lines LinkedIn prints under a card's location. Seen in 2026 alerts: "Top
// applicant", "Apply with resume & profile", "This company is actively hiring",
// "Fast growing". The rest are guesses at siblings, harmless when absent.
const BADGE = /^(top applicant|apply with resume|easy apply|this company is actively hiring|actively recruiting|fast growing|promoted|be an early applicant|\d[\d,]* (?:connections?|school alumni|company alumni)\b|.*\bconnections? work here\b|(?:CA|US|A)?\$[\d.,]+K?)/i;
const HEADER = [/^your job alert for\b/i, /\bjobs? matches? your preferences\.?$/i, /\bjobs? match your preferences\.?$/i];

/**
 * The saved search an alert email was sent for, from its "Your job alert for
 * <keywords> in <location>" header line, or '' when the line is missing.
 * @param {string} text
 * @returns {string}
 */
export function parseAlertName(text) {
  const m = String(text || '').match(/^\s*your job alert for\s+(.+?)\s*$/im);
  return m ? m[1] : '';
}

/**
 * Parse the plain-text part of a LinkedIn job-alert email into job cards.
 * Each card is a block between dashed rules: title, company, location, then
 * badge lines and a `View job: <url>` line. A block that does not carry at
 * least a title and a company is skipped, never emitted with a placeholder.
 * @param {string} text
 * @returns {{ title: string, company: string, location: string, link: string }[]}
 */
export function parseAlertText(text) {
  const cards = [];
  for (const block of String(text || '').split(/^\s*-{20,}\s*$/m)) {
    const m = block.match(/View job:\s*(https:\/\/\S+)/);
    if (!m) continue;
    const lines = block.slice(0, m.index).split('\n')
      .map(s => s.trim())
      .filter(s => s && !HEADER.some(re => re.test(s)));
    const [title, company, location = ''] = lines;
    if (!title || !company || BADGE.test(title) || BADGE.test(company)) continue;
    cards.push({ title, company, location: BADGE.test(location) ? '' : location, link: m[1] });
  }
  return cards;
}
