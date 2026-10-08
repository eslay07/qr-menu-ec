'use client';
import type { Catalog } from '@/lib/contracts';
import EditorSection from './editor-section';
export default function ContactEditor({draft,setDraft}:{draft:Catalog;setDraft:(v:Catalog)=>void}){
 const contact=draft.contact??{address:'',phone:'',whatsapp:'',hours:[]};
 const update=(key:string,value:unknown)=>setDraft({...draft,contact:{...contact,[key]:value}});
 const validNumber=(value:string)=>/^\+[1-9]\d{7,14}$/.test(value);
 return <>
  <EditorSection id="editor-contact" title="Contacto público" description="Dirección, teléfono y WhatsApp propios del restaurante">
   <div className="form-grid">
    <label>Dirección<input maxLength={250} value={contact.address} onChange={event=>update('address',event.target.value)}/></label>
    <label>Teléfono internacional<input type="tel" placeholder="+593…" pattern="[+][1-9][0-9]{7,14}" aria-invalid={!!contact.phone&&!validNumber(contact.phone)} value={contact.phone} onChange={event=>update('phone',event.target.value)}/></label>
    <label>WhatsApp del restaurante<input type="tel" placeholder="+593…" pattern="[+][1-9][0-9]{7,14}" aria-invalid={!!contact.whatsapp&&!validNumber(contact.whatsapp)} value={contact.whatsapp} onChange={event=>update('whatsapp',event.target.value)}/></label>
   </div>
   {contact.phone&&!validNumber(contact.phone)&&<p role="alert">Teléfono inválido. Usa + y entre 8 y 15 dígitos.</p>}
   {!validNumber(contact.whatsapp)&&<p className="notice warning">Configura un WhatsApp internacional válido para preparar solicitudes.</p>}
  </EditorSection>
  <EditorSection id="editor-hours" title="Horarios" description="Días de atención y cierres · America/Guayaquil">
   <p>Horarios en America/Guayaquil. Si el cierre es anterior a la apertura, la jornada termina al día siguiente. Sin horarios no se indica abierto.</p>
   {['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'].map((name,day)=>{
    const hours=contact.hours.find(value=>value.day===day);
    const change=(values:object)=>update('hours',[...contact.hours.filter(value=>value.day!==day),{day,closed:true,open:'09:00',close:'18:00',...hours,...values}].sort((a,b)=>a.day-b.day));
    return <div key={day} className="category-editor-row"><strong>{name}</strong><label className="check-label"><input type="checkbox" checked={hours?.closed===false} onChange={event=>change({closed:!event.target.checked})}/>Abre este día</label>{hours?.closed===false&&<div className="actions"><label>Apertura<input type="time" value={hours.open} onChange={event=>change({open:event.target.value})}/></label><label>Cierre<input type="time" value={hours.close} onChange={event=>change({close:event.target.value})}/></label></div>}</div>;
   })}
  </EditorSection>
 </>;
}
