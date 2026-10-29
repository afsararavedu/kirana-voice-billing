// Fails the build if anything resembling an LLM/speech provider secret or direct provider call
// reached the browser bundle. API keys live only on the server (CLAUDE.md "Keep API keys
// exclusively on the server"); the browser talks to /api/v1 only.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const FORBIDDEN = [
  /sk-ant-[A-Za-z0-9_-]{8,}/, // Anthropic key format
  /ANTHROPIC_API_KEY/,
  /api\.anthropic\.com/,
  /x-api-key/i,
];

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|html|css|json)$/.test(name)) files.push(p);
  }
};
walk(dist);

const hits = [];
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const re of FORBIDDEN) if (re.test(text)) hits.push(`${f}: ${re}`);
}
if (hits.length) {
  console.error(`Secrets or provider calls found in the web bundle:\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
console.log(`bundle check: ${files.length} files, no provider keys or direct provider calls`);
