// Never serialize provider response bodies, credentials, document data or the
// first stack line (it may repeat sensitive exception text).
export function safeMigrationError(error) {
  const known=/^(Credential identity mismatch|Unexpected temporary key|Dedicated role changed|Temporary key permissions unavailable|IAM operation unavailable|Credencial Firestore no disponible\.|Unauthorized migration destination\.|Destination is not empty; no writes performed\.|Manifest checksum mismatch\.)$/;
  return {type:error?.constructor?.name??'Unknown',httpStatus:Number.isInteger(error?.status)?error.status:null,
    code:typeof error?.code==='string'&&/^[A-Z_a-z0-9.-]{1,80}$/.test(error.code)?error.code:null,
    reason:typeof error?.reason==='string'&&/^[A-Z_]{1,80}$/.test(error.reason)?error.reason:null,
    message:known.test(error?.message??'')?error.message:'Exception message withheld to protect credentials/document contents',
    frames:typeof error?.stack==='string'?error.stack.split('\n').slice(1).filter(line=>/^\s+at /.test(line)).slice(0,12):[],
    ...(error?.cause?{cause:safeMigrationError(error.cause)}:{})};
}
export async function migrationStage(stage, operation) {
  console.log(JSON.stringify({time:new Date().toISOString(),stage,status:'started'}));
  try {const value=await operation();console.log(JSON.stringify({stage,status:'passed'}));return value;}
  catch(error){console.error(JSON.stringify({stage,status:'failed',error:safeMigrationError(error)}));throw error;}
}
