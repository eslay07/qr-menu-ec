// Only for a key created moments ago, never a blanket retry for credentials.
// IAM propagation may briefly reject its signature. No document request is
// attempted before this bounded handshake has succeeded.
export async function freshCredentialReady(bearer,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),report=()=>{},delays=[1000,2000,4000,8000,16000]}={}) {
  for(let attempt=0;;attempt++) {
    try {await bearer();report({attempt:attempt+1,status:'ready'});return;}
    catch(error){
      const propagation=error?.status===400&&error?.code==='invalid_grant'&&error?.reason==='INVALID_JWT_SIGNATURE';
      report({attempt:attempt+1,status:'failed',httpStatus:error?.status??null,code:error?.code??null,reason:error?.reason??null,retry:propagation&&attempt<delays.length});
      if(!propagation||attempt>=delays.length)throw error;
      await sleep(delays[attempt]);
    }
  }
}
