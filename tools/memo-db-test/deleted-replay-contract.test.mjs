import test from 'node:test';
import assert from 'node:assert/strict';
import {runDeletedReplayCase,frozenSaveRpc,case26Source,verifyCase26Snapshot} from './deleted-replay-contract.mjs';
import './deleted-replay-read.mjs';
globalThis.fetch=()=>{throw new Error('network forbidden');};
const id=n=>`${n.toString(16).padStart(8,'0')}-1234-4234-8234-123456789abc`;
const input={runId:id(1),memoId:id(2),tagId:id(3),requestId:id(4),trashRequestId:id(5),userId:id(6)};
const source={runId:id(20),userId:input.userId,tagId:id(21),memoIds:[id(22),id(23)],trashRequestIds:[id(24),id(25)]};
function case26State(){return {memos:source.memoIds.map((memoId,i)=>({id:memoId,user_id:input.userId,revision:2,deleted_at:'2026-10-25T00:00:01Z',pinned_at:null,last_request_id:source.trashRequestIds[i],body:'private-existing'})),
  tags:[{id:source.tagId,user_id:input.userId,revision:1,name:'existing'}],memoTags:source.memoIds.map(memoId=>({user_id:input.userId,memo_id:memoId,tag_id:source.tagId}))};}
async function simulate(mode=''){
  const state={memos:[{id:'old',user_id:input.userId,body:'private-existing'}],tags:[{id:'old-tag',user_id:input.userId,name:'old'}],memoTags:[{user_id:input.userId,memo_id:'old',tag_id:'old-tag'}]};
  if(mode.startsWith('case26'))Object.assign(state,case26State());
  const calls=[],bodies=[],confirms=[],records=[];let result,error,initial;
  const fail=()=>{if(mode===`fail-${calls.length}`)throw new Error('private');};
  try{result=await runDeletedReplayCase({...input,protectedRun:mode.startsWith('case26')?source:undefined,
    confirm:async action=>{confirms.push(action);if(action==='replay'&&mode==='changed-during-confirm')state.tags[0].name='changed';return mode!==`cancel-${action}`;},
    progress:async(action,d)=>{records.push({action,...d});if(mode===`record-${action}`)throw new Error('private');},
    saveFrozen:async body=>{
      calls.push('memo_save');bodies.push(body);fail();const p=JSON.parse(body);
      if(bodies.length===1){
        const m={id:p.p_id,user_id:input.userId,title:p.p_title,body:p.p_body,revision:1,last_request_id:p.p_request_id,deleted_at:null,pinned_at:null,created_at:'2026-10-25T00:00:00.123456Z',updated_at:'2026-10-25T00:00:00.123456Z'};
        initial=structuredClone(m);state.memos.push(structuredClone(m));state.memoTags.push({user_id:input.userId,memo_id:input.memoId,tag_id:input.tagId});
        return {memo:mode==='create-revision'?{...m,revision:2}:m,tagIds:[input.tagId]};
      }
      assert.equal(body,bodies[0]);assert.equal(p.p_expected_revision,null);assert.equal(p.p_request_id,input.requestId);
      if(mode==='resurrection')state.memos.push(initial);
      if(mode==='link-resurrection')state.memoTags.push({user_id:input.userId,memo_id:input.memoId,tag_id:input.tagId});
      if(mode==='other-body')state.memos[0].body='changed';
      if(mode==='other-extra')state.memos[0].extra=true;
      if(mode==='other-missing')delete state.memos[0].body;
      if(mode==='tag-missing')state.tags=state.tags.filter(t=>t.id!==input.tagId);
      if(mode==='tag-changed')state.tags.find(t=>t.id===input.tagId).name='changed';
      if(mode==='duplicate-tag')state.tags.push({...state.tags[0]});
      if(mode==='missing-other-link')state.memoTags=[];
      if(mode==='extra-link')state.memoTags.push({user_id:input.userId,memo_id:'old',tag_id:input.tagId});
      if(mode==='duplicate-link')state.memoTags.push({...state.memoTags[0]});
      return mode==='normal-result'?{memo:initial,tagIds:[input.tagId]}:mode==='null'?null:mode==='extra-receipt'?{status:'previously-applied-deleted',result:{}}:mode==='wrong-status'?{status:'saved'}:{status:'previously-applied-deleted'};
    },
    rpc:async(n,p)=>{
      calls.push(n);fail();
      if(n==='memo_load_snapshot'){
        const s=structuredClone(state);if(mode==='collision'&&calls.length===1)s.memos.push({id:input.memoId,user_id:input.userId});
        for(const k of ['memos','tags','memoTags'])s[k]=s[k].reverse().map(r=>Object.fromEntries(Object.entries(r).reverse()));return s;
      }
      if(n==='memo_save_tag'){
        const t={id:input.tagId,user_id:input.userId,name:p.p_name,revision:1,created_at:'2026-10-25T00:00:00Z'};state.tags.push(structuredClone(t));return t;
      }
      if(n==='memo_change_state'){
        if(mode==='case26-changed-trash')state.memos[0].revision=3;
        const m=state.memos.find(m=>m.id===input.memoId),time=mode==='trash-time'?'2026-10-25T00:00:00.123455Z':'2026-10-25T00:00:01.123456Z';
        Object.assign(m,{revision:2,deleted_at:time,updated_at:time,last_request_id:input.trashRequestId});return mode==='trash-response'?{...m,last_request_id:id(99)}:structuredClone(m);
      }
      assert.equal(n,'memo_delete_permanently');assert.deepEqual(p,{p_id:input.memoId,p_expected_revision:2});
      if(mode==='case26-deleted-existing')state.memos.shift();
      if(mode!=='delete-noop')state.memos=state.memos.filter(m=>m.id!==input.memoId);
      if(mode!=='delete-link-remains')state.memoTags=state.memoTags.filter(r=>r.memo_id!==input.memoId);
      return mode==='delete-receipt'?{}:null;
    }});}catch(e){error=e;}
  return {result,error,calls,bodies,confirms,records};
}
test('同一JSON2回・削除後receipt・復活なし・全データ不変、12RPC/5確認',async()=>{
  const r=await simulate();assert.ifError(r.error);assert.equal(r.calls.length,12);assert.equal(r.calls.filter(n=>n==='memo_load_snapshot').length,7);
  assert.deepEqual(r.confirms,['tag','create','trash','delete','replay']);assert.equal(r.bodies.length,2);assert.equal(r.bodies[0],r.bodies[1]);
  assert.equal(r.calls.filter(n=>n==='memo_delete_permanently').length,1);assert.equal(r.result.internalRequestLedger,'not-directly-verified');
  assert.ok(!JSON.stringify(r.records).includes('private'));assert.equal(r.result.memosRetained,0);
});
test('ケース26の2メモ/1タグ/2関連を保護し、最終はタグ1件だけ追加',async()=>{
  const r=await simulate('case26');assert.ifError(r.error);
  assert.deepEqual(r.result.baselineCounts,{memos:2,tags:1,memoTags:2});
  assert.deepEqual(r.result.finalCounts,{memos:2,tags:2,memoTags:2});assert.equal(r.result.existingDataUnchanged,true);
});
for(const mode of ['case26-changed-trash','case26-deleted-existing'])test(`${mode}: 即停止`,async()=>{const r=await simulate(mode);assert.ok(r.error);assert.equal(r.bodies.length,1);});
test('ケース26の記録とPASS・ユーザー・識別情報を照合',()=>{
  const identity={...source,requestIds:[id(26),id(27)],test:'empty-trash-conflict-read',version:1,projectHost:'yohoppqflnhhvqypwhfv.supabase.co',startedAt:'2026-10-25T00:00:00Z',status:'prepared'};
  const result={...identity,status:'passed',allDataUnchanged:true,revisions:[2,2],memosRetained:2,tagsRetained:1,relationsRetained:2};
  assert.deepEqual(case26Source(identity,result),source);
  for(const override of [{status:'failed'},{userId:id(99)},{memoIds:[id(99),id(23)]},{allDataUnchanged:false},{revisions:[2,3]}])assert.throws(()=>case26Source(identity,{...result,...override}));
});
for(const mode of ['user','memo','revision','deleted','tag','link'])test(`ケース26初期状態不一致 ${mode}`,()=>{
  const s=case26State();
  if(mode==='memo')s.memos.pop();if(mode==='revision')s.memos[0].revision=3;if(mode==='deleted')s.memos[0].deleted_at=null;
  if(mode==='tag')s.tags=[];if(mode==='link')s.memoTags.pop();
  assert.throws(()=>verifyCase26Snapshot(s,source,mode==='user'?id(99):input.userId));
});
for(const mode of ['collision','create-revision','trash-time','trash-response','delete-noop','delete-link-remains','delete-receipt','changed-during-confirm',
  'resurrection','link-resurrection','other-body','other-extra','other-missing','tag-missing','tag-changed','duplicate-tag','missing-other-link','extra-link','duplicate-link','normal-result','null','extra-receipt','wrong-status',
  ...['tag','create','trash','delete','replay'].map(s=>`cancel-${s}`),...['tag','create','trash','delete','replay'].map(s=>`record-${s}`),...Array.from({length:12},(_,i)=>`fail-${i+1}`)]){
  test(`${mode}: 即停止・無断再送/復旧/後片付けなし`,async()=>{
    const r=await simulate(mode);assert.ok(r.error);assert.ok(r.calls.length<=12);assert.ok(r.bodies.length<=2);assert.ok(r.calls.filter(n=>n==='memo_delete_permanently').length<=1);
    if(mode.startsWith('fail-'))assert.equal(r.calls.length,Number(mode.slice(5)));
    if(['delete-noop','delete-link-remains','delete-receipt','changed-during-confirm','cancel-replay'].includes(mode))assert.equal(r.bodies.length,1);
    if(['normal-result','null','extra-receipt','wrong-status'].includes(mode))assert.equal(r.calls.at(-1),'memo_save');
  });
}
const origin='https://yohoppqflnhhvqypwhfv.supabase.co';
for(const mode of ['ok','409','204','body','json','fetch','timeout'])test(`生JSON通信 ${mode}`,async()=>{
  let calls=0;const frozen='{ "p_expected_revision": null, "p_body": "dummy" }';
  const save=frozenSaveRpc(origin,'sb_publishable_mock','private-token',async(url,o)=>{
    calls++;assert.equal(url,`${origin}/rest/v1/rpc/memo_save`);assert.equal(o.body,frozen);assert.equal(o.method,'POST');assert.equal(o.redirect,'error');assert.ok(o.signal instanceof AbortSignal);
    assert.equal(o.headers.Authorization,'Bearer private-token');
    if(mode==='fetch')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
    return {status:['409','204'].includes(mode)?Number(mode):200,body:{cancel:async()=>{}},text:async()=>{if(mode==='body')throw new Error('private');return mode==='json'?'private':'{"status":"previously-applied-deleted"}';}};
  });
  if(mode==='ok')assert.deepEqual(await save(frozen),{status:'previously-applied-deleted'});else await assert.rejects(save(frozen));assert.equal(calls,1);
});
for(const [host,key,body] of [['https://production.invalid','sb_publishable_mock','{}'],[origin,'service_role','{}'],[origin,'sb_publishable_mock',{}]])test('接続先/キー/型を送信前拒否',async()=>{
  let calls=0;const save=frozenSaveRpc(host,key,'token',async()=>{calls++;});await assert.rejects(save(body));assert.equal(calls,0);
});
