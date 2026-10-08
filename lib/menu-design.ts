import { z } from 'zod';
export const HexColor = z.string().regex(/^#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{6})$/).transform(v => (v.length === 4 ? '#' + v.slice(1).split('').map(c => c+c).join('') : v).toUpperCase());
export const Theme = z.object({background:HexColor,surface:HexColor,text:HexColor,accent:HexColor,action:HexColor}).strict();
export type Theme = z.infer<typeof Theme>;
export const palettePresets: Record<string, Theme> = {
  neutral:{background:'#F7F7F5',surface:'#FFFFFF',text:'#202520',accent:'#315B42',action:'#244130'},
  dark:{background:'#151A18',surface:'#222A25',text:'#F5F6F3',accent:'#A3D9AE',action:'#A3D9AE'},
  warm:{background:'#FFF6E8',surface:'#FFFFFF',text:'#382A20',accent:'#984124',action:'#78351F'},
};
export function contrastRatio(a:string,b:string) {
 const luminance=(hex:string)=> {const rgb=HexColor.parse(hex).slice(1).match(/../g)!.map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4)); return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
 const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
export function actionText(color:string) {return contrastRatio(color,'#FFFFFF') >= contrastRatio(color,'#000000') ? '#FFFFFF' : '#000000';}
export function catalogTheme(catalog:{theme?:Theme;color:string}):Theme {return catalog.theme || {...palettePresets.neutral,accent:catalog.color,action:catalog.color};}
export const Contact = z.object({address:z.string().trim().max(300),phone:z.string().regex(/^(|\+[1-9]\d{7,14})$/),whatsapp:z.string().regex(/^(|\+[1-9]\d{7,14})$/),hours:z.array(z.object({day:z.number().int().min(0).max(6),closed:z.boolean(),open:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),close:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)}).strict()).max(7)}).strict().refine(v=>new Set(v.hours.map(h=>h.day)).size===v.hours.length,'Los días del horario no se pueden repetir.');
export function publishNameValid(catalog:{name:string;nameConfirmed?:boolean},alreadyPublished=false) {
 const name=catalog.name.normalize('NFKC').replace(/[\p{Cf}\p{Cc}]/gu,'').replace(/\p{Z}+/gu,' ').trim();
 return !!name && (name.toLocaleLowerCase('es') !== 'mi restaurante' || catalog.nameConfirmed === true || alreadyPublished);
}
export const publishNameMessage = 'Agrega el nombre del restaurante antes de publicar el menú.';
export function isRestaurantOpen(hours:z.infer<typeof Contact>['hours'],now=new Date()):boolean|null {
 if(!hours.length)return null;
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Guayaquil',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const get=(key:string)=>parts.find(p=>p.type===key)!.value;
 const day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(get('weekday')),minute=Number(get('hour'))*60+Number(get('minute'));
 const at=(value:string)=>Number(value.slice(0,2))*60+Number(value.slice(3));
 const today=hours.find(h=>h.day===day),prev=hours.find(h=>h.day===(day+6)%7);
 if(prev&&!prev.closed&&at(prev.close)<at(prev.open)&&minute<at(prev.close))return true;
 if(!today)return null;if(today.closed)return false;
 const start=at(today.open),end=at(today.close);return end>start?minute>=start&&minute<end:end<start&&minute>=start;
}
