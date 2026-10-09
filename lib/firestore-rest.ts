// Server-only transport. Remote access requires an explicitly supplied bearer
// provider; tests use demo projects on loopback and never real credentials.
export type FirestoreData = Record<string, unknown>;
type Value = { nullValue?: null; booleanValue?: boolean; integerValue?: string; doubleValue?: number; stringValue?: string; timestampValue?: string; arrayValue?: { values: Value[] }; mapValue?: { fields: Record<string, Value> } };
export type FirestoreDocument<T = FirestoreData> = { path: string; data: T; updateTime: string };
export type FirestoreWrite = { path: string; data?: FirestoreData; delete?: boolean; updateTime?: string; exists?: boolean; mask?: string[] };
export class FirestoreError extends Error {
  constructor(readonly status: number, readonly code = 'UNKNOWN') { super(`Firestore operation failed (${status}, ${code}).`); }
  get conflict() { return [409, 412].includes(this.status) || ['FAILED_PRECONDITION', 'ALREADY_EXISTS', 'ABORTED'].includes(this.code); }
}
export function firestoreId(value: string) {
  if (!value || value === '.' || value === '..' || (/[/\\?#%]/.test(value) || Array.from(value).some(char => char.charCodeAt(0) <= 31)) || value.length > 256) throw Error('Identificador inválido.');
  return value;
}
export const firestoreHashId = (hash: string) => firestoreId(hash.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
function encode(value: unknown): Value {
  if (value === null) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isFinite(value)) return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (value && typeof value === 'object') return { mapValue: { fields: fields(value as FirestoreData) } };
  throw Error('Valor Firestore no soportado.');
}
function fields(data: FirestoreData): Record<string, Value> {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined).map(([k, v]) => [k, encode(v)]));
}
function decode(value: Value): unknown {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return new Date(value.timestampValue!).toISOString();
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(decode);
  return Object.fromEntries(Object.entries(value.mapValue?.fields || {}).map(([k, v]) => [k, decode(v)]));
}
type WireDocument = { name: string; fields?: Record<string, Value>; updateTime: string };
export type WireFields = Record<string, Value>;
export type TransferDocument = { path: string; fields: WireFields; updateTime?: string };
export const encodeFirestoreFields = fields;
export const decodeFirestoreFields = (value: WireFields): FirestoreData => decode({ mapValue: { fields: value } }) as FirestoreData;
export class FirestoreRest {
  readonly root: string;
  readonly isEmulator: boolean;
  private readonly origin: string;
  private readTransaction?: string;
  async consistentRead<T>(operation: (snapshot: FirestoreRest) => Promise<T>): Promise<T> {
    const database = this.root.replace(/\/documents$/, '');
    const result = await this.request<{ transaction: string }>(`${database}/documents:beginTransaction`, 'POST', { options: { readOnly: {} } });
    const snapshot = Object.create(this) as FirestoreRest;
    snapshot.readTransaction = result.transaction;
    try { return await operation(snapshot); }
    finally { await this.request(`${database}/documents:rollback`, 'POST', { transaction: result.transaction }); }
  }
  constructor(projectId: string, emulatorHost: string, private bearer?: () => Promise<string>) {
    // No credentials, remote host or real project may be used by Step 4 tests.
    this.isEmulator = !!emulatorHost;
    if (this.isEmulator && (!/^demo-[a-z0-9-]+$/.test(projectId) || !/^(localhost|127\.0\.0\.1):\d+$/.test(emulatorHost))) throw Error('Firestore Paso 4 requiere un proyecto demo y un emulador local.');
    if (!this.isEmulator && (!bearer || !/^[a-z][a-z0-9-]{4,62}$/.test(projectId))) throw Error('Firestore remoto requiere una credencial de servidor explícita.');
    this.root = `projects/${projectId}/databases/(default)/documents`;
    this.origin = this.isEmulator ? `http://${emulatorHost}/v1/` : 'https://firestore.googleapis.com/v1/';
  }
  private name(path: string) {
    path.split('/').forEach(firestoreId);
    return `${this.root}/${path}`;
  }
  private document<T>(wire: WireDocument): FirestoreDocument<T> {
    return { path: wire.name.slice(this.root.length + 1), data: decode({ mapValue: { fields: wire.fields || {} } }) as T, updateTime: wire.updateTime };
  }
  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch(this.origin + path, { method, headers: { Authorization: `Bearer ${this.isEmulator ? 'owner' : await this.bearer!()}`, 'Content-Type': 'application/json' }, ...(body !== undefined && method !== 'GET' && method !== 'HEAD' ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000) }).catch(error => {
      // Diagnose transport failures without exposing document IDs, tokens or bodies.
      throw new Error(`Firestore ${method} ${path.endsWith(':commit') ? 'commit' : path.endsWith(':runQuery') ? 'query' : 'read'} transport failed (${error instanceof Error ? error.name : 'unknown'}).`, { cause: error });
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { error?: { status?: string } };
      const code = result.error?.status;
      throw new FirestoreError(response.status, code && /^[A-Z_]+$/.test(code) ? code : 'UNKNOWN');
    }
    return await response.json() as T;
  }
  async get<T = FirestoreData>(path: string): Promise<FirestoreDocument<T> | null> {
    if (this.readTransaction) {
      // The emulator's GET + transaction route can deadlock. batchGet uses
      // the same snapshot selector without falling back to a non-atomic read.
      const rows = await this.request<Array<{ found?: WireDocument; missing?: string }>>(`${this.root}:batchGet`, 'POST', { documents: [this.name(path)], transaction: this.readTransaction });
      const found = rows.find(row => row.found)?.found;
      return found ? this.document<T>(found) : null;
    }
    try { return this.document<T>(await this.request<WireDocument>(this.name(path) + (this.readTransaction ? `?transaction=${encodeURIComponent(this.readTransaction)}` : ''))); }
    catch (error) { if (error instanceof FirestoreError && error.status === 404) return null; throw error; }
  }
  // Migration-only primitives preserve timestamps and integer types exactly.
  async getWire(path: string): Promise<TransferDocument | null> {
    try { const row = await this.request<WireDocument>(this.name(path)); return { path, fields: row.fields || {}, updateTime: row.updateTime }; }
    catch (error) { if (error instanceof FirestoreError && error.status === 404) return null; throw error; }
  }
  async inventoryWire(max = 100000, excludedSubtrees: string[] = []): Promise<TransferDocument[]> {
    const result: TransferDocument[] = [], parents = [''];
    for (let index = 0; index < parents.length; index++) {
      if (parents.length > max) throw Error('Inventory exceeds safety limit.');
      const parent = parents[index];
      if (excludedSubtrees.some(path => parent === path || parent.startsWith(path + '/'))) continue;
      let token: string | undefined;
      do {
        const page: { collectionIds?: string[]; nextPageToken?: string } = await this.request(`${parent ? this.name(parent) : this.root}:listCollectionIds`, 'POST', { pageSize: 100, ...(token ? { pageToken: token } : {}) });
        for (const collection of page.collectionIds || []) {
          const path = parent ? `${parent}/${collection}` : collection;
          let documentToken: string | undefined;
          do {
            const query = new URLSearchParams({ pageSize: '100', showMissing: 'true', ...(documentToken ? { pageToken: documentToken } : {}) });
            const rows: { documents?: WireDocument[]; nextPageToken?: string } = await this.request(`${this.name(path)}?${query}`);
            for (const row of rows.documents || []) {
              const relative = row.name.slice(this.root.length + 1);
              parents.push(relative); // Includes absent parents with live subcollections.
              if (row.updateTime) result.push({ path: relative, fields: row.fields || {}, updateTime: row.updateTime });
              if (result.length > max) throw Error('Inventory exceeds safety limit.');
            }
            documentToken = rows.nextPageToken;
          } while (documentToken);
        }
        token = page.nextPageToken;
      } while (token);
    }
    return result.sort((a,b) => a.path.localeCompare(b.path));
  }
  async commitWire(writes: Array<{ path: string; fields?: WireFields; delete?: boolean; exists?: boolean; updateTime?: string }>) {
    if (this.readTransaction || !writes.length || writes.length > 400) throw Error('Invalid migration batch.');
    const encoded = writes.map(w => {
      if (w.fields && new TextEncoder().encode(JSON.stringify(w.fields)).length > 900000) throw Error('Oversized migration document.');
      return { ...(w.delete ? { delete: this.name(w.path) } : { update: { name: this.name(w.path), fields: w.fields || {} } }),
        ...(w.updateTime ? { currentDocument: { updateTime: w.updateTime } } : w.exists !== undefined ? { currentDocument: { exists: w.exists } } : {}) };
    });
    if (new TextEncoder().encode(JSON.stringify(encoded)).length > 8000000) throw Error('Oversized migration batch.');
    await this.request(`${this.root}:commit`, 'POST', { writes: encoded });
  }
  async list<T = FirestoreData>(collection: string, pageSize = 100, pageToken?: string, orderBy?: string) {
    if (this.readTransaction) {
      if (orderBy) throw Error('La captura transaccional requiere orden por identificador.');
      const size = Math.max(1, Math.min(300, pageSize));
      const after = pageToken ? atob(pageToken) : undefined;
      if (after && (!after.startsWith(`${collection}/`) || after.split('/').length !== collection.split('/').length + 1)) throw Error('Cursor fuera de ámbito.');
      const rows = await this.query<T>(collection, [], size + 1, { orderBy: [{ field: '__name__', direction: 'ASCENDING' }], ...(after ? { startAfter: [{ reference: after }] } : {}) });
      const documents = rows.slice(0, size);
      return { documents, nextPageToken: rows.length > size ? btoa(documents[documents.length - 1].path) : undefined };
    }
    const query = new URLSearchParams({ pageSize: String(Math.max(1, Math.min(300, pageSize))) });
    if (pageToken) query.set('pageToken', pageToken);
    if (orderBy) query.set('orderBy', orderBy);
    if (this.readTransaction) query.set('transaction', this.readTransaction);
    const result = await this.request<{ documents?: WireDocument[]; nextPageToken?: string }>(`${this.name(collection)}?${query}`);
    return { documents: (result.documents || []).map(d => this.document<T>(d)), nextPageToken: result.nextPageToken };
  }
  async all<T = FirestoreData>(collection: string, max = 10_000) {
    const documents: FirestoreDocument<T>[] = [];
    let token: string | undefined;
    do {
      const page = await this.list<T>(collection, Math.min(300, max + 1 - documents.length), token);
      documents.push(...page.documents);
      if (documents.length > max) throw Error('La colección supera el límite de lectura. Usa paginación.');
      token = page.nextPageToken;
    } while (token);
    return documents;
  }
  async commit(writes: FirestoreWrite[]) {
    if (this.readTransaction) throw Error('La captura de respaldo es de solo lectura.');
    if (!writes.length) return;
    if (writes.length > 450) throw Error('Demasiadas escrituras atómicas.');
    const encoded = writes.map(write => {
      const data = write.data === undefined ? undefined : fields(write.data);
      if (data && new TextEncoder().encode(JSON.stringify(data)).length > 900_000) throw Error('Documento Firestore demasiado grande.');
      return {
        ...(write.delete ? { delete: this.name(write.path) } : { update: { name: this.name(write.path), fields: data } }),
        ...(write.updateTime ? { currentDocument: { updateTime: write.updateTime } } : write.exists !== undefined ? { currentDocument: { exists: write.exists } } : {}),
        ...(write.mask ? { updateMask: { fieldPaths: write.mask } } : {}),
      };
    });
    if (new TextEncoder().encode(JSON.stringify(encoded)).length > 8_000_000) throw Error('Operación Firestore demasiado grande.');
    await this.request(`${this.root}:commit`, 'POST', { writes: encoded });
  }
  async query<T = FirestoreData>(collection: string, filters: Array<{ field: string; value: unknown; op?: string }> = [], limit = 200, options?: { allDescendants?: boolean; orderBy?: Array<{ field: string; direction: 'ASCENDING' | 'DESCENDING' }>; startAfter?: Array<{ value?: unknown; reference?: string }> }) {
    const parts = collection.split('/');
    const collectionId = parts.pop()!;
    const parent = parts.length ? this.name(parts.join('/')) : this.root;
    const clauses = filters.map(filter => filter.value === null && (!filter.op || filter.op === 'EQUAL') ? { unaryFilter: { field: { fieldPath: filter.field }, op: 'IS_NULL' } } : { fieldFilter: { field: { fieldPath: filter.field }, op: filter.op || 'EQUAL', value: encode(filter.value) } });
    const rows = await this.request<Array<{ document?: WireDocument }>>(`${parent}:runQuery`, 'POST', { structuredQuery: {
      from: [{ collectionId, ...(options?.allDescendants ? { allDescendants: true } : {}) }], limit: Math.min(1000, Math.max(1, limit)),
      ...(options?.orderBy ? { orderBy: options.orderBy.map(order => ({ field: { fieldPath: order.field }, direction: order.direction })) } : {}),
      ...(options?.startAfter ? { startAt: { before: false, values: options.startAfter.map(value => value.reference ? { referenceValue: this.name(value.reference) } : encode(value.value)) } } : {}),
      ...(clauses.length ? { where: clauses.length === 1 ? clauses[0] : { compositeFilter: { op: 'AND', filters: clauses } } } : {}),
    }, ...(this.readTransaction ? { transaction: this.readTransaction } : {}) });
    return rows.filter(row => row.document).map(row => this.document<T>(row.document!));
  }
}
