import { D1DocumentStore } from '../../lib/d1-documents';
import { FirestoreRestaurantStore } from '../../lib/firestore-store';
import { blankCatalog,defaultSettings } from '../../lib/contracts';
import type { State } from '../../lib/store';

// Disposable authenticated synthetic test worker. Never route to production.
const worker = {async fetch(request:Request,env:{DOCUMENT_DB:D1Database;REHEARSAL_TOKEN:string}){
 if(request.headers.get('Authorization')!==`Bearer ${env.REHEARSAL_TOKEN}`)return new Response(null,{status:404});
 const db=new D1DocumentStore(env.DOCUMENT_DB),id='00000000-0000-4000-8000-000000000001';
 const store=new FirestoreRestaurantStore(db,id,{async mediaGet(){return null;},async mediaPut(){}});
 const path=new URL(request.url).pathname;
 try{
  if(path==='/prepare'){
   if(await db.get(`restaurants/${id}`))throw Error('Test restaurant already exists.');
   const state:State={schemaVersion:1,restaurantId:id,ownerId:'test',draft:structuredClone(blankCatalog),settings:structuredClone(defaultSettings),published:null,license:null,password:{salt:'',hash:''},recoveryHash:'test',sessionEpoch:1,failures:{count:0,until:0},createdAt:new Date().toISOString(),access:{active:true,features:['orders'],maxDishes:150}};
   for(let i=0;i<150;i++)state.draft.dishes.push({id:`dish-${i}`,name:`Plato ${i}`,description:'',categoryId:'principales',priceCents:500,available:true,image:'',modifierGroups:[]});
   if(!await store.commit(state,null))throw Error('Create failed.');
   return Response.json({passed:true,created:150});
  }
  if(path==='/publish'){
   const value=await store.read();if(!value)throw Error('Missing fixture.');
   value.state.published={version:1,at:new Date().toISOString(),catalog:structuredClone(value.state.draft)};
   if(!await store.commit(value.state,value.revision))throw Error('Publish failed.');
   return Response.json({passed:true,published:150});
  }
  if(path==='/read')return Response.json({passed:(await store.readMenu())?.state.published?.catalog.dishes.length===150});
  return new Response(null,{status:404});
 }catch(error){return Response.json({passed:false,error:error instanceof Error?error.message:'Unknown'},{status:500});}
}};

export default worker;
