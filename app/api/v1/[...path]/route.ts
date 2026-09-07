import { handleApi } from '@/lib/api';
import { cloudStore,bindings } from '@/lib/cloud-store';
export const dynamic='force-dynamic';
async function handle(req:Request){const e=bindings();return handleApi(req,cloudStore(),{publicKey:e.LICENSE_PUBLIC_KEY||'',setupToken:e.SETUP_TOKEN||'',platformUser:req.headers.get('oai-authenticated-user-id')||undefined,runtime:'cloud'});}
export const GET=handle;export const POST=handle;export const PUT=handle;
