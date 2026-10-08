'use client';
import { useRef, type ReactNode } from 'react';
/** Native disclosure keeps draft fields mounted and supports keyboard toggling. */
export default function EditorSection({title,description,children,id,defaultOpen=false}:{title:string;description:string;children:ReactNode;id?:string;defaultOpen?:boolean}){
 const section=useRef<HTMLDetailsElement>(null);
 return <details id={id} ref={section} className="card editor-disclosure" open={defaultOpen || undefined}>
  <summary><span><strong>{title}</strong><small>{description}</small></span><span className="disclosure-indicator" aria-hidden="true">⌄</span></summary>
  <div className="editor-disclosure-body">{children}</div>
 </details>;
}
export function focusEditorField(id:string){
 const field=document.getElementById(id);
 if(!field)return;
 for(let ancestor=field.parentElement;ancestor;ancestor=ancestor.parentElement)if(ancestor instanceof HTMLDetailsElement)ancestor.open=true;
 requestAnimationFrame(()=>{field.focus();field.scrollIntoView({block:'center',behavior:'auto'});});
}
