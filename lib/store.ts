import type { Catalog, Settings, License } from './contracts';
export interface State{schemaVersion:1;restaurantId:string;ownerId:string;draft:Catalog;settings:Settings;published:null|{version:number;at:string;catalog:Catalog;mode:string;accessExperience:string;settings?:Settings};offlinePrintedVersion?:number|null;license:License|null;password:{salt:string;hash:string};recoveryHash:string;sessionEpoch:number;failures:{count:number;until:number};createdAt:string}
export interface Stored{revision:number;state:State}
export interface Store{read():Promise<Stored|null>;commit(state:State,revision:number|null):Promise<boolean>;mediaGet(id:string):Promise<{bytes:Uint8Array;type:string}|null>;mediaPut(id:string,bytes:Uint8Array,type:string):Promise<void>}
