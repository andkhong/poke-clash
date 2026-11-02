// Checks each locale file against en.json: same ids, valid ICU, same placeholders and tags.
import { readFileSync } from 'node:fs';
import { parse, TYPE } from '@formatjs/icu-messageformat-parser';

const dir = new URL('../src/i18n/messages/', import.meta.url);
const load = (l) => JSON.parse(readFileSync(new URL(`${l}.json`, dir), 'utf8'));
const args = (ast, out = new Set()) => {
  for (const el of ast) {
    if (el.type !== TYPE.literal && el.type !== TYPE.pound) out.add(`${el.type}:${el.value}`);
    if (el.children) args(el.children, out);
    if (el.options) for (const o of Object.values(el.options)) args(o.value, out);
  }
  return out;
};
const key = (s) => [...s].sort().join(',');

const en = load('en');
let failed = false;
for (const locale of process.argv.slice(2).length ? process.argv.slice(2) : ['es', 'de', 'fr', 'ja']) {
  const msgs = load(locale);
  const problems = [];
  for (const id of Object.keys(en)) if (!(id in msgs)) problems.push(`missing ${id}`);
  for (const id of Object.keys(msgs)) if (!(id in en)) problems.push(`extra ${id}`);
  for (const [id, text] of Object.entries(msgs)) {
    if (!(id in en)) continue;
    try {
      if (key(args(parse(text))) !== key(args(parse(en[id])))) problems.push(`placeholders differ ${id}`);
    } catch (e) {
      problems.push(`bad ICU ${id}: ${e.message}`);
    }
  }
  console.log(`${locale}: ${problems.length ? problems.length + ' problems' : 'ok'}`);
  for (const p of problems.slice(0, 30)) console.log('  ' + p);
  if (problems.length) failed = true;
}
process.exit(failed ? 1 : 0);
