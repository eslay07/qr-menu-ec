import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import jsQR from 'jsqr';

const png = execFileSync('work/toolchains/android-sdk/platform-tools/adb.exe', ['-s', 'AYNNJV6123H13612', 'exec-out', 'screencap', '-p'], { maxBuffer: 20_000_000 });
const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const qr = jsQR(new Uint8ClampedArray(data), info.width, info.height);
const expected = 'https://la-sazon-marinera.consola.workers.dev/menu';
const result = { checkedAt: new Date().toISOString(), decoded: !!qr, canonicalHttpsOnly: qr?.data === expected };
if (result.canonicalHttpsOnly) result.payload = expected;
await writeFile('work/migration-preparation/honor-qr-generated.png', png);
await writeFile('work/migration-preparation/honor-qr-decoded.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (!result.canonicalHttpsOnly) process.exitCode = 1;
