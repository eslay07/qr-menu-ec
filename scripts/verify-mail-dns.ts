import { Resolver } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

type RecordSpec = { purpose: 'spf' | 'dkim' | 'mx'; name: string; type: 'TXT' | 'CNAME' | 'MX'; value: string; priority?: number };
type Manifest = { domain: string; records: RecordSpec[] };
type Dns = Pick<Resolver, 'resolveTxt' | 'resolveCname' | 'resolveMx'>;
const hostname = (value: string) => value.toLowerCase().replace(/\.$/, '');
const normalizeTxt = (value: string) => value.trim().replace(/\s+/g, ' ');

export function parseManifest(input: unknown): Manifest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Manifiesto inválido.');
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some((key) => !['domain', 'records'].includes(key))) throw new Error('Campos desconocidos.');
  if (typeof data.domain !== 'string') throw new Error('Falta domain.');
  const domain = hostname(data.domain);
  if (domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new Error('Dominio público inválido.');
  if (!Array.isArray(data.records) || data.records.length < 2 || data.records.length > 10) throw new Error('Incluye los registros exactos SPF y DKIM mostrados por Resend.');
  const records: RecordSpec[] = data.records.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Registro inválido.');
    if (Object.keys(item).some((key) => !['purpose', 'name', 'type', 'value', 'priority'].includes(key))) throw new Error('Campos de registro desconocidos.');
    if (!['spf', 'dkim', 'mx'].includes(item.purpose) || !['TXT', 'CNAME', 'MX'].includes(item.type) || typeof item.name !== 'string' || typeof item.value !== 'string' || !item.value.trim() || item.value.length > 8192) throw new Error('Registro incompleto.');
    const name = hostname(item.name);
    if (name.length > 253 || !/^[a-z0-9_.-]+$/.test(name) || !(name === domain || name.endsWith(`.${domain}`))) throw new Error('El registro debe pertenecer al dominio declarado.');
    if (item.purpose === 'spf' && (item.type !== 'TXT' || !/^v=spf1\s/.test(item.value))) throw new Error('SPF requiere un TXT v=spf1.');
    if (item.purpose === 'dkim' && (!name.includes('._domainkey.') || !['TXT', 'CNAME'].includes(item.type))) throw new Error('DKIM requiere el selector _domainkey exacto.');
    if (item.purpose === 'mx' && (item.type !== 'MX' || !Number.isInteger(item.priority) || item.priority < 0 || item.priority > 65535)) throw new Error('MX requiere prioridad válida.');
    if (item.purpose !== 'mx' && item.type === 'MX') throw new Error('Tipo incompatible.');
    return { purpose: item.purpose, name, type: item.type, value: item.value, ...(item.priority === undefined ? {} : { priority: item.priority }) };
  });
  if (!records.some((record) => record.purpose === 'spf') || !records.some((record) => record.purpose === 'dkim')) throw new Error('SPF y DKIM son obligatorios.');
  return { domain, records };
}

export async function verifyMailDns(input: unknown, dns: Dns = new Resolver({ timeout: 5000, tries: 2 })) {
  const manifest = parseManifest(input);
  const results = await Promise.all(manifest.records.map(async (record) => {
    try {
      let matches = false;
      let reason = 'El valor publicado no coincide con Resend.';
      if (record.type === 'TXT') {
        const values = (await dns.resolveTxt(record.name)).map((chunks) => chunks.join(''));
        const candidates = record.purpose === 'spf' ? values.filter((value) => /^v=spf1(?:\s|$)/i.test(value)) : values;
        matches = candidates.some((value) => normalizeTxt(value) === normalizeTxt(record.value));
        if (record.purpose === 'spf' && candidates.length !== 1) {
          matches = false;
          reason = 'SPF ausente o duplicado: debe existir exactamente un registro v=spf1.';
        }
      } else if (record.type === 'CNAME') {
        matches = (await dns.resolveCname(record.name)).some((value) => hostname(value) === hostname(record.value));
      } else {
        matches = (await dns.resolveMx(record.name)).some((value) => hostname(value.exchange) === hostname(record.value) && value.priority === record.priority);
      }
      return { purpose: record.purpose, name: record.name, type: record.type, ok: matches, detail: matches ? 'Coincide con el valor esperado.' : reason };
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : 'DNS_ERROR';
      return { purpose: record.purpose, name: record.name, type: record.type, ok: false, detail: `Consulta DNS fallida (${code}).` };
    }
  }));
  return { domain: manifest.domain, checkedAt: new Date().toISOString(), ok: results.every((result) => result.ok), results, note: 'Solo verifica DNS público. No prueba entrega, alineación DMARC ni el estado Verified de Resend. No modifica registros ni envía correos.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Uso: node --import tsx scripts/verify-mail-dns.ts ruta/mail-dns.json');
    const text = await readFile(process.argv[2], 'utf8');
    if (text.length > 100_000) throw new Error('Manifiesto demasiado grande.');
    const result = await verifyMailDns(JSON.parse(text));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Error de verificación DNS.');
    process.exitCode = 1;
  }
}
