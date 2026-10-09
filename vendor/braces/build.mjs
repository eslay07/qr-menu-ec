import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = dirname(fileURLToPath(import.meta.url));
const entries = ['index', 'lib/compile', 'lib/expand', 'lib/parse', 'lib/stringify', 'lib/constants', 'lib/utils'];
for (const name of entries) {
 const output = resolve(root, 'build', name + '.js');
 const result = await build({ entryPoints: [resolve(root, 'src', name + '.js')], format: 'cjs', target: 'node18', write: false, sourcemap: false, legalComments: 'inline' });
 const contents = '// Generated from src/ by build.mjs; do not edit.\n' + result.outputFiles[0].text + '\nmodule.exports = module.exports.default;\n';
 if (process.argv.includes('--check')) {
  if (await readFile(output, 'utf8') !== contents) throw Error('Generated braces output differs: ' + name);
 } else {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, contents);
 }
}
console.log('braces CommonJS build ' + (process.argv.includes('--check') ? 'verified' : 'written'));
