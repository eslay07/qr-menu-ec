import { FirestoreRest, FirestoreError, firestoreId, encodeFirestoreFields, decodeFirestoreFields, type FirestoreData, type FirestoreDocument, type FirestoreWrite, type TransferDocument } from './firestore-rest';

type Row = { path: string; payload: string; fields: string; version: string };
type QueryOptions = Parameters<FirestoreRest['query']>[3];
const validatePath = (path: string, document: boolean) => {
  const parts = path.split('/'); parts.forEach(firestoreId);
  if ((parts.length % 2 === 0) !== document) throw Error('Ruta de datos inválida.');
  return parts;
};
const comparable = (value: unknown): string | number | null => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  throw Error('Filtro de datos no soportado.');
};

// Compatibility adapter: repositories share the document contract; no Google
// request is used. Provider switches require migration, never automatic fallback.
export class D1DocumentStore extends FirestoreRest {
  override readonly root = 'd1://operational-documents';
  override readonly isEmulator = false;
  constructor(private sql: D1Database, private readOnly = false) {
    super('qr-menu-d1', '', async () => { throw Error('D1 no utiliza credenciales Firestore.'); });
  }
  private rowDocument<T>(row: Row): FirestoreDocument<T> { return { path: row.path, data: JSON.parse(row.payload) as T, updateTime: row.version }; }
  override async get<T = FirestoreData>(path: string) {
    validatePath(path, true);
    const row = await this.sql.prepare('SELECT path,payload,fields,version FROM operational_documents WHERE path=?').bind(path).first<Row>();
    return row ? this.rowDocument<T>(row) : null;
  }
  override async getWire(path: string): Promise<TransferDocument | null> {
    validatePath(path, true);
    const row = await this.sql.prepare('SELECT path,fields,version FROM operational_documents WHERE path=?').bind(path).first<Row>();
    return row ? { path, fields: JSON.parse(row.fields), updateTime: row.version } : null;
  }
  override async inventoryWire(max = 100000, excludedSubtrees: string[] = []) {
    if (!Number.isSafeInteger(max) || max < 1 || max > 100000) throw Error('Límite de inventario inválido.');
    excludedSubtrees.forEach(path => validatePath(path, true));
    const conditions = excludedSubtrees.flatMap(() => ['NOT (path=? OR substr(path,1,length(?)+1)=? || \'/\')']);
    const values = excludedSubtrees.flatMap(path => [path,path,path]);
    const rows = (await this.sql.prepare(`SELECT path,fields,version FROM operational_documents ${conditions.length ? 'WHERE '+conditions.join(' AND ') : ''} ORDER BY path LIMIT ?`).bind(...values,max+1).all<Row>()).results;
    if (rows.length > max) throw Error('Inventory exceeds safety limit.');
    return rows.map(row => ({ path: row.path, fields: JSON.parse(row.fields), updateTime: row.version }));
  }
  private expression(field: string) {
    if (field === '__name__') return 'path';
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(field)) throw Error('Campo de consulta inválido.');
    return `json_extract(payload,'$.${field}')`;
  }
  override async query<T = FirestoreData>(collection: string, filters: Array<{ field: string; value: unknown; op?: string }> = [], limit = 200, options?: QueryOptions) {
    const parts = validatePath(collection, false);
    const values: Array<string | number | null> = [], clauses: string[] = [];
    if (options?.allDescendants) {
      clauses.push('collection_id=?'); values.push(parts.at(-1)!);
      if (parts.length > 1) { const parent = parts.slice(0,-1).join('/'); clauses.push("substr(path,1,length(?)+1)=? || '/'"); values.push(parent,parent); }
    } else { clauses.push('collection=?'); values.push(collection); }
    const ops: Record<string,string> = { EQUAL:'=', LESS_THAN:'<', LESS_THAN_OR_EQUAL:'<=', GREATER_THAN:'>', GREATER_THAN_OR_EQUAL:'>=', NOT_EQUAL:'<>' };
    for (const filter of filters) {
      const expr = this.expression(filter.field), op = filter.op || 'EQUAL';
      if (!ops[op]) throw Error('Operador de consulta no soportado.');
      if (filter.value === null) {
        if (op !== 'EQUAL') throw Error('Filtro nulo no soportado.');
        clauses.push(`json_type(payload,'$.${filter.field}')='null'`);
      } else { clauses.push(`${expr} ${ops[op]} ?`); values.push(comparable(filter.value)); }
    }
    const order = options?.orderBy?.length ? options.orderBy : [{ field:'__name__', direction:'ASCENDING' as const }];
    for (const item of order) { this.expression(item.field); if (!['ASCENDING','DESCENDING'].includes(item.direction)) throw Error('Orden inválido.'); }
    for (const item of order) if (item.field !== '__name__') clauses.push(`json_type(payload,'$.${item.field}') IS NOT NULL`);
    if (options?.startAfter) {
      if (options.startAfter.length !== order.length) throw Error('Cursor inválido.');
      const alternatives = order.map((item,index) => {
        const terms = [];
        for (let previous=0;previous<index;previous++) { terms.push(`${this.expression(order[previous].field)}=?`); values.push(comparable(options.startAfter![previous].reference ?? options.startAfter![previous].value)); }
        terms.push(`${this.expression(item.field)} ${item.direction === 'ASCENDING' ? '>' : '<'} ?`);
        values.push(comparable(options.startAfter![index].reference ?? options.startAfter![index].value));
        return '('+terms.join(' AND ')+')';
      });
      clauses.push('('+alternatives.join(' OR ')+')');
    }
    values.push(Math.min(1000,Math.max(1,limit)));
    const rows = (await this.sql.prepare(`SELECT path,payload,fields,version FROM operational_documents WHERE ${clauses.join(' AND ')} ORDER BY ${order.map(item => `${this.expression(item.field)} ${item.direction === 'ASCENDING' ? 'ASC' : 'DESC'}`).join(',')} LIMIT ?`).bind(...values).all<Row>()).results;
    return rows.map(row => this.rowDocument<T>(row));
  }
  override async list<T = FirestoreData>(collection: string, pageSize = 100, pageToken?: string, orderBy?: string) {
    validatePath(collection,false);
    if (orderBy) throw Error('Usa query para ordenar explícitamente.');
    const size = Math.max(1,Math.min(300,pageSize)), after = pageToken ? atob(pageToken) : undefined;
    if (after && (after.split('/').slice(0,-1).join('/') !== collection)) throw Error('Cursor fuera de ámbito.');
    const rows = await this.query<T>(collection,[],size+1,{ orderBy:[{ field:'__name__',direction:'ASCENDING' }], ...(after ? { startAfter:[{ reference:after }] } : {}) });
    const documents = rows.slice(0,size);
    return { documents, nextPageToken:rows.length>size ? btoa(documents.at(-1)!.path) : undefined };
  }
  override async commit(writes: FirestoreWrite[]) {
    return this.commitBatch(writes);
  }
  private async commitBatch(writes: FirestoreWrite[], wire?: Map<string, TransferDocument['fields']>) {
    if (this.readOnly) throw Error('La captura de respaldo es de solo lectura.');
    if (!writes.length) return;
    if (writes.length>450) throw Error('Lote de datos inválido.');
    // Restore can update normal settings and WiFi on the same document. Merge
    // masked writes before SQL, preserving both sets of fields atomically.
    const merged = new Map<string,FirestoreWrite>();
    for (const next of writes) {
      const previous = merged.get(next.path);
      if (!previous) { merged.set(next.path,{...next}); continue; }
      if (previous.delete || next.delete || !previous.mask || !next.mask || (previous.updateTime && next.updateTime && previous.updateTime !== next.updateTime) || (previous.exists !== undefined && next.exists !== undefined && previous.exists !== next.exists)) throw Error('Escrituras incompatibles sobre el mismo documento.');
      const select = (write: FirestoreWrite) => Object.fromEntries(write.mask!.filter(field=>write.data && field in write.data).map(field=>[field,write.data![field]]));
      const selected=select(previous);for(const field of next.mask)delete selected[field];
      merged.set(next.path,{...previous,updateTime:next.updateTime || previous.updateTime,exists:next.exists ?? previous.exists,data:{...selected,...select(next)},mask:[...new Set([...previous.mask,...next.mask])]});
    }
    writes=[...merged.values()];
    const statements: D1PreparedStatement[] = [], version = new Date().toISOString()+'-'+crypto.randomUUID();
    let bytes = 0;
    for (const write of writes) {
      const parts = validatePath(write.path,true), collection = parts.slice(0,-1).join('/');
      if (write.updateTime) statements.push(this.sql.prepare('INSERT INTO operational_guard(ok) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM operational_documents WHERE path=? AND version=?)').bind(write.path,write.updateTime));
      else if (write.exists !== undefined) statements.push(this.sql.prepare(`INSERT INTO operational_guard(ok) SELECT 0 WHERE ${write.exists ? 'NOT ' : ''}EXISTS (SELECT 1 FROM operational_documents WHERE path=?)`).bind(write.path));
      if (write.delete) { statements.push(this.sql.prepare('DELETE FROM operational_documents WHERE path=?').bind(write.path)); continue; }
      let data = write.data || {};
      if (write.mask) {
        // Merge against an exact revision so even unconditional field updates
        // cannot overwrite a concurrently changed sibling field.
        const existing = await this.get(write.path);
        statements.push(this.sql.prepare(`INSERT INTO operational_guard(ok) SELECT 0 WHERE ${existing ? 'NOT EXISTS (SELECT 1 FROM operational_documents WHERE path=? AND version=?)' : 'EXISTS (SELECT 1 FROM operational_documents WHERE path=?)'}`).bind(...(existing ? [write.path,existing.updateTime] : [write.path])));
        data = { ...existing?.data };
        for (const field of write.mask) {
          if (field.includes('.')) throw Error('Máscara anidada no soportada.');
          firestoreId(field);
          if (write.data && field in write.data) data[field] = write.data[field]; else delete data[field];
        }
      }
      const fields = JSON.stringify(wire?.get(write.path) || encodeFirestoreFields(data)), payload = JSON.stringify(decodeFirestoreFields(JSON.parse(fields)));
      bytes += new TextEncoder().encode(fields+payload).length;
      if (new TextEncoder().encode(fields+payload).length>1_800_000 || bytes>8_000_000) throw Error('Lote de datos demasiado grande.');
      statements.push(this.sql.prepare('INSERT INTO operational_documents(path,collection,collection_id,payload,fields,version) VALUES (?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET payload=excluded.payload,fields=excluded.fields,version=excluded.version').bind(write.path,collection,parts.at(-2)!,payload,fields,version));
    }
    statements.push(this.sql.prepare('UPDATE operational_meta SET revision=revision+1 WHERE id=1'));
    try { await this.sql.batch(statements); }
    catch (error) {
      if (error instanceof Error && /CHECK constraint failed.*ok/i.test(error.message)) throw new FirestoreError(409,'ABORTED');
      throw error;
    }
  }
  override async commitWire(writes: Array<{ path: string; fields?: TransferDocument['fields']; delete?: boolean; exists?: boolean; updateTime?: string }>) {
    await this.commitBatch(writes.map(write => ({ ...write, data:write.fields ? decodeFirestoreFields(write.fields) : undefined })), new Map(writes.filter(write=>write.fields).map(write=>[write.path,write.fields!])));
  }
  override async consistentRead<T>(operation: (snapshot: FirestoreRest) => Promise<T>): Promise<T> {
    // Optimistic snapshot: every write increments revision in the same atomic
    // batch. A changing database is retried, never labelled a verified backup.
    for (let attempt=0;attempt<3;attempt++) {
      const before = await this.sql.prepare('SELECT revision FROM operational_meta WHERE id=1').first<{revision:number}>();
      if (!before) throw Error('D1 operativo no inicializado.');
      const result = await operation(new D1DocumentStore(this.sql,true));
      const after = await this.sql.prepare('SELECT revision FROM operational_meta WHERE id=1').first<{revision:number}>();
      if (after?.revision === before.revision) return result;
    }
    throw new FirestoreError(409,'ABORTED');
  }
}
