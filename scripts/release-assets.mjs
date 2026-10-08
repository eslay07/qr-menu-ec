import { extname } from 'node:path';
import { createHash } from 'node:crypto';
const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.txt':'text/plain','.pdf':'application/pdf','.apk':'application/vnd.android.package-archive'};
export function assetMime(path){return types[extname(path).toLowerCase()] || 'application/octet-stream';}
export function assetDescriptor(path,bytes){
 const type=assetMime(path);
 // Include MIME in the identity so a previously uploaded wrong MIME cannot
 // be reused by the provider's content-addressed storage.
 return {hash:createHash('sha256').update(bytes).update('\0'+extname(path)+'\0'+type+'\0mime-v2').digest('hex').slice(0,32),size:bytes.length};
}
export function assetPart(path,bytes){return new Blob([bytes.toString('base64')],{type:assetMime(path)});}
