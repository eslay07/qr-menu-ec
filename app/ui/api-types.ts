import type { Catalog, Feature, Settings } from '@/lib/contracts';
import type { OrderRecord, OrderReport } from '@/lib/orders';
import type { OwnerNotification } from '@/lib/firestore-business';
export type SessionState = {authenticated:boolean;configured:boolean;authProvider?:string;firebaseUid?:string|null;runtime?:string;platformSetup?:boolean;turnstileSiteKey:string|null;recoveryEmailReady?:boolean};
export type Enrollment = {uri:string;secret:string};
export type AuthResult = {mfaRequired?:boolean;enrollment?:Enrollment;recovery?:string;recoveryCodes?:string[]};
export type PanelState = {entitlements?:{push:boolean;notificationPreferences:boolean;reports:boolean;wifi:boolean;scheduledBackups:boolean};businessReady?:boolean;restaurantId:string;revision:number;draft:Catalog;settings:Settings;published:null|{version:number;at:string;catalog:Catalog};maxDishes:number;sampleMenuEnabled:boolean;role:'creator'|'owner';features:Feature[]};
export type DomainState = {primary?:null|{hostname:string;status:string};primaryUrl?:string|null;aliases?:Array<{hostname:string;kind:string;status:string}>;free:null|{hostname:string;status:string};custom:null|{hostname:string;status:string;validation?:{ssl?:{status:string}}};cnameTarget:string|null;capacity?:{used:number;warningAt:number;limit:number}};
export type ReportData = {report:OrderReport;orders:OrderRecord[];totalOrders:number;nextPageQuery?:string;exportQuery?:string;nextCursor?:string|null};
export type ShareCodes = {name:string;version:number;codes:Array<{payload:string;svg:string}>};
export type EmailState = {verified:boolean;configured:boolean;verificationEnabled:boolean};
export type SessionEntry = {id:string;lastSeenAt:string;expiresAt:string};
export type PreferenceState = {revision:string;settings:{newOrder:boolean;customerCancelled:boolean;soldOut:boolean;dailySummary:boolean;inactivity:boolean;inactivityHours:number};enabled:boolean;name:string};
export type ApiResult<P extends string> =
 P extends 'session' ? SessionState : P extends 'state' ? PanelState :
 P extends 'editor-version' ? Pick<PanelState,'revision'|'features'|'entitlements'> :
 P extends 'firebase/client-token' ? {customToken:string} :
 P extends 'domain'|'domain/verify' ? DomainState :
 P extends 'qr' ? ShareCodes : P extends 'qr/print-wifi' ? {wifi:{name:string;text:string}|null} :
 P extends 'email' ? EmailState : P extends 'sessions' ? {sessions:SessionEntry[]} : P extends 'devices' ? {devices:SessionEntry[]} :
 P extends 'login'|'setup'|'recover'|'auth/mfa/verify' ? AuthResult :
 P extends 'menu'|'preview' ? {catalog:Catalog;ordersEnabled:boolean;version:number;turnstileSiteKey:string|null} :
 P extends 'orders'|'demo-order' ? {order:OrderRecord;publicUrl:string;pdfUrl:string;qrPayload:string} :
 P extends 'whatsapp-request' ? {url:string;registered:false;model:'request';totalCents:number} :
 P extends 'push/device' ? {restaurantId:string;ok:boolean} :
 P extends `reports/orders${string}` ? ReportData :
 P extends `settings/${string}` ? PreferenceState :
 P extends `notifications/${string}/read` ? {ok:boolean} :
 P extends `notifications/${string}` ? {notification:OwnerNotification} :
 P extends `notifications${string}` ? {notifications:OwnerNotification[];nextCursor:string|null} :
 P extends `order/${string}` ? {order:OrderRecord} : {ok:boolean;revision:number;error?:string;notice?:string};
