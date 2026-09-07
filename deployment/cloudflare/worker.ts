import {handleApi} from '../../lib/api';
import {cloudStore} from '../../lib/cloud-store';
type Env={ASSETS:Fetcher;LICENSE_PUBLIC_KEY:string;SETUP_TOKEN:string};
export default {async fetch(request:Request,env:Env){const url=new URL(request.url);if(url.pathname.startsWith('/api/v1/'))return handleApi(request,cloudStore(),{publicKey:env.LICENSE_PUBLIC_KEY,setupToken:env.SETUP_TOKEN,platformUser:undefined,runtime:'cloud'});if(['/','/menu','/demo','/preview'].includes(url.pathname)){url.pathname='/index.html';return env.ASSETS.fetch(new Request(url,request));}return env.ASSETS.fetch(request)}};
