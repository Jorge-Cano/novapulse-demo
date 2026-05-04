// ═══════════════════════════════════════════════════════════
//   heal.js — Fullstory → Claude → GitHub Self-Healing Demo
//   LIVE Fullstory API edition
//   Run: node heal.js
// ═══════════════════════════════════════════════════════════

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── Config ───────────────────────────────────────────────────
const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
const FULLSTORY_API_KEY  = process.env.FULLSTORY_API_KEY;
const FULLSTORY_ORG_ID   = process.env.FULLSTORY_ORG_ID;
const HTML_FILE          = path.join(__dirname, 'index.html');

// ── Terminal colors ───────────────────────────────────────────
const C = {
  reset:   '\x1b[0m',   bold:    '\x1b[1m',   dim:     '\x1b[2m',
  red:     '\x1b[31m',  green:   '\x1b[32m',  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',  magenta: '\x1b[35m',  cyan:    '\x1b[36m',
  white:   '\x1b[37m',
};

const W = Math.min(process.stdout.columns || 72, 80);

function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*m/g, ''); }
function rule(ch = '━', col = C.dim) { console.log(col + ch.repeat(W) + C.reset); }

function header(title, sub = '') {
  console.log('');
  rule('━', C.blue);
  console.log(`  ${C.bold}${C.cyan}${title}${C.reset}`);
  if (sub) console.log(`  ${C.dim}${sub}${C.reset}`);
  rule('━', C.blue);
  console.log('');
}

function section(emoji, title, col = C.cyan) {
  console.log('');
  console.log(`${col}${C.bold}${emoji}  ${title}${C.reset}`);
  rule('─', C.dim);
}

function row(label, value, vcol = C.white) {
  const l = `  ${C.dim}${label.padEnd(26)}${C.reset}`;
  console.log(`${l}${vcol}${value}${C.reset}`);
}

function sevColor(n) {
  if (n >= 20) return C.red;
  if (n >= 10) return C.yellow;
  return C.green;
}

// ── Fullstory REST helper ─────────────────────────────────────
async function fsRequest(endpoint, body = null) {
  const url  = `https://api.fullstory.com${endpoint}`;
  const auth = Buffer.from(FULLSTORY_API_KEY + ':').toString('base64');
  const opts = {
    method: body ? 'POST' : 'GET',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`FS API ${res.status} @ ${endpoint}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

// ── Live Fullstory signal fetch ───────────────────────────────
async function getFullstorySignals() {
  section('📡', 'CONNECTING TO FULLSTORY API', C.magenta);

  if (!FULLSTORY_API_KEY || !FULLSTORY_ORG_ID) {
    console.log(`\n  ${C.yellow}${C.bold}⚠  No Fullstory credentials — running in DEMO MODE${C.reset}`);
    console.log(`  ${C.dim}Set these env vars to use live data:${C.reset}`);
    console.log(`  ${C.cyan}    export FULLSTORY_API_KEY="your_key"${C.reset}`);
    console.log(`  ${C.cyan}    export FULLSTORY_ORG_ID="your_org_id"\n${C.reset}`);
    return getDemoSignals();
  }

  row('Org ID',    FULLSTORY_ORG_ID, C.cyan);
  row('API Key',   FULLSTORY_API_KEY.slice(0, 8) + '···', C.dim);
  row('Endpoint',  'api.fullstory.com', C.dim);
  console.log('');

  try {
    // ── Fetch recent sessions ──────────────────────────────
    process.stdout.write(`  ${C.dim}Querying recent sessions...${C.reset}`);
    const sessionResp = await fsRequest('/v2/sessions/search', {
      filters: [],
      limit: 25,
      sort: { field: 'CreatedTime', order: 'desc' }
    });
    const sessions = sessionResp.sessions || sessionResp.results || [];
    process.stdout.write(`\r  ${C.green}✓ ${sessions.length} sessions retrieved${C.reset}              \n`);

    // ── Walk events per session ────────────────────────────
    let rageSummary   = {};
    let errorSummary  = {};
    let deadSummary   = {};
    let sessionRows   = [];

    for (const sess of sessions.slice(0, 10)) {
      const sid = sess.SessionId || sess.sessionId || sess.id;
      if (!sid) continue;
      try {
        const evResp = await fsRequest(`/v2/sessions/${sid}/events`);
        const events = evResp.events || evResp.results || [];
        for (const ev of events) {
          const type    = (ev.type || ev.EventType || '').toLowerCase();
          const target  = ev.target || ev.selector || ev.elementSelector || 'unknown';
          const message = ev.message || ev.errorMessage || type;
          if (type.includes('rage') || type.includes('click_rage')) {
            rageSummary[target] = (rageSummary[target] || 0) + 1;
          }
          if (type.includes('error') || type.includes('console')) {
            errorSummary[message] = (errorSummary[message] || 0) + 1;
          }
          if (type.includes('dead') || type.includes('unresponsive')) {
            deadSummary[target] = (deadSummary[target] || 0) + 1;
          }
        }
      } catch (_) { /* skip inaccessible sessions */ }

      sessionRows.push({
        id:        sid,
        user:      sess.UserEmail || sess.userId || 'Anonymous',
        duration:  sess.DurationMs ? `${Math.round(sess.DurationMs / 1000)}s` : '—',
        pages:     sess.PageCount  || '?',
        created:   sess.CreatedTime ? new Date(sess.CreatedTime).toLocaleString() : '—',
        browser:   sess.Browser    || '?',
        country:   sess.UserCountry|| '?',
      });
    }

    return {
      live: true,
      sessions: sessionRows,
      rage_clicks:       Object.entries(rageSummary).map(([element, count]) => ({ element, count, message: 'Rapid repeated clicks — no response' })),
      console_errors:    Object.entries(errorSummary).map(([message, count]) => ({ message, count, context: 'Caught by Fullstory FullCapture' })),
      dead_clicks:       Object.entries(deadSummary).map(([element, count]) => ({ element, count, message: 'Click hit non-interactive element' })),
      invisible_elements: [],
    };

  } catch (err) {
    console.log(`\n  ${C.yellow}⚠  Live API error: ${err.message}${C.reset}`);
    console.log(`  ${C.dim}Falling back to demo mode...\n${C.reset}`);
    return getDemoSignals();
  }
}

// ── Demo signals (mirrors real Fullstory schema) ──────────────
function getDemoSignals() {
  return {
    live: false,
    sessions: [
      { id: 'sess_abc123', user: 'user@acme.com',    duration: '142s', pages: 3, created: new Date().toLocaleString(), browser: 'Chrome 124', country: 'US' },
      { id: 'sess_def456', user: 'Anonymous',        duration: '67s',  pages: 1, created: new Date().toLocaleString(), browser: 'Safari 17',  country: 'CA' },
      { id: 'sess_ghi789', user: 'jorge@example.com',duration: '203s', pages: 5, created: new Date().toLocaleString(), browser: 'Chrome 124', country: 'US' },
    ],
    rage_clicks: [
      { element: '#broken-export-btn', count: 34, message: 'No response — handler missing on Export button' },
      { element: '.form-section',      count: 27, message: 'Submit button invisible — users clicking nearby area' },
    ],
    console_errors: [
      { message: 'ReferenceError: processTagFilter is not defined', count: 18, context: 'Thrown on every keystroke in #rage-input (Filter Tags field)' },
      { message: 'TypeError: Cannot read properties of null',       count:  4, context: 'Dashboard init — data.nonexistent.property at line ~690' },
    ],
    dead_clicks: [
      { element: '.overlap-cover', count: 12, message: 'Transparent overlay intercepts clicks to #manage-billing-btn' },
    ],
    invisible_elements: [
      { element: '#invisible-submit', issue: 'background color matches --surface — button is invisible to users', rage_clicks_nearby: 27 },
    ],
  };
}

// ── Print signal report to terminal ──────────────────────────
function printSignals(signals) {
  section('📊', 'FULLSTORY SIGNAL REPORT', C.cyan);

  const modeStr = signals.live
    ? `${C.green}${C.bold}● LIVE  (Fullstory API)${C.reset}`
    : `${C.yellow}${C.bold}◎ DEMO MODE  (simulated data)${C.reset}`;

  row('Source',          signals.live ? 'Fullstory Data Export API' : 'Simulated demo payload', signals.live ? C.green : C.yellow);
  row('Mode',            modeStr);
  row('Sessions scanned', String(signals.sessions?.length || 0), C.cyan);
  row('Timestamp',       new Date().toLocaleString(), C.dim);

  // Sessions table
  if (signals.sessions?.length) {
    console.log(`\n  ${C.bold}${C.white}Recent Sessions${C.reset}`);
    console.log(`  ${C.dim}${'─'.repeat(68)}${C.reset}`);
    console.log(`  ${C.dim}${'ID'.padEnd(16)}${'User'.padEnd(24)}${'Time'.padEnd(8)}${'Pages'.padEnd(7)}Browser${C.reset}`);
    console.log(`  ${C.dim}${'─'.repeat(68)}${C.reset}`);
    for (const s of signals.sessions.slice(0, 5)) {
      console.log(
        `  ${C.cyan}${s.id.slice(0,14).padEnd(16)}${C.reset}` +
        `${C.white}${s.user.slice(0,22).padEnd(24)}${C.reset}` +
        `${C.dim}${s.duration.padEnd(8)}${String(s.pages).padEnd(7)}${s.browser}${C.reset}`
      );
    }
  }

  // Rage clicks
  console.log(`\n  ${C.red}${C.bold}🖱  RAGE CLICKS${C.reset}  ${C.dim}— frustrated repeated clicking${C.reset}`);
  if (signals.rage_clicks?.length) {
    for (const r of signals.rage_clicks) {
      console.log(`  ${sevColor(r.count)}${C.bold}  ✕ ${String(r.count).padStart(3)} hits${C.reset}  ${C.white}${r.element}${C.reset}`);
      console.log(`  ${C.dim}          └ ${r.message}${C.reset}`);
    }
  } else { console.log(`  ${C.green}  None detected${C.reset}`); }

  // Console errors
  console.log(`\n  ${C.yellow}${C.bold}⚠  CONSOLE ERRORS${C.reset}  ${C.dim}— JS exceptions in live sessions${C.reset}`);
  if (signals.console_errors?.length) {
    for (const e of signals.console_errors) {
      console.log(`  ${sevColor(e.count)}${C.bold}  ✕ ${String(e.count).padStart(3)}x${C.reset}  ${C.white}${e.message}${C.reset}`);
      console.log(`  ${C.dim}          └ ${e.context}${C.reset}`);
    }
  } else { console.log(`  ${C.green}  None detected${C.reset}`); }

  // Dead clicks
  console.log(`\n  ${C.magenta}${C.bold}☠  DEAD CLICKS${C.reset}  ${C.dim}— clicks that go nowhere${C.reset}`);
  if (signals.dead_clicks?.length) {
    for (const d of signals.dead_clicks) {
      console.log(`  ${sevColor(d.count)}${C.bold}  ✕ ${String(d.count).padStart(3)} hits${C.reset}  ${C.white}${d.element}${C.reset}`);
      console.log(`  ${C.dim}          └ ${d.message}${C.reset}`);
    }
  } else { console.log(`  ${C.green}  None detected${C.reset}`); }

  // Invisible UI
  console.log(`\n  ${C.yellow}${C.bold}👻  INVISIBLE UI${C.reset}  ${C.dim}— elements users cannot see or find${C.reset}`);
  if (signals.invisible_elements?.length) {
    for (const i of signals.invisible_elements) {
      console.log(`  ${C.red}${C.bold}  ✕ ${String(i.rage_clicks_nearby || 0).padStart(3)} nearby rage clicks${C.reset}  ${C.white}${i.element}${C.reset}`);
      console.log(`  ${C.dim}          └ ${i.issue}${C.reset}`);
    }
  } else { console.log(`  ${C.green}  None detected${C.reset}`); }

  // Totals
  const totRage   = (signals.rage_clicks       || []).reduce((s, r) => s + r.count, 0);
  const totErrors = (signals.console_errors    || []).reduce((s, e) => s + e.count, 0);
  const totDead   = (signals.dead_clicks       || []).reduce((s, d) => s + d.count, 0);
  const totInvis  = (signals.invisible_elements|| []).reduce((s, i) => s + (i.rage_clicks_nearby || 0), 0);
  const total     = totRage + totErrors + totDead + totInvis;

  console.log('');
  rule('─', C.dim);
  console.log(`  ${C.bold}TOTAL FRICTION EVENTS:  ${C.red}${C.bold}${total}${C.reset}`);
  row('  Rage clicks',        `${totRage} events`,   C.red);
  row('  Console errors',     `${totErrors} throws`, C.yellow);
  row('  Dead clicks',        `${totDead} events`,   C.magenta);
  row('  Invisible UI hits',  `${totInvis} events`,  C.yellow);
  rule('─', C.dim);
}

// ── Ask Claude ─────────────────────────────────────────────────
async function askClaude(signals, htmlSource) {
  section('🤖', 'CLAUDE AI ANALYSIS', C.magenta);

  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set.\nRun: export ANTHROPIC_API_KEY="sk-ant-..."');
  }

  row('Model',   'claude-opus-4-5');
  row('Input',   `${htmlSource.length.toLocaleString()} chars HTML + live signal JSON`);
  console.log('');
  process.stdout.write(`  ${C.dim}Sending to Claude, waiting for response...${C.reset}`);

  const prompt = `You are a senior frontend engineer reviewing real user frustration data from Fullstory session analytics.

FULLSTORY SIGNALS (live behavioral data):
${JSON.stringify(signals, null, 2)}

CURRENT HTML SOURCE:
\`\`\`html
${htmlSource}
\`\`\`

Return ONLY valid JSON — no markdown fences, no explanation outside JSON:

{
  "analysis": "2-3 sentence summary of what is broken and why users are frustrated",
  "severity": "critical|high|medium",
  "affected_users_estimate": "rough percentage or description",
  "fixes": [
    {
      "issue": "short name",
      "element": "CSS selector",
      "signal_type": "rage_click|console_error|dead_click|invisible_element",
      "explanation": "why this fix resolves the frustration signal",
      "current_code": "exact verbatim snippet from the HTML above",
      "fixed_code": "corrected replacement snippet"
    }
  ],
  "pr_title": "fix: resolve UX issues detected by Fullstory",
  "pr_body": "## Fullstory Self-Heal\\n\\nAuto-generated by Claude AI from live Fullstory behavioral signals.\\n\\n### Signals That Triggered This\\n\\n[list signals]\\n\\n### Fixes Applied\\n\\n[list each fix with explanation]"
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  process.stdout.write('\r' + ' '.repeat(50) + '\r');

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Claude API ${res.status}: ${txt.slice(0, 300)}`);
  }

  const data  = await res.json();
  const raw   = data.content[0].text;
  const clean = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim();

  let result;
  try { result = JSON.parse(clean); }
  catch (e) {
    console.error(`\n${C.red}Unparseable Claude response:${C.reset}\n`, raw);
    throw new Error('Failed to parse Claude JSON.');
  }

  const sevCol = result.severity === 'critical' ? C.red : result.severity === 'high' ? C.yellow : C.green;
  row('Severity',        (result.severity || 'unknown').toUpperCase(), sevCol + C.bold);
  row('Affected users',  result.affected_users_estimate || '—', C.yellow);
  console.log('');
  console.log(`  ${C.bold}Analysis:${C.reset}`);
  console.log(`  ${C.white}${result.analysis}${C.reset}`);
  console.log('');
  console.log(`  ${C.bold}Fixes planned: ${C.cyan}${result.fixes?.length || 0}${C.reset}`);
  for (const fix of (result.fixes || [])) {
    const sc = fix.signal_type?.includes('error') ? C.yellow : C.red;
    console.log(`  ${sc}  → ${C.white}${fix.issue}${C.reset}  ${C.dim}(${fix.signal_type})${C.reset}`);
    console.log(`  ${C.dim}     ${fix.explanation}${C.reset}`);
  }

  return result;
}

// ── Apply fixes ────────────────────────────────────────────────
function applyFixes(htmlSource, fixes) {
  section('🔧', 'APPLYING CODE FIXES', C.green);

  let fixed = htmlSource;
  let count = 0;

  for (const fix of (fixes || [])) {
    if (!fix.current_code || !fix.fixed_code) {
      console.log(`  ${C.yellow}⚠  Skipped "${fix.issue}" — missing snippet${C.reset}`); continue;
    }
    if (!fixed.includes(fix.current_code)) {
      console.log(`  ${C.yellow}⚠  Skipped "${fix.issue}" — snippet not found in HTML${C.reset}`); continue;
    }
    fixed = fixed.replace(fix.current_code, fix.fixed_code);
    console.log(`  ${C.green}${C.bold}✅  ${fix.issue}${C.reset}`);
    console.log(`  ${C.dim}    Element:  ${fix.element}${C.reset}`);
    console.log(`  ${C.dim}    Signal:   ${fix.signal_type}${C.reset}`);
    console.log('');
    count++;
  }

  row('Total fixes applied', String(count), C.green + C.bold);
  return fixed;
}

// ── Git + GitHub PR ────────────────────────────────────────────
function createPullRequest(fixedHtml, claudeResult) {
  section('🚀', 'OPENING GITHUB PULL REQUEST', C.blue);

  const branch = `fix/fullstory-ai-heal-${Date.now()}`;
  fs.writeFileSync(HTML_FILE, fixedHtml, 'utf8');

  row('Branch', branch, C.cyan);
  execSync(`git checkout -b ${branch}`,              { stdio: 'pipe' });
  execSync('git add index.html',                     { stdio: 'pipe' });
  execSync(`git commit -m "${claudeResult.pr_title}"`,{ stdio: 'pipe' });
  execSync(`git push origin ${branch}`,              { stdio: 'pipe' });
  row('Committed & pushed', 'index.html', C.green);

  const safeBody = claudeResult.pr_body.replace(/"/g,'\\"').replace(/`/g,'\\`');
  const prUrl = execSync(
    `gh pr create --title "${claudeResult.pr_title}" --body "${safeBody}" --base main --head ${branch}`,
    { encoding: 'utf8' }
  ).trim();

  row('PR URL', prUrl, C.cyan + C.bold);
  return prUrl;
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  header(
    'FULLSTORY  ×  CLAUDE AI  ×  GITHUB',
    'Self-Healing Web Application  |  Fullstory Solutions Engineering Demo'
  );

  const signals    = await getFullstorySignals();
  printSignals(signals);

  if (!fs.existsSync(HTML_FILE)) throw new Error(`index.html not found at ${HTML_FILE}`);
  const htmlSource = fs.readFileSync(HTML_FILE, 'utf8');

  const claudeResult = await askClaude(signals, htmlSource);
  const fixedHtml    = applyFixes(htmlSource, claudeResult.fixes);
  const prUrl        = createPullRequest(fixedHtml, claudeResult);

  console.log('');
  rule('━', C.green);
  console.log(`  ${C.green}${C.bold}✅  SELF-HEAL COMPLETE${C.reset}`);
  rule('━', C.green);
  console.log('');
  row('Pull Request', prUrl, C.cyan + C.bold);
  console.log('');
  console.log(`  ${C.bold}Next steps:${C.reset}`);
  console.log(`  ${C.dim}1.${C.reset}  Review the PR:    ${C.cyan}gh pr view --web${C.reset}`);
  console.log(`  ${C.dim}2.${C.reset}  Merge it:         ${C.cyan}gh pr merge --auto --squash${C.reset}`);
  console.log(`  ${C.dim}3.${C.reset}  Watch deploy:     ${C.cyan}gh run watch${C.reset}`);
  console.log(`  ${C.dim}4.${C.reset}  ${C.green}Site healed live in ~60 seconds${C.reset}\n`);
}

main().catch(err => {
  console.error(`\n${C.red}${C.bold}❌  Error:${C.reset} ${err.message}\n`);
  process.exit(1);
});
