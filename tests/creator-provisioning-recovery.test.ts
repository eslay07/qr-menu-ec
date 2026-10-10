import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1Fixture } from './d1-fixture';
import { AuthSecurity } from '../lib/auth-security';
import { ApplicationRepository } from '../lib/application-repository';
import { FirebaseAuthProvider } from '../lib/firebase-auth-provider';
import { handleCreatorApi, type CentralEnv } from '../lib/central-api';
import type { State } from '../lib/store';

for (const initialUploadFailure of [false, true]) void test(initialUploadFailure ? 'failed initial Worker upload keeps one created access and a readable fallback; retry refuses to overwrite the reserved Worker' : 'external hostname failure returns created access and a readable fallback; retry reuses the restaurant and Firebase account', async t => {
  const {sql, db, sqlite} = createD1Fixture();
  const env: CentralEnv = {
    DB: sql, DATA_PROVIDER: 'd1-documents', DATA_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64'), CREATOR_SETUP_TOKEN: '',
    AUTH_PROVIDER: 'firebase', FIREBASE_PROJECT_ID: 'demo-auth', FIREBASE_API_KEY: 'test-only',
    FIREBASE_SERVICE_ACCOUNT: JSON.stringify({project_id:'demo-auth',client_email:'test@demo-auth.iam.gserviceaccount.com',private_key:'test-only'}),
    CLOUDFLARE_ACCOUNT_ID:'fictitious-account',CLOUDFLARE_API_TOKEN:'fictitious-token',CLOUDFLARE_WORKERS_SUBDOMAIN:'testing',
  };
  const repository = new ApplicationRepository(env);
  await repository.commit('__creator__', {password:{salt:'fixture',hash:'fixture'},sessionEpoch:0,failures:{count:0,until:0}}, null);
  // A real scoped grant/CSRF protects these requests; only Firebase's external
  // verifier and account transport are substituted, never authorization.
  const grant = await new AuthSecurity({...env,AUTH_PROVIDER:undefined}).createSession('creator',null);
  const cookie = grant.cookie.split(';')[0];
  const createdUsers: string[] = [];
  t.mock.method(FirebaseAuthProvider.prototype,'verifySession',async () => true);
  t.mock.method(FirebaseAuthProvider.prototype,'createUser',async (uid:string) => {createdUsers.push(uid);});
  t.mock.method(FirebaseAuthProvider.prototype,'signIn',async () => 'fictitious-id-token');
  let healthy = false, uploads = 0;
  t.mock.method(globalThis,'fetch',async (input:RequestInfo|URL,init?:RequestInit) => {
    const url = typeof input==='string'?input:input instanceof URL?input.href:input.url;
    if(url==='https://mesa-ficticia.testing.workers.dev/owner')return new Response('<html>Owner</html>',{headers:{'content-type':'text/html'}});
    if(url.endsWith('/settings') && initialUploadFailure)return Response.json({success:false},{status:404});
    if(url.endsWith('/settings'))return Response.json({success:true,result:{bindings:[{type:'service',name:'CORE',service:'qr-menu-ec',environment:'production'}]}});
    if(url.endsWith('/subdomain'))return Response.json({success:healthy},{status:healthy?200:503});
    if(init?.method==='PUT'){uploads++;return Response.json({success:!initialUploadFailure},{status:initialUploadFailure?503:200});}
    return Response.json({success:false},{status:404});
  });
  const request = (path:string,data:unknown) => new Request('https://menu.test/api/creator/'+path,{method:'POST',headers:{cookie,origin:'https://menu.test','content-type':'application/json','x-csrf-token':grant.csrfToken},body:JSON.stringify(data)});
  const payload = {name:'Mesa Ficticia',ownerEmail:'qa-onboarding@example.invalid',ownerPassword:'Ficticio-password-123',features:['orders']};
  try {
    const result = await handleCreatorApi(request('restaurants',payload),env);
    assert.equal(result.status,201);
    assert.equal(result.headers.get('cache-control'),'no-store');
    const access = await result.json() as {id:string;code:string;warning:string;ownerUrl:string;menuUrl:string;recovery:string};
    assert.equal(access.code,access.id);
    assert.equal(access.ownerUrl,'https://menu.test/r/'+access.id+'/');
    assert.equal(access.menuUrl,'https://menu.test/m/mesa-ficticia');
    assert.match(access.warning,/El acceso del dueño se creó.*No se pudo activar el subdominio/);
    assert.ok(access.recovery);
    assert.equal((await repository.list()).length,1);
    assert.equal(createdUsers.length,1);
    const before = await repository.read(access.id);
    const state = JSON.parse(before!.data) as State;
    assert.equal(state.settings.webUrl,access.menuUrl);
    assert.equal(state.published,null);
    assert.equal(state.access?.maxDishes,40);
    assert.deepEqual(state.access?.features,['orders']);
    assert.equal(state.security?.firebaseUid,createdUsers[0]);
    assert.equal((await db.get('hostnames/mesa-ficticia.testing.workers.dev'))?.data.status,'error');
    assert.equal((await db.get('menuAliases/mesa-ficticia'))?.data.restaurantId,access.id);
    assert.equal((await handleCreatorApi(request('restaurants',payload),env)).status,409);
    healthy = true;
    const retry = await handleCreatorApi(request('restaurants/'+access.id+'/hostname',{}),env);
    if (initialUploadFailure) {
      assert.equal(retry.status,400);
      assert.match((await retry.json() as {error:string}).error,/Worker reservado/);
      assert.equal((await db.get('hostnames/mesa-ficticia.testing.workers.dev'))?.data.status,'error');
    } else {
      assert.equal(retry.status,200);
      assert.equal((await retry.json() as {primaryUrl:string}).primaryUrl,'https://mesa-ficticia.testing.workers.dev/menu');
      assert.equal((await db.get('hostnames/mesa-ficticia.testing.workers.dev'))?.data.status,'active');
    }
    assert.equal(createdUsers.length,1);
    assert.equal(uploads,1);
    assert.equal((await repository.list()).length,1);
    const after = await repository.read(access.id);
    assert.equal(after?.revision,before?.revision);
    assert.equal(after?.data,before?.data);
  } finally { sqlite.close(); }
});

