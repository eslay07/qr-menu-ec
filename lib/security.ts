import { License, LicensePayload } from './contracts';
export function b64(bytes:Uint8Array){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);}
export function unb64(s:string){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
export function randomToken(){return b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[^a-zA-Z0-9]/g,'');}
export async function digest(s:string){return b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));}
export const passwordIterations = 600_000;
const workerPbkdf2Limit = 100_000;

async function pbkdf2Layer(
  material: Uint8Array,
  salt: string,
  iterations: number,
) {
  const keyBytes = new Uint8Array(material.byteLength);
  keyBytes.set(material);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer,
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: new TextEncoder().encode(salt),
        iterations,
      },
      key,
      256,
    ),
  );
}

export async function passwordHash(
  password: string,
  salt: string,
  iterations = passwordIterations,
) {
  const normalized = new TextEncoder().encode(password.normalize('NFKC'));
  if (iterations <= workerPbkdf2Limit)
    return b64(await pbkdf2Layer(normalized, salt, iterations));

  // Workers limita cada llamada WebCrypto a 100 000 iteraciones. Encadenamos
  // capas con sales separadas para conservar 600 000 iteraciones efectivas sin
  // rebajar el factor de trabajo. Los hashes legacy de 100 000 se verifican por
  // la rama anterior y migran después del primer acceso correcto.
  let material = normalized;
  let remaining = iterations;
  let layer = 0;
  while (remaining > 0) {
    const current = Math.min(workerPbkdf2Limit, remaining);
    material = await pbkdf2Layer(material, `${salt}:layer:${layer}`, current);
    remaining -= current;
    layer++;
  }
  return b64(material);
}

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes: Uint8Array) {
  let bits = 0, value = 0, output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += base32Alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) output += base32Alphabet[(value << (5 - bits)) & 31];
  return output;
}
export function unbase32(value: string) {
  let bits = 0, buffer = 0;
  const output: number[] = [];
  for (const character of value.toUpperCase().replace(/=|\s|-/g, '')) {
    const index = base32Alphabet.indexOf(character);
    if (index < 0) throw Error('Secreto TOTP inválido.');
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}
export function totpSecret() { return base32(crypto.getRandomValues(new Uint8Array(20))); }
async function totpAt(secret: string, counter: number) {
  const key = await crypto.subtle.importKey('raw', unbase32(secret), {name:'HMAC',hash:'SHA-1'}, false, ['sign']);
  const data = new Uint8Array(8);
  const view = new DataView(data.buffer);
  view.setUint32(4, counter);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
  const offset = signature[signature.length - 1] & 15;
  const code = ((signature[offset] & 127) << 24) | (signature[offset + 1] << 16) | (signature[offset + 2] << 8) | signature[offset + 3];
  return String(code % 1_000_000).padStart(6, '0');
}
export async function verifyTotp(secret: string, code: string, now=Date.now()) {
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(now / 30_000);
  for (const drift of [-1, 0, 1]) if (constantEqual(code, await totpAt(secret, counter + drift))) return true;
  return false;
}

async function encryptionKey(raw: string) {
  const bytes = unb64(raw);
  if (bytes.length !== 32) throw Error('DATA_ENCRYPTION_KEY debe contener 32 bytes en base64.');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt','decrypt']);
}
export async function encryptSensitive(value: string, rawKey: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv}, await encryptionKey(rawKey), new TextEncoder().encode(value)));
  return `v1.${b64(iv)}.${b64(encrypted)}`;
}
export async function decryptSensitive(value: string, rawKey: string) {
  const [version, iv, encrypted] = value.split('.');
  if (version !== 'v1' || !iv || !encrypted) throw Error('Dato cifrado inválido.');
  const clear = await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv)}, await encryptionKey(rawKey), unb64(encrypted));
  return new TextDecoder().decode(clear);
}
export function constantEqual(a:string,b:string){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
export async function verifyLicense(input:unknown,publicKey:string,restaurantId:string):Promise<LicensePayload>{const lic=License.parse(input);if(!publicKey)throw Error('El instalador debe configurar la clave pública del vendedor.');const key=await crypto.subtle.importKey('raw',unb64(publicKey),{name:'Ed25519'},false,['verify']);if(!await crypto.subtle.verify('Ed25519',key,unb64(lic.signature),unb64(lic.payload)))throw Error('Firma de licencia inválida.');const p=LicensePayload.parse(JSON.parse(new TextDecoder().decode(unb64(lic.payload))));if(p.restaurantId!==restaurantId)throw Error('La licencia pertenece a otro restaurante.');return p;}
