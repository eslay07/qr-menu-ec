import{createHash}from'node:crypto';
export function checkedAndroidRelease(value,apk){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid Android release');
 const {versionCode,versionName,url,sha256,size,certificateSha256}=value;
 if(!Number.isSafeInteger(versionCode)||versionCode<1||typeof versionName!=='string'||!/^\d+\.\d+\.\d+$/.test(versionName))throw Error('Invalid Android version');
 if(url!=='https://qr-menu-ec.consola.workers.dev/downloads/qr-menu-ec.apk')throw Error('Invalid Android download URL');
 if(!Number.isSafeInteger(size)||size<1||size>30*1024*1024||typeof sha256!=='string'||! /^[a-f0-9]{64}$/.test(sha256)||typeof certificateSha256!=='string'||!/^[a-f0-9]{64}$/.test(certificateSha256))throw Error('Invalid Android integrity metadata');
 if(apk.length!==size||createHash('sha256').update(apk).digest('hex')!==sha256)throw Error('Android binary does not match metadata');
 return {versionCode,versionName,url,sha256,size,certificateSha256};
}
