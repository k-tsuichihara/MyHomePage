import test from 'node:test';
import assert from 'node:assert/strict';
import {runDeletedIdCase,case27Source,deletedIdRejection} from './deleted-id-contract.mjs';
import './deleted-id-read.mjs';
globalThis.fetch=()=>{throw new Error('network forbidden');};
const id=n=>`${n.toString(16).padStart(8,'0')}-1234-4234-8234-123456789abc`;
const input={runId:id(1),memoId:id(2),tagId:id(3),requestId:id(4),trashRequestId:id(5),recreateRequestId:id(7),userId:id(6)};
const protectedRun={runId:id(20),userId:input.userId,tagId:id(21),memoIds:[id(22),id(23)],trashRequestIds:[id(24),id(25)]};
const protected27={runId:id(30),userId:input.userId,tagId:id(31),memoId:id(32)};
function baseline(){return {memos:protectedRun.memoIds.map((memoId,i)=>({id:memoId,user_id:input.userId,body:'private-existing',revision:2,deleted_at:'2026-10-25T00:00:01Z',pinned_at:null,last_request_id:protectedRun.trashRequestIds[i]})),
  tags:[protectedRun.tagId,protected27.tagId].map(tagId=>({id:tagId,user_id:input.userId,name:`dummy-${tagId}`,revision:1})),memoTags:protectedRun.memoIds.map(memoId=>({user_id:input.userId,memo_id:memoId,tag_id:protectedRun.tagId}))};}
async function simulate(mode=''){
  const state=baseline(),calls=[],confirms=[],records=[];let result,error,submitted;
  const fail=()=>{if(mode===`fail-${calls.length}`)throw new Error('private');};
  if(mode==='missing26')state.memos.pop();if(mode==='missing27')state.tags.pop();
  try{result=await runDeletedIdCase({...input,protectedRun,protected27:mode==='wrong-user'?{...protected27,userId:id(99)}:protected27,
    confirm:async action=>{confirms.push(action);if(action==='recreate'&&mode==='changed-during-confirm')state.tags[0].name='changed';return mode!==`cancel-${action}`;},
    progress:async(action,d)=>{records.push({action,...d});if(mode===`record-${action}`)throw new Error('private');},
    saveFrozen:async body=>{calls.push('save');fail();assert.equal(submitted,undefined);submitted=JSON.parse(body);
      const p=submitted,m={id:p.p_id,user_id:input.userId,title:p.p_title,body:p.p_body,revision:1,last_request_id:p.p_request_id,pinned_at:null,deleted_at:null,created_at:'2026-10-25T00:00:00.123456Z',updated_at:'2026-10-25T00:00:00.123456Z'};
      state.memos.push(structuredClone(m));state.memoTags.push({user_id:input.userId,memo_id:input.memoId,tag_id:input.tagId});
      return {memo:mode==='create-response'?{...m,revision:2}:m,tagIds:[input.tagId]};},
    rejectCreate:async p=>{calls.push('recreate');fail();assert.deepEqual(p,{...submitted,p_request_id:input.recreateRequestId});assert.notEqual(p.p_request_id,submitted.p_request_id);
      if(mode==='resurrection')state.memos.push({id:input.memoId,user_id:input.userId});
      if(mode==='link-resurrection')state.memoTags.push({user_id:input.userId,memo_id:input.memoId,tag_id:input.tagId});
      if(mode==='old-missing')state.memos.pop();if(mode==='old-body')state.memos[0].body='changed';
      if(mode==='old-revision')state.memos[0].revision=3;if(mode==='old-restore')state.memos[0].deleted_at=null;
      if(mode==='old-request')state.memos[0].last_request_id=id(99);
      if(mode==='old-field-added')state.memos[0].extra=true;if(mode==='old-field-missing')delete state.memos[0].body;
      if(mode==='old-tag')state.tags[1].name='changed';if(mode==='old-tag-missing')state.tags.splice(1,1);
      if(mode==='new-tag-missing')state.tags=state.tags.filter(t=>t.id!==input.tagId);
      if(mode==='link-missing')state.memoTags.pop();if(mode==='link-duplicate')state.memoTags.push({...state.memoTags[0]});
      if(mode==='link-extra')state.memoTags.push({...state.memoTags[0],tag_id:input.tagId});
      return {httpStatus:409,code:'PT409',messageMatched:mode!=='bad-receipt'};},
    rpc:async(n,p)=>{calls.push(n);fail();
      if(n==='memo_load_snapshot'){const s=structuredClone(state);for(const k of ['memos','tags','memoTags'])s[k]=s[k].reverse().map(r=>Object.fromEntries(Object.entries(r).reverse()));return s;}
      if(n==='memo_save_tag'){const t={id:input.tagId,user_id:input.userId,name:p.p_name,revision:1,created_at:'2026-10-25T00:00:00Z'};state.tags.push(structuredClone(t));return t;}
      if(n==='memo_change_state'){assert.equal(p.p_id,input.memoId);const m=state.memos.find(m=>m.id===input.memoId),time=mode==='trash-time'?'2026-10-25T00:00:00.123455Z':'2026-10-25T00:00:01.123456Z';Object.assign(m,{revision:2,updated_at:time,deleted_at:time,last_request_id:input.trashRequestId});return structuredClone(m);}
      assert.equal(n,'memo_delete_permanently');assert.deepEqual(p,{p_id:input.memoId,p_expected_revision:2});
      if(mode==='delete-old')state.memos.shift();
      if(mode!=='delete-noop')state.memos=state.memos.filter(m=>m.id!==input.memoId);
      if(mode!=='delete-link')state.memoTags=state.memoTags.filter(r=>r.memo_id!==input.memoId);
      return mode==='delete-receipt'?{}:null;
    }});}catch(e){error=e;}
  return {result,error,calls,confirms,records};
}
test('別requestIdのみ変更・既存2メモ/2タグ/2関連保持→タグだけ追加・12RPC/5確認',async()=>{
  const r=await simulate();assert.ifError(r.error);assert.equal(r.calls.length,12);assert.equal(r.calls.filter(n=>n==='memo_load_snapshot').length,7);
  assert.deepEqual(r.confirms,['tag','create','trash','delete','recreate']);assert.equal(r.calls.filter(n=>n==='recreate').length,1);
  assert.deepEqual(r.result.baselineCounts,{memos:2,tags:2,memoTags:2});assert.deepEqual(r.result.finalCounts,{memos:2,tags:3,memoTags:2});
  assert.equal(r.result.internalRegistryAndLedger,'not-directly-verified');assert.ok(!JSON.stringify(r.records).includes('private'));
});
for(const mode of ['missing26','missing27','wrong-user','create-response','trash-time','delete-old','delete-noop','delete-link','delete-receipt','changed-during-confirm','resurrection','link-resurrection','old-missing','old-body','old-revision','old-restore','old-request','old-field-added','old-field-missing','old-tag','old-tag-missing','new-tag-missing','link-missing','link-duplicate','link-extra','bad-receipt',
  ...['tag','create','trash','delete','recreate'].map(s=>`cancel-${s}`),...['tag','create','trash','delete','recreate'].map(s=>`record-${s}`),...Array.from({length:12},(_,i)=>`fail-${i+1}`)])test(`${mode}: 即停止・自動再送/復旧なし`,async()=>{
  const r=await simulate(mode);assert.ok(r.error);assert.ok(r.calls.length<=12);assert.ok(r.calls.filter(n=>n==='recreate').length<=1);assert.ok(r.calls.filter(n=>n==='memo_delete_permanently').length<=1);
  if(mode.startsWith('fail-'))assert.equal(r.calls.length,Number(mode.slice(5)));
  if(['delete-old','delete-noop','delete-link','delete-receipt','changed-during-confirm'].includes(mode))assert.ok(!r.calls.includes('recreate'));
});
test('ケース27の識別記録とPASS・ケース26への連鎖を照合',()=>{
  const a={...protected27,version:1,test:'deleted-replay-read',requestId:id(33),trashRequestId:id(34),sourceRunId:protectedRun.runId,projectHost:'yohoppqflnhhvqypwhfv.supabase.co',status:'prepared',startedAt:'2026-10-25T00:00:00Z'};
  const b={...a,status:'passed',existingDataUnchanged:true,allDataUnchanged:true,deletedReceipt:true,memosRetained:0,tagsRetained:1,relationsRetained:0};assert.deepEqual(case27Source(a,b,protectedRun),protected27);
  for(const override of [{status:'failed'},{userId:id(99)},{sourceRunId:id(99)},{deletedReceipt:false},{tagId:id(99)}])assert.throws(()=>case27Source(a,{...b,...override},protectedRun));
});
const origin='https://yohoppqflnhhvqypwhfv.supabase.co',p={p_id:input.memoId,p_request_id:input.recreateRequestId,p_expected_revision:null,p_title:'valid dummy',p_body:'dummy',p_tag_ids:[input.tagId]};
for(const mode of ['ok','200','400','code','revision-message','json','body','fetch','timeout'])test(`拒否通信 ${mode}`,async()=>{
  let calls=0;const send=deletedIdRejection(origin,'sb_publishable_mock','private-token',async(url,o)=>{calls++;assert.equal(url,`${origin}/rest/v1/rpc/memo_save`);assert.deepEqual(JSON.parse(o.body),p);assert.equal(o.redirect,'error');assert.ok(o.signal instanceof AbortSignal);assert.equal(o.headers.Authorization,'Bearer private-token');
    if(mode==='fetch')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
    return {status:['200','400'].includes(mode)?Number(mode):409,body:{cancel:async()=>{}},text:async()=>{if(mode==='body')throw new Error('private');return mode==='json'?'private':JSON.stringify({code:mode==='code'?'40001':'PT409',message:mode==='revision-message'?'memo revision conflict':'previously used memo id'});}};});
  if(mode==='ok')assert.deepEqual(await send(p),{httpStatus:409,code:'PT409',messageMatched:true});else await assert.rejects(send(p));assert.equal(calls,1);
});
for(const [host,key,payload] of [['https://production.invalid','sb_publishable_mock',p],[origin,'service_role',p],[origin,'sb_publishable_mock',{...p,p_expected_revision:1}]])test('接続先/キー/引数を通信前に拒否',async()=>{
  let calls=0;const send=deletedIdRejection(host,key,'token',async()=>{calls++;});await assert.rejects(send(payload));assert.equal(calls,0);
});
