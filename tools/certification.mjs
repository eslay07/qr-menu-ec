import fs from 'node:fs';
import path from 'node:path';
const [command,file,...args]=process.argv.slice(2);
function stop(message){console.error(message);process.exit(1)}
if(!file)stop('Uso: node tools/certification.mjs crear|revisar archivo.json');
if(command==='crear'){
 const cases=[];
 for(const client of ['Android','iPhone'])for(const experience of ['automatic_preferred','guided'])for(const network of ['olvidada','recordada'])for(const mobileData of [false,true])cases.push({id:`acceso-${cases.length+1}`,client,experience,network,mobileData,internet:false,result:'pendiente',taps:null,seconds:null,evidence:'',notes:''});
 for(const id of ['fotos-busqueda-seleccion-total','portal-cerrado-reapertura','reinicio-router','servidor-apagado-recuperacion','cambio-ip-recuperacion','publicacion-interrumpida','restauracion','licencia-alterada','aislamiento-administracion','treinta-clientes-wifi','jornada-android'])cases.push({id,result:'pendiente',evidence:'',notes:''});
 const report={schemaVersion:1,createdAt:new Date().toISOString(),technician:'',restaurant:'',server:{type:'',model:'',osVersion:'',appVersion:'',sha256:''},router:{model:'',firmware:'',openNDS:''},clients:{Android:{model:'',osVersion:''},iPhone:{model:'',osVersion:''}},observedWifiClients:0,androidHours:0,cases};
 fs.mkdirSync(path.dirname(path.resolve(file)),{recursive:true});fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log('Ficha creada con todos los resultados pendientes. Completar con observaciones físicas.');
}else if(command==='revisar'){
 let report;try{report=JSON.parse(fs.readFileSync(file,'utf8'))}catch{stop('Archivo inválido.')}
 const missing=[];const required=['technician','restaurant','server.type','server.model','server.osVersion','server.appVersion','server.sha256','router.model','router.firmware','router.openNDS','clients.Android.model','clients.Android.osVersion','clients.iPhone.model','clients.iPhone.osVersion'];
 for(const key of required){const v=key.split('.').reduce((o,k)=>o?.[k],report);if(typeof v!=='string'||!v.trim())missing.push(key)}
 if(report.schemaVersion!==1)missing.push('schemaVersion');
 if(!['windows7','windows10','android','router'].includes(report.server?.type))missing.push('tipo de servidor');
 if(!/^[a-f0-9]{64}$/i.test(report.server?.sha256||''))missing.push('SHA256 del binario');
 const expected=[...Array.from({length:16},(_,i)=>`acceso-${i+1}`),'fotos-busqueda-seleccion-total','portal-cerrado-reapertura','reinicio-router','servidor-apagado-recuperacion','cambio-ip-recuperacion','publicacion-interrumpida','restauracion','licencia-alterada','aislamiento-administracion','treinta-clientes-wifi','jornada-android'];
 const cases=Array.isArray(report.cases)?report.cases:[];
 const matrix=[];for(const client of ['Android','iPhone'])for(const experience of ['automatic_preferred','guided'])for(const network of ['olvidada','recordada'])for(const mobileData of [false,true])matrix.push({client,experience,network,mobileData});
 for(let i=0;i<matrix.length;i++){const c=cases.find(c=>c.id==='acceso-'+(i+1));for(const [key,value] of Object.entries(matrix[i]))if(c?.[key]!==value)missing.push('acceso-'+(i+1)+': '+key);}
 for(const id of expected){const matches=cases.filter(c=>c.id===id);if(matches.length!==1){missing.push(id+': falta o duplicado');continue}const c=matches[0];if(id==='jornada-android'&&report.server?.type!=='android')continue;if(c.result!=='aprobado'||typeof c.evidence!=='string'||!c.evidence.trim())missing.push(id+': resultado o evidencia');if(id.startsWith('acceso-')&&(!Number.isInteger(c.taps)||c.taps<0||typeof c.seconds!=='number'||c.seconds<=0||c.internet!==false))missing.push(id+': mediciones de acceso');}
 if(!Number.isInteger(report.observedWifiClients)||report.observedWifiClients<30)missing.push('30 clientes Wi-Fi físicos simultáneos');
 if(report.server?.type==='android'&&!(typeof report.androidHours==='number'&&report.androidHours>=8))missing.push('8 horas Android');
 console.log(JSON.stringify({complete:missing.length===0,missing,notice:'Revisión de integridad del registro; no verifica por sí misma que las pruebas físicas hayan ocurrido ni modifica la certificación del panel.'},null,2));if(missing.length)process.exitCode=2;
}else stop('Comando desconocido. Usa crear o revisar.');
