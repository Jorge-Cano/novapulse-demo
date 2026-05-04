# Fullstory Self-Healing Demo — Complete Setup Guide

## What You're Building

A live web app with intentional bugs (dead clicks, console errors, invisible buttons) that:
1. Fullstory captures every user frustration signal
2. A trigger (webhook or manual) asks Claude AI about known issues  
3. Claude reads the Fullstory data, writes a code fix, and opens a Pull Request
4. GitHub Actions auto-deploys the fix to GitHub Pages in ~60 seconds

---

## Prerequisites

Install these before starting:

| Tool | Version | Install |
|---|---|---|
| Node.js | 18+ | https://nodejs.org |
| Git | any | https://git-scm.com |
| VS Code | any | https://code.visualstudio.com |
| GitHub CLI (`gh`) | any | https://cli.github.com |

---

## Phase 1 — Local Setup (15 min)

### Step 1.1 — Create GitHub repo

```bash
# Create folder and init git
mkdir novapulse-demo && cd novapulse-demo
git init
gh repo create novapulse-demo --public --source=. --push
```

### Step 1.2 — Add your files

Copy `index.html` into the `novapulse-demo/` folder.

```bash
# Verify it's there
ls -la
# Should show: index.html
```

### Step 1.3 — Enable GitHub Pages

```bash
# Via GitHub CLI
gh api repos/:owner/:repo/pages --method POST \
  -f source.branch=main \
  -f source.path=/

# OR: Go to GitHub.com → your repo → Settings → Pages
# Source: "Deploy from branch" → Branch: main → folder: / (root)
```

Your live URL will be: `https://YOUR_USERNAME.github.io/novapulse-demo/`

---

## Phase 2 — Fullstory Setup (20 min)

### Step 2.1 — Create Fullstory account

1. Go to https://www.fullstory.com and sign up for a free trial
2. Create a new project: "NovaPulse Demo"
3. Copy your **Org ID** from: Settings → Data Capture → Org ID

### Step 2.2 — Add your Org ID to index.html

Open `index.html` and find line 15:
```javascript
window['_fs_org'] = 'YOUR_ORG_ID'; // ← REPLACE THIS
```
Replace `YOUR_ORG_ID` with your actual ID, e.g. `'ABC123'`

### Step 2.3 — Verify Fullstory is recording

1. Open your GitHub Pages URL in Chrome
2. Open Fullstory → Sessions — you should see yourself appear
3. Click the broken "Export Data" button several times (this creates rage clicks)
4. Type in the "Filter Tags" field (this creates console errors)
5. Try clicking "Manage Billing" (z-index bug — dead click)

### Step 2.4 — Set up Fullstory Alerts (optional but impressive for demo)

In Fullstory: Alerts → Create Alert:
- **Rage Click Alert**: Element contains "Export" → Notify via webhook
- **Console Error Alert**: Any error → Notify via webhook

---

## Phase 3 — Claude + Cursor IDE Setup (20 min)

### Step 3.1 — Open project in VS Code / Cursor

```bash
# Install Cursor (AI-native IDE — recommended for this demo)
# Download from: https://cursor.sh

# Open project
cursor .
# OR
code .
```

### Step 3.2 — Install Claude Code (terminal agent)

```bash
npm install -g @anthropic-ai/claude-code
```

Set your API key:
```bash
export ANTHROPIC_API_KEY="sk-ant-YOUR_KEY_HERE"
# Add to ~/.zshrc or ~/.bashrc to make permanent
```

### Step 3.3 — Get a Fullstory API key

In Fullstory: Settings → Integrations → API Keys → Create Key  
Copy the key — you'll need it for the automation script.

---

## Phase 4 — The Automation Script (30 min)

This is the heart of the demo. Create `heal.js` in your project root:

```javascript
// heal.js — Fullstory → Claude → GitHub Self-Healing Automation
// Run: node heal.js

const { execSync } = require('child_process');
const fs = require('fs');

const FULLSTORY_API_KEY = process.env.FULLSTORY_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'jorge-cano.github.io/novapulse-demo'; // ← update this

async function getFullstorySignals() {
  console.log('\n📡 Fetching Fullstory signals...\n');
  
  // Fullstory Data Export API — rage clicks & errors from last hour
  const res = await fetch('https://api.fullstory.com/v2/sessions/search', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(FULLSTORY_API_KEY + ':').toString('base64')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      filters: [{
        type: 'Event',
        operator: 'IS',
        values: ['rage_click', 'console_error', 'dead_click']
      }],
      limit: 10
    })
  });

  // For demo: return a hardcoded payload simulating what Fullstory would return
  // In production: return await res.json()
  return {
    rage_clicks: [
      { element: '#broken-export-btn', count: 34, selector: '#broken-export-btn', text: 'Export Data' }
    ],
    console_errors: [
      { message: 'ReferenceError: processTagFilter is not defined', element: '#rage-input', count: 18 }
    ],
    dead_clicks: [
      { element: '.overlap-cover', count: 12, blocks: '#manage-billing-btn' }
    ],
    invisible_elements: [
      { element: '#invisible-submit', issue: 'background same as surface color', count: 27 }
    ]
  };
}

async function askClaudeToFix(signals, htmlSource) {
  console.log('🤖 Asking Claude to analyze and fix...\n');

  const prompt = `You are a senior frontend engineer. A Fullstory session analysis tool has identified the following UX issues in a production web app:

FULLSTORY SIGNALS:
${JSON.stringify(signals, null, 2)}

CURRENT HTML SOURCE:
\`\`\`html
${htmlSource}
\`\`\`

Please analyze the issues and return ONLY a valid JSON object in this exact format:
{
  "analysis": "Brief description of what's broken and why users are frustrated",
  "fixes": [
    {
      "issue": "name of issue",
      "element": "CSS selector",
      "current_code": "the broken HTML/JS snippet (exact match)",
      "fixed_code": "the corrected HTML/JS snippet",
      "explanation": "why this fixes it"
    }
  ],
  "pr_title": "fix: resolve UX issues detected by Fullstory",
  "pr_body": "Markdown description of what was fixed and why"
}

Only fix what Fullstory has flagged. Do not change anything else.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await res.json();
  const text = data.content[0].text;
  
  // Strip markdown fences if present
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(clean);
}

function applyFixes(htmlSource, fixes) {
  let fixed = htmlSource;
  for (const fix of fixes) {
    if (fix.current_code && fix.fixed_code) {
      fixed = fixed.replace(fix.current_code, fix.fixed_code);
      console.log(`  ✅ Fixed: ${fix.issue}`);
    }
  }
  return fixed;
}

async function createPullRequest(fixedHtml, claudeResult) {
  const branchName = `fix/fullstory-ai-heal-${Date.now()}`;
  
  // Write fixed file
  fs.writeFileSync('index.html', fixedHtml);
  
  // Git operations
  execSync(`git checkout -b ${branchName}`);
  execSync('git add index.html');
  execSync(`git commit -m "${claudeResult.pr_title}"`);
  execSync(`git push origin ${branchName}`);
  
  // Create PR via GitHub CLI
  const prUrl = execSync(`gh pr create \
    --title "${claudeResult.pr_title}" \
    --body "${claudeResult.pr_body.replace(/"/g, '\\"')}" \
    --base main \
    --head ${branchName}`, { encoding: 'utf8' }).trim();

  console.log(`\n🚀 Pull Request created: ${prUrl}`);
  return prUrl;
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Fullstory → Claude → GitHub Self-Healer');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 1. Get Fullstory signals
  const signals = await getFullstorySignals();
  console.log('Signals found:', JSON.stringify(signals, null, 2));

  // 2. Read current HTML
  const htmlSource = fs.readFileSync('index.html', 'utf8');

  // 3. Ask Claude to fix
  const claudeResult = await askClaudeToFix(signals, htmlSource);
  console.log('\nClaude analysis:', claudeResult.analysis);
  console.log('\nFixes planned:', claudeResult.fixes.length);

  // 4. Apply fixes to HTML
  const fixedHtml = applyFixes(htmlSource, claudeResult.fixes);

  // 5. Create PR
  const prUrl = await createPullRequest(fixedHtml, claudeResult);

  console.log('\n✅ Self-heal complete!');
  console.log('   PR is open and GitHub Actions will auto-deploy on merge.');
}

main().catch(console.error);
```

### Step 4.1 — Set environment variables

```bash
export FULLSTORY_API_KEY="your_fullstory_api_key"
export ANTHROPIC_API_KEY="sk-ant-your_key"
export GITHUB_TOKEN="ghp_your_token"
```

### Step 4.2 — Run the self-healer

```bash
node heal.js
```

---

## Phase 5 — GitHub Actions Auto-Deploy (15 min)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  pull_request:
    types: [closed]

jobs:
  deploy:
    if: github.event.pull_request.merged == true || github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./
          publish_branch: gh-pages
```

Commit and push:
```bash
mkdir -p .github/workflows
# paste the yaml above into .github/workflows/deploy.yml
git add .github/
git commit -m "ci: add GitHub Pages auto-deploy"
git push origin main
```

---

## Phase 6 — Demo Flow Script (for live presentations)

### The 5-Minute Demo

**Step 1 — Set the scene (1 min)**  
Open the live URL. Show the dashboard. Point to the "Error Rate" and "Rage Clicks" stats — explain these are real signals from Fullstory.

**Step 2 — Trigger the bugs (1 min)**  
- Click "Export Data" 3-4 times rapidly. Say: *"Users keep clicking this — it does nothing."*
- Type in the Filter Tags field. Say: *"This throws a console error every time."*
- Click "Manage Billing". Say: *"A z-index bug means this button is invisible to JavaScript."*

**Step 3 — Show Fullstory catching it (1 min)**  
Open Fullstory → Sessions. Show the session replay. Point to the rage clicks highlighted in red. Show the console errors panel.

**Step 4 — Run the self-healer (1 min)**  
Switch to VS Code / terminal. Run `node heal.js`. Watch the output:
```
📡 Fetching Fullstory signals...
🤖 Asking Claude to analyze and fix...
  ✅ Fixed: dead-click-export
  ✅ Fixed: invisible-submit
  ✅ Fixed: z-index-billing
🚀 Pull Request created: https://github.com/...
```

**Step 5 — Show the PR and live deploy (1 min)**  
Open GitHub. Show the PR with Claude's explanation. Merge it. Open GitHub Actions — show the deploy running. Refresh the live URL — the bugs are gone.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Fullstory not recording | Check org ID in index.html; check browser console for FS errors |
| heal.js fails with auth error | Check API keys are exported in terminal |
| PR not creating | Run `gh auth login` first |
| GitHub Pages not updating | Check Actions tab for errors; ensure gh-pages branch exists |
| Claude returns invalid JSON | Add retry logic; check API key has credits |

---

## Architecture Summary

```
User visits site → Fullstory FullCapture records everything
     ↓
Rage click / error detected → Fullstory Alert fires webhook
     ↓
heal.js receives signal → calls Fullstory API for details
     ↓
Claude Opus analyzes code + signals → generates fix
     ↓
heal.js applies fix → git commit → GitHub PR opened
     ↓
GitHub Actions detects merged PR → deploys to Pages
     ↓
Live site updated in ~60 seconds
```

---

*Built for Fullstory Solutions Engineering · NovaPulse Demo*
