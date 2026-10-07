// Served only by the local integration-test harness; not an application entry.
export { messaging } from '../src/lib/firebase-push-client';
export { getToken, deleteToken, onMessage } from 'firebase/messaging';
