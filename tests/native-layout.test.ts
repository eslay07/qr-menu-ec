import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeOwnsSafeArea } from '../app/ui/native-layout';
void test('only native shells that reserve their own system bars remove the duplicate CSS inset', () => {
  for (const agent of ['Chrome/153', 'QRMenuEC-Android/0.8.4', 'QRMenuEC-Android/0.7.99', 'QRMenuEC-Android/0.8.x', 'QRMenuEC-Android/0.8.5evil', 'QRMenuEC/0.8.6']) assert.equal(nativeOwnsSafeArea(agent), false);
  for (const agent of ['Android QRMenuEC-Android/0.8.5', 'Android QRMenuEC-Android/0.8.6 QRMenuEC-NoLock/', 'QRMenuEC-Android/0.9.0', 'QRMenuEC-Android/1.0.0']) assert.equal(nativeOwnsSafeArea(agent), true);
});
