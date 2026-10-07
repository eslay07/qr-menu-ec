import { spawnSync } from 'node:child_process';
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host || !/^(localhost|127\.0\.0\.1):\d+$/.test(host)) {
  console.error('Inicia un emulador aislado demo-qr-menu-ec y define FIRESTORE_EMULATOR_HOST=127.0.0.1:PUERTO. Nunca usar producción.');
  process.exit(1);
}
const run = spawnSync(process.execPath, ['--import', 'tsx', '--test', 'tests/backup-drill.test.ts'], { stdio: 'inherit', windowsHide: true });
process.exit(run.status ?? 1);
