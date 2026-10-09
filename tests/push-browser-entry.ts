// Served only by the local integration-test harness; not an application entry.
export { messaging } from '../src/lib/firebase-push-client';
export { register, unregister, onRegistered, onUnregistered, onMessage } from 'firebase/messaging';
