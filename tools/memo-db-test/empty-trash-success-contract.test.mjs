import test from 'node:test';
import assert from 'node:assert/strict';
import {runEmptyTrashSuccessCase,emptyTrashSuccessCaseRpc,emptyTrashSuccessResponse} from './empty-trash-success-contract.mjs';
import './empty-trash-success-read.mjs';
globalThis.fetch=()=>{throw new Error('network forbidden');};
const id=n=>`${n.toString(16).padStart(8,'0')}-1234-4234-8234-123456789abc`;
const input={runId:id(1),tagId:id(2),memoIds:[id(3),id(4),id(5)],requestIds:[id(6),id(7),id(8)],trashRequestIds:[id(9),id(10)],userId:id(11),expectedUserId:id(11)};
async function simulate(mode=''){
  const state={memos:[],tags:[],memoTags:[]},calls=[],confirms=[],records=[];let result,error,bulk=false;
  const fail=()=>{if(mode===`fail-${calls.length}`)throw new Error('private');};
  if(mode==='initial-memo')state.memos.push({id:id(99),user_id:input.userId});
  if(mode==='initial-tag')state.tags.push({id:id(99),user_id:input.userId});
  if(mode==='initial-link')state.memoTags.push({user_id:input.userId,memo_id:id(98),tag_id:id(99)});
  try{result=await runEmptyTrashSuccessCase({...input,expectedUserId:mode==='wrong-user'?id(99):input.userId,recordedIds:new Set(mode==='old-user'?[input.userId]:[]),
    confirm:async(action,summary)=>{confirms.push(action);
      if(action==='empty'){assert.deepEqual(summary.ids,input.memoIds.slice(0,2));assert.deepEqual(summary.expectedRevisions,[2,2]);assert.equal(summary.count,2);
        if(mode==='extra-trash')state.memos.push({...state.memos[0],id:id(99)});
        if(mode==='restored-before')state.memos[0].deleted_at=null;
        if(mode==='revision-before')state.memos[0].revision=3;
        if(mode==='normal-before')state.memos[2].body='changed';
        if(mode==='link-before')state.memoTags.pop();
      }return mode!==`cancel-${action}`;},
    progress:async(action,d)=>{records.push({action,...d});if(mode===`record-${action}`)throw new Error('private');},
    rpc:async(n,p)=>{calls.push(n);fail();
      if(n==='memo_load_snapshot'){const s=structuredClone(state);for(const k of ['memos','tags','memoTags'])s[k]=s[k].reverse().map(r=>Object.fromEntries(Object.entries(r).reverse()));return s;}
      if(n==='memo_save_tag'){const t={id:input.tagId,user_id:input.userId,name:p.p_name,revision:1,created_at:'2026-10-25T00:00:00Z'};state.tags.push(structuredClone(t));return mode==='tag-response'?{...t,revision:2}:t;}
      if(n==='memo_save'){const m={id:p.p_id,user_id:input.userId,title:p.p_title,body:p.p_body,revision:1,last_request_id:p.p_request_id,pinned_at:null,deleted_at:null,created_at:'2026-10-25T00:00:00.123456Z',updated_at:'2026-10-25T00:00:00.123456Z'};
        state.memos.push(structuredClone(m));state.memoTags.push({user_id:input.userId,memo_id:p.p_id,tag_id:input.tagId});return {memo:mode==='memo-response'?{...m,revision:2}:m,tagIds:[input.tagId]};}
      assert.equal(n,'memo_change_state');assert.ok(input.memoIds.slice(0,2).includes(p.p_id));assert.equal(p.p_action,'trash');
      const m=state.memos.find(m=>m.id===p.p_id),time=mode==='trash-time'?'2026-10-25T00:00:00.123455Z':'2026-10-25T00:00:01.123456Z';
      Object.assign(m,{revision:2,updated_at:time,deleted_at:time,last_request_id:p.p_request_id});return structuredClone(m);
    },
    emptyTrash:async p=>{calls.push('memo_empty_trash');fail();bulk=true;assert.deepEqual(p,{p_ids:input.memoIds.slice(0,2),p_revisions:[2,2]});
      const targetIds=mode==='partial'?[input.memoIds[0]]:mode==='noop'?[]:input.memoIds.slice(0,2);
      state.memos=state.memos.filter(m=>!targetIds.includes(m.id));state.memoTags=state.memoTags.filter(r=>!targetIds.includes(r.memo_id));
      if(mode==='normal-deleted')state.memos=[];if(mode==='normal-link-deleted')state.memoTags=[];
      if(mode==='normal-body')state.memos[0].body='changed';if(mode==='normal-revision')state.memos[0].revision=2;
      if(mode==='normal-request')state.memos[0].last_request_id=id(99);if(mode==='normal-time')state.memos[0].updated_at='2026-10-25T00:00:02Z';
      if(mode==='field-added')state.memos[0].extra=true;if(mode==='field-missing')delete state.memos[0].body;
      if(mode==='tag-missing')state.tags=[];if(mode==='tag-change')state.tags[0].name='changed';
      if(mode==='duplicate-link')state.memoTags.push({...state.memoTags[0]});
      if(mode==='extra-link')state.memoTags.push({...state.memoTags[0],memo_id:input.memoIds[0]});
      return mode==='wrong-count'?1:mode==='string-count'?'2':2;
    }});}catch(e){error=e;}
  return {result,error,calls,confirms,records,bulk};
}
test('正常削除2・通常メモ/タグ/関連を全フィールド保持・17RPC/7確認',async()=>{
  const r=await simulate();assert.ifError(r.error);assert.equal(r.calls.length,17);assert.equal(r.calls.filter(n=>n==='memo_load_snapshot').length,10);
  assert.deepEqual(r.confirms,['tag','create-0','create-1','create-2','trash-0','trash-1','empty']);assert.equal(r.calls.filter(n=>n==='memo_empty_trash').length,1);
  assert.equal(r.result.deletedCount,2);assert.equal(r.result.memosRetained,1);assert.ok(!JSON.stringify(r.records).includes('private'));
});
for(const mode of ['initial-memo','initial-tag','initial-link','wrong-user','old-user','tag-response','memo-response','trash-time','extra-trash','restored-before','revision-before','normal-before','link-before',
  'partial','noop','normal-deleted','normal-link-deleted','normal-body','normal-revision','normal-request','normal-time','field-added','field-missing','tag-missing','tag-change','duplicate-link','extra-link','wrong-count','string-count',
  ...['tag','create-0','create-1','create-2','trash-0','trash-1','empty'].map(s=>`cancel-${s}`),...['tag','create-0','create-1','create-2','trash-0','trash-1','empty'].map(s=>`record-${s}`),...Array.from({length:17},(_,i)=>`fail-${i+1}`)])test(`${mode}: 即停止・再試行/復旧なし`,async()=>{
  const r=await simulate(mode);assert.ok(r.error);assert.ok(r.calls.length<=17);assert.ok(r.calls.filter(n=>n==='memo_empty_trash').length<=1);
  if(mode.startsWith('initial-')){assert.equal(r.calls.length,1);assert.equal(r.confirms.length,0);}
  if(['wrong-user','old-user'].includes(mode))assert.equal(r.calls.length,0);
  if(['extra-trash','restored-before','revision-before','normal-before','link-before'].includes(mode))assert.equal(r.bulk,false);
  if(mode.startsWith('fail-'))assert.equal(r.calls.length,Number(mode.slice(5)));
});
const origin='https://yohoppqflnhhvqypwhfv.supabase.co',payload={p_ids:input.memoIds.slice(0,2),p_revisions:[2,2]};
for(const mode of ['ok','409','204','string','array','object','null','one','three','fraction','json','body','fetch','timeout'])test(`正常応答の厳密検証 ${mode}`,async()=>{
  let calls=0;const send=emptyTrashSuccessResponse(origin,'sb_publishable_mock','private-token',async(url,o)=>{calls++;assert.equal(url,`${origin}/rest/v1/rpc/memo_empty_trash`);assert.equal(o.method,'POST');assert.equal(o.redirect,'error');assert.ok(o.signal instanceof AbortSignal);assert.deepEqual(JSON.parse(o.body),payload);
    if(mode==='fetch')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
    return {status:['409','204'].includes(mode)?Number(mode):200,body:{cancel:async()=>{}},text:async()=>{if(mode==='body')throw new Error('private');
      return ({string:'"2"',array:'[2]',object:'{"count":2}',null:'null',one:'1',three:'3',fraction:'2.5',json:'private'})[mode]??'2';}};
  });if(mode==='ok')assert.equal(await send(payload),2);else await assert.rejects(send(payload));assert.equal(calls,1);
});
for(const [host,key,p] of [['https://production.invalid','sb_publishable_mock',payload],[origin,'service_role',payload],[origin,'sb_publishable_mock',{...payload,p_revisions:[2,1]}],[origin,'sb_publishable_mock',{...payload,p_ids:[input.memoIds[0],input.memoIds[0]]}]])test('接続先/キー/配列不一致は送信前停止',async()=>{
  let calls=0;const send=emptyTrashSuccessResponse(host,key,'token',async()=>{calls++;});await assert.rejects(send(p));assert.equal(calls,0);
});
test('通常経路から一括/個別削除・照合は呼べない',()=>{let calls=0;const rpc=emptyTrashSuccessCaseRpc(origin,'sb_publishable_mock','token',async()=>{calls++;});for(const n of ['memo_empty_trash','memo_delete_permanently','memo_resolve_request'])assert.throws(()=>rpc(n,{}));assert.equal(calls,0);});
