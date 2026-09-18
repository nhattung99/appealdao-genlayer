const fs = require('fs');
const path = require('path');

const WINDOW = 12;
const BLOCK_MAX = 40;
const EXTENSIONS = new Set(['.js', '.jsx']);
const FORBIDDEN = /\bparseFloat\s*\(|Math\.round\s*\(|Math\.floor\s*\(|Math\.ceil\s*\(/;
const MONEY = /deposit|bonus|pool|balance|payout|wei|gen|amount/i;

function resolveSrcDir() {
  const candidates = [
    path.join(__dirname, '..', 'frontend', 'src'),
    path.join(__dirname, '..', 'src'),
  ];
  return candidates.find((dir) => fs.existsSync(dir));
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (EXTENSIONS.has(path.extname(entry.name))) acc.push(full);
  }
  return acc;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function enclosingBlockRange(lines, index) {
  let start = index;
  let depth = 0;
  for (let i = index; i >= 0 && (index - i) < BLOCK_MAX; i--) {
    const opens = (lines[i].match(/\{/g) || []).length;
    const closes = (lines[i].match(/\}/g) || []).length;
    depth += closes - opens;
    start = i;
    if (depth > 0) continue;
    if (opens > 0) break;
  }
  let end = index;
  depth = 0;
  for (let i = index; i < lines.length && (i - index) < BLOCK_MAX; i++) {
    const opens = (lines[i].match(/\{/g) || []).length;
    const closes = (lines[i].match(/\}/g) || []).length;
    depth += opens - closes;
    end = i;
    if (i > index && depth <= 0 && closes > 0) break;
  }
  return { start, end };
}

function runCheck() {
  console.log('Running prebuild check: auditing frontend for floating-point money math...');
  const src = resolveSrcDir();
  if (!src) {
    console.error('[BUILD REJECTED] Could not locate frontend/src for float-money audit.');
    process.exit(1);
  }

  const root = path.resolve(src, '..', '..');
  const files = walk(src);
  let failed = false;
  let hitCount = 0;

  for (const file of files) {
    const relativePath = path.relative(root, file);
    const content = stripComments(fs.readFileSync(file, 'utf8'));
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      if (!FORBIDDEN.test(line)) return;
      FORBIDDEN.lastIndex = 0;

      const windowStart = Math.max(0, index - WINDOW);
      const windowEnd = Math.min(lines.length - 1, index + WINDOW);
      const windowText = lines.slice(windowStart, windowEnd + 1).join('\n');
      const block = enclosingBlockRange(lines, index);
      const blockText = lines.slice(block.start, block.end + 1).join('\n');

      const sameLine = MONEY.test(line);
      const nearWindow = MONEY.test(windowText);
      const nearBlock = MONEY.test(blockText);
      if (sameLine || nearWindow || nearBlock) {
        hitCount += 1;
        const reason = sameLine ? 'same line' : (nearWindow ? `within ±${WINDOW} lines` : 'same code block');
        console.error(`[ERROR] Float operation near monetary identifier (${reason}) in ${relativePath}:${index + 1}`);
        console.error(`  > ${line.trim()}`);
        failed = true;
      }
    });
  }

  if (failed) {
    console.error(`[BUILD REJECTED] ${hitCount} floating-point operation(s) near money identifiers. Use parseGenToWei / formatWeiToGen.`);
    process.exit(1);
  }

  console.log(`[PASS] No floating-point money math. ${files.length} files scanned.`);
}

runCheck();
