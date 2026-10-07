import { createRequire } from 'node:module';
import { loadEnv } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
if (!process.argv.includes('--send-single-recovery-email')) throw Error('Explicit single-email test required.');
const project='qr-menu-6981a', uid='owner:998d4980-a169-469f-b009-634a373ca7ad';
const require=createRequire(import.meta.url), auth=require('firebase-tools/lib/auth');
await require('firebase-tools/lib/requireAuth').requireAuth({project,nonInteractive:true,...auth.getProjectDefaultAccount(process.cwd())});
const token=await require('firebase-tools/lib/apiv2').getAccessToken();
const lookup=await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({localId:[uid]}),signal:AbortSignal.timeout(15000)});
if(!lookup.ok)throw Error('Could not verify the existing owner account.');
const user=(await lookup.json()).users?.find(user=>user.localId===uid);
if(!user||user.disabled||user.email!=='eslay777j@gmail.com')throw Error('Owner identity or registered email mismatch; no email sent.');
const env=loadEnv('production',process.cwd(),'VITE_');
if(env.VITE_FIREBASE_PROJECT_ID!==project||!env.VITE_FIREBASE_API_KEY)throw Error('Project mismatch.');
const response=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(env.VITE_FIREBASE_API_KEY)}`,{method:'POST',headers:{'Content-Type':'application/json','X-Firebase-Locale':'es'},body:JSON.stringify({requestType:'PASSWORD_RESET',email:user.email}),signal:AbortSignal.timeout(15000)});
// Requesting the email does not reset a password or disable TOTP. Do not consume the link.
const receipt={checkedAt:new Date().toISOString(),project,existingOwnerVerified:true,providerHttpStatus:response.status,providerAcceptedEmail:response.ok,passwordChanged:false,totpChanged:false,deliveryConfirmed:false};
await mkdir('work/recovery-live-qa',{recursive:true});await writeFile('work/recovery-live-qa/owner-delivery.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
if(!response.ok)process.exitCode=1;
