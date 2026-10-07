import type {State} from './store';
export type CommercialPlan='basic'|'medium'|'premium';
export type Entitlement='push'|'notificationPreferences'|'reports'|'wifi'|'scheduledBackups';
const rank={basic:0,medium:1,premium:2};
export function commercialPlan(access:State['access']):CommercialPlan{
 // Missing means a pre-plan restaurant: preserve its already granted service.
 // An unknown value is never treated as an elevated grant.
 const value=access?.plan;
 return value===undefined?'premium':value==='medium'||value==='premium'?value:'basic';
}
export function entitlements(access:State['access']){
 const level=rank[commercialPlan(access)];
 return {push:level>=1,notificationPreferences:level>=1,reports:level>=1,wifi:level>=2,scheduledBackups:level>=2};
}
