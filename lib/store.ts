import type { Catalog, Settings, License, Feature } from './contracts';
export interface State {
  schemaVersion: 1;
  restaurantId: string;
  ownerId: string;
  draft: Catalog;
  settings: Settings;
  published: null | {
    version: number;
    at: string;
    catalog: Catalog;
    mode?: string;
    settings?: Settings;
  };
  license: License | null;
  password: { salt: string; hash: string; iterations?: number };
  recoveryHash: string;
  sessionEpoch: number;
  failures: { count: number; until: number };
  createdAt: string;
  access?: { active: boolean; features?: Feature[]; maxDishes?: number; sampleMenuEnabled?: boolean; plan?: 'basic'|'medium'|'premium' };
  security?: {
    firebaseUid?: string;
    emailCiphertext?: string;
    emailHash?: string;
    emailVerifiedAt?: string;
    totpCiphertext?: string;
    totpEnabledAt?: string;
    recoveryCodeHashes?: string[];
  };
}
export interface Stored {
  revision: number;
  state: State;
}
export interface Store {
  read(): Promise<Stored | null>;
  readSession?(): Promise<Stored | null>;
  readMenu?(): Promise<Stored | null>;
  commit(state: State, revision: number | null): Promise<boolean>;
  mediaGet(id: string): Promise<{ bytes: Uint8Array; type: string } | null>;
  mediaPut(id: string, bytes: Uint8Array, type: string): Promise<void>;
}
