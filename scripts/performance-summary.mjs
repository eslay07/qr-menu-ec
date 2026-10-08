import { readFile, writeFile } from 'node:fs/promises';
const rows = [];
for (const kind of ['', 'owner-', 'session-']) for (const phase of ['before', 'after']) {
  let document;
  try { document = JSON.parse(await readFile(`outputs/mobile-performance/${kind}${phase}.json`, 'utf8')); } catch { continue; }
  const groups = new Map();
  for (const sample of document.results) {
    for (const metric of sample.temperature && !sample.interaction ? ['usableMs', 'lcp', 'cls'] : ['ms']) {
      if (metric === 'lcp' && !sample.lcp) continue;
      const key = [kind || 'public-', phase, sample.size || '-', sample.interaction || sample.mode || 'load', sample.temperature || '-', metric].join('|');
      const values = groups.get(key) || [];
      values.push(sample[metric]); groups.set(key, values);
    }
  }
  for (const [key, values] of groups) {
    values.sort((a,b) => a-b);
    const middle = Math.floor(values.length/2);
    rows.push({ key, count: values.length, median: values.length%2 ? values[middle] : (values[middle-1]+values[middle])/2, min: values[0], max: values.at(-1) });
  }
}
await writeFile('outputs/mobile-performance/summary.json', JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
console.log(JSON.stringify(rows, null, 2));
