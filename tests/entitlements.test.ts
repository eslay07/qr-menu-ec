import test from 'node:test';
import assert from 'node:assert/strict';
import {commercialPlan,entitlements} from '../lib/entitlements';
test('commercial plans enforce medium and premium permissions while preserving legacy grants',()=>{
 assert.equal(commercialPlan({active:true}),'premium');
 assert.deepEqual(entitlements({active:true,plan:'basic'}),{push:false,notificationPreferences:false,reports:false,wifi:false,scheduledBackups:false});
 assert.deepEqual(entitlements({active:true,plan:'medium'}),{push:true,notificationPreferences:true,reports:true,wifi:false,scheduledBackups:false});
 assert.ok(Object.values(entitlements({active:true,plan:'premium'})).every(Boolean));
 assert.equal(commercialPlan({active:true,plan:'invalid' as 'basic'}),'basic');
});
