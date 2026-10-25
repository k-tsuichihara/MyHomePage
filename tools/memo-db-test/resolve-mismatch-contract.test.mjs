import test from 'node:test';
import assert from 'node:assert/strict';
import {runResolveMismatchCase,case28Source,resolveMismatchRejection} from './resolve-mismatch-contract.mjs';
import './resolve-mismatch-read.mjs';
globalThis.fetch=()=>{throw new Error('network forbidden');};
const id=n=>`${n.toString(16).padStart(8,'0')}-1234-4234-8234-123456789abc`;
const input={runId:id(1),memoId:id(2),tagId:id(3),requestId:id(4),userId:id(5)};
const a={runId:id(20),tagId:id(21),userId:input.userId,memoIds:[id(22),id(23)],trashRequestIds:[id(24),id(25)]};
const b={runId:id(30),tagId:id(31),memoId:id(32),userId:input.userId};
const c={runId:id(40),tagId:id(41),memoId:id(42),userId:input.userId};
async function simulate(mode=''){
  const state={memos:a.memoIds.map((memoId,i)=>({id:memoId,user_id:input.userId,body:'private-existing',revision:2,deleted_at:'2026-10-25T00:00:01Z',pinned_at:null,last_request_id:a.trashRequestIds[i]})),tags:[a.tagId,b.tagId,c.tagId].map(tagId=>({id:tagId,user_id:input.userId,name:`dummy-${tagId}`,revision:1})),memoTags:a.memoIds.map(memoId=>({user_id:input.userId,memo_id:memoId,tag_id:a.tagId}))};
  const calls=[],confirms=[],records=[];let result,error,submitted,saved,resolves=0;
  const fail=()=>{if(mode===`fail-${calls.length}`)throw new Error('private');};
  if(mode==='missing28')state.tags.pop();if(mode==='missing26')state.memos.pop();
  try{result=await runResolveMismatchCase({...input,protectedRun:a,protected27:b,protected28:mode==='wrong-user'?{...c,userId:id(99)}:c,
    confirm:async action=>{confirms.push(action);return mode!==`cancel-${action}`;},progress:async(action,d)=>{records.push({action,...d});if(mode===`record-${action}`)throw new Error('private');},
    saveFrozen:async body=>{calls.push('save');fail();assert.equal(submitted,undefined);submitted=JSON.parse(body);
      const m={id:input.memoId,user_id:input.userId,title:submitted.p_title,body:submitted.p_body,revision:1,last_request_id:input.requestId,pinned_at:null,deleted_at:null,created_at:'2026-10-25T00:00:00Z',updated_at:'2026-10-25T00:00:00Z'};
      state.memos.push(structuredClone(m));state.memoTags.push({user_id:input.userId,memo_id:input.memoId,tag_id:input.tagId});saved={memo:m,tagIds:[input.tagId]};return mode==='create-response'?{...saved,tagIds:[]}:structuredClone(saved);},
    rejectResolve:async p=>{calls.push('mismatch');fail();assert.notEqual(p.p_body,submitted.p_body);assert.deepEqual({...p,p_body:submitted.p_body},submitted);
      if(mode==='body-change')state.memos[2].body='changed';if(mode==='revision')state.memos[2].revision=2;
      if(mode==='time')state.memos[2].updated_at='2026-10-25T00:00:01Z';if(mode==='request')state.memos[2].last_request_id=id(99);
      if(mode==='old-body')state.memos[0].body='changed';if(mode==='old-tag')state.tags[0].name='changed';
      if(mode==='missing-link')state.memoTags.pop();if(mode==='duplicate-link')state.memoTags.push({...state.memoTags[0]});
      if(mode==='extra-link')state.memoTags.push({...state.memoTags[0],tag_id:input.tagId});
      if(mode==='field-added')state.memos[0].extra=true;if(mode==='field-missing')delete state.memos[0].body;
      return {httpStatus:400,code:'22023',messageMatched:mode!=='bad-receipt'};},
    rpc:async(n,p)=>{calls.push(n);fail();
      if(n==='memo_load_snapshot'){const s=structuredClone(state);for(const k of ['memos','tags','memoTags'])s[k]=s[k].reverse().map(r=>Object.fromEntries(Object.entries(r).reverse()));return s;}
      if(n==='memo_save_tag'){const t={id:input.tagId,user_id:input.userId,name:p.p_name,revision:1,created_at:'2026-10-25T00:00:00Z'};state.tags.push(structuredClone(t));return t;}
      assert.equal(n,'memo_resolve_request');assert.deepEqual(p,submitted);resolves++;
      if(mode===`resolve-null-${resolves}`)return null;
      if(mode===`resolve-wrong-${resolves}`)return {status:'saved',result:{...saved,memo:{...saved.memo,revision:2}}};
      return {status:'saved',result:structuredClone(saved)};
    }});}catch(e){error=e;}
  return {result,error,calls,confirms,records};
}
test('本文だけ変更・新規保存1回/正規照合2回/不一致照合1回、11RPC/2確認',async()=>{
  const r=await simulate();assert.ifError(r.error);assert.equal(r.calls.length,11);assert.equal(r.calls.filter(n=>n==='memo_load_snapshot').length,6);
  assert.deepEqual(r.confirms,['tag','create']);assert.equal(r.calls.filter(n=>n==='mismatch').length,1);assert.equal(r.calls.filter(n=>n==='save').length,1);
  assert.deepEqual(r.result.finalCounts,{memos:3,tags:4,memoTags:3});assert.equal(r.result.savedResultUnchanged,true);assert.ok(!JSON.stringify(r.records).includes('private'));
});
for(const mode of ['missing28','missing26','wrong-user','create-response','body-change','revision','time','request','old-body','old-tag','missing-link','duplicate-link','extra-link','field-added','field-missing','bad-receipt','resolve-null-1','resolve-null-2','resolve-wrong-1','resolve-wrong-2',
  'cancel-tag','cancel-create',...['tag','create','mismatch','original'].map(s=>`record-${s}`),...Array.from({length:11},(_,i)=>`fail-${i+1}`)])test(`${mode}: 即停止・自動再送なし`,async()=>{
  const r=await simulate(mode);assert.ok(r.error);assert.ok(r.calls.length<=11);assert.ok(r.calls.filter(n=>n==='mismatch').length<=1);assert.ok(r.calls.filter(n=>n==='save').length<=1);
  if(mode.startsWith('fail-'))assert.equal(r.calls.length,Number(mode.slice(5)));
});
test('ケース28 PASSと参照元・userIdを照合',()=>{
  const x={...c,version:1,test:'deleted-id-read',requestId:id(43),trashRequestId:id(44),recreateRequestId:id(45),sourceRunId:a.runId,source27RunId:b.runId,projectHost:'yohoppqflnhhvqypwhfv.supabase.co',status:'prepared',startedAt:'2026-10-25T00:00:00Z'};
  const y={...x,status:'passed',existingDataUnchanged:true,memosRetained:0,tagsRetained:1,relationsRetained:0};assert.deepEqual(case28Source(x,y,a,b),c);
  for(const patch of [{status:'failed'},{userId:id(99)},{sourceRunId:id(99)},{existingDataUnchanged:false},{tagId:id(99)}])assert.throws(()=>case28Source(x,{...y,...patch},a,b));
});
const origin='https://yohoppqflnhhvqypwhfv.supabase.co';
const p={p_id:input.memoId,p_request_id:input.requestId,p_title:'valid',p_body:'different',p_tag_ids:[input.tagId],p_expected_revision:null};
for(const mode of ['ok','200','409','code','message','json','body','fetch','timeout'])test(`照合通信 ${mode}`,async()=>{
  let calls=0;const send=resolveMismatchRejection(origin,'sb_publishable_mock','private-token',async(url,o)=>{calls++;assert.equal(url,`${origin}/rest/v1/rpc/memo_resolve_request`);assert.equal(o.method,'POST');assert.equal(o.redirect,'error');assert.ok(o.signal instanceof AbortSignal);assert.deepEqual(JSON.parse(o.body),p);
    if(mode==='fetch')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
    return {status:['200','409'].includes(mode)?Number(mode):400,body:{cancel:async()=>{}},text:async()=>{if(mode==='body')throw new Error('private');return mode==='json'?'private':JSON.stringify({code:mode==='code'?'PT409':'22023',message:mode==='message'?'invalid argument':'request mismatch'});}};});
  if(mode==='ok')assert.deepEqual(await send(p),{httpStatus:400,code:'22023',messageMatched:true});else await assert.rejects(send(p));assert.equal(calls,1);
});
for(const [host,key] of [['https://production.invalid','sb_publishable_mock'],[origin,'service_role']])test('接続先・キー不一致は通信前拒否',async()=>{
  let calls=0;const send=resolveMismatchRejection(host,key,'token',async()=>{calls++;});await assert.rejects(send(p));assert.equal(calls,0);
});
