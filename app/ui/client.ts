export function restaurantBase(){if(typeof location==='undefined')return '';const match=location.pathname.match(/^\/r\/([a-f0-9-]{36})(?:\/|$)/);return match?`/r/${match[1]}`:'';}
let csrfToken='';
export async function api(path:string,method='GET',data?:unknown){const headers:Record<string,string>=data===undefined?{}:{'Content-Type':'application/json'};if(!['GET','HEAD'].includes(method)&&csrfToken)headers['X-CSRF-Token']=csrfToken;const r=await fetch(`${restaurantBase()}/api/v1/${path}`,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});const b:any=await r.json();if(b?.csrfToken)csrfToken=b.csrfToken;if(!r.ok){const error=Error(b.error||'No se pudo completar la operación.') as Error&{status?:number;details?:unknown};error.status=r.status;error.details=b;throw error;}return b;}
export function download(name:string,data:string,type='application/json'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
export async function uploadPhoto(file: File) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 15_000_000)
    throw Error('Elige una foto JPG, PNG o WebP de hasta 15 MB.');
  const image = await createImageBitmap(file);
  try {
    if (!image.width || !image.height || image.width * image.height > 40_000_000)
      throw Error('La imagen es demasiado grande. Elige una de menos de 40 megapíxeles.');
    const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw Error('No se pudo preparar la foto.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let blob: Blob | null = null;
    for (const quality of [.82, .7, .55, .4]) {
      blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= 1_000_000) break;
    }
    if (!blob || blob.size > 1_000_000) throw Error('No se pudo reducir la foto. Prueba una imagen más pequeña.');
    const headers: Record<string, string> = { 'Content-Type': 'image/jpeg' };
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    const response = await fetch(`${restaurantBase()}/api/v1/media`, { method: 'POST', headers, body: blob });
    const result: any = await response.json();
    if (!response.ok) throw Error(result.error || 'No se pudo subir la foto. Vuelve a intentar.');
    return result.url as string;
  } finally { image.close(); }
}
