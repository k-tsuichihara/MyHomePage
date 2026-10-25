import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyDedicatedUser,runEmptyTrashConflictCase,emptyTrashCaseRpc,emptyTrashConflictResponse} from './empty-trash-conflict-contract.mjs';
import './empty-trash-conflict-read.mjs';
globalThis.fetch=()=>{throw new Error('network forbidden');};
const id=n=>`${n.toString(16).padStart(8,'0')}-1234-4234-8234-123456789abc`;
const input={runId:id(1),tagId:id(2),memoIds:[id(3),id(4)],requestIds:[id(5),id(6)],trashRequestIds:[id(7),id(8)],userId:id(9),expectedUserId:id(9)};
async function simulate(mode=''){
  const state={memos:[],tags:[],memoTags:[]},calls=[],confirms=[],records=[];let result,error,rejected=false;
  if(mode==='initial-memo')state.memos.push({id:id(90),user_id:input.userId});
  if(mode==='initial-tag')state.tags.push({id:id(90),user_id:input.userId});
  if(mode==='initial-link')state.memoTags.push({memo_id:id(90),tag_id:id(91),user_id:input.userId});
  const fail=()=>{if(mode===`fail-${calls.length}`)throw new Error('private');};
  try{result=await runEmptyTrashConflictCase({...input,expectedUserId:mode==='wrong-user'?id(10):input.userId,recordedIds:new Set(mode==='old-user'?[input.userId]:[]),
    confirm:async action=>{confirms.push(action);
      if(action==='empty-conflict'){
        if(mode==='extra-trash')state.memos.push({...state.memos[0],id:id(99)});
        if(mode==='restored-before')state.memos[0].deleted_at=null;
        if(mode==='revision-before')state.memos[1].revision=3;
        if(mode==='link-before')state.memoTags.pop();
        if(mode==='owner-before')state.memos[0].user_id=id(99);
      }
      return mode!==`cancel-${action}`;},
    progress:async(action,d)=>{records.push({action,...d});if(mode===`record-${action}`)throw new Error('private');},
    rpc:async(n,p)=>{
      calls.push(n);fail();
      if(n==='memo_load_snapshot'){
        const s=structuredClone(state);
        for(const k of ['memos','tags','memoTags'])s[k]=s[k].reverse().map(r=>Object.fromEntries(Object.entries(r).reverse()));return s;
      }
      if(n==='memo_save_tag'){
        const t={id:p.p_id,user_id:input.userId,name:p.p_name,revision:1,created_at:'2026-10-25T00:00:00Z'};state.tags.push(structuredClone(t));return mode==='tag-response'?{...t,revision:2}:t;
      }
      if(n==='memo_save'){
        const m={id:p.p_id,user_id:input.userId,title:p.p_title,body:p.p_body,revision:1,last_request_id:p.p_request_id,deleted_at:null,pinned_at:null,created_at:'2026-10-25T00:00:00.123456Z',updated_at:'2026-10-25T00:00:00.123456Z'};
        state.memos.push(structuredClone(m));state.memoTags.push({user_id:input.userId,memo_id:p.p_id,tag_id:input.tagId});return {memo:mode==='memo-response'?{...m,revision:2}:m,tagIds:[input.tagId]};
      }
      assert.equal(n,'memo_change_state');assert.equal(p.p_action,'trash');assert.equal(p.p_expected_revision,1);
      const m=state.memos.find(m=>m.id===p.p_id),time=mode==='trash-time'?'2026-10-25T00:00:00.123455Z':'2026-10-25T00:00:01.123456Z';
      Object.assign(m,{revision:2,updated_at:time,deleted_at:time,last_request_id:p.p_request_id});return mode==='trash-response'?{...m,revision:3}:structuredClone(m);
    },
    rejectEmpty:async p=>{
      calls.push('memo_empty_trash');fail();rejected=true;assert.deepEqual(p,{p_ids:input.memoIds,p_revisions:[2,1]});
      if(mode==='memo-missing')state.memos.pop();
      if(mode==='all-deleted')state.memos=[];
      if(mode==='revision-after')state.memos[0].revision=3;
      if(mode==='body-after')state.memos[1].body='private-changed';
      if(mode==='title-after')state.memos[0].title='changed';
      if(mode==='time-after')state.memos[0].updated_at='2026-10-25T00:00:02Z';
      if(mode==='request-after')state.memos[0].last_request_id=id(99);
      if(mode==='restored-after')state.memos[0].deleted_at=null;
      if(mode==='tag-missing')state.tags=[];
      if(mode==='tag-after')state.tags[0].name='changed';
      if(mode==='link-missing')state.memoTags.pop();
      if(mode==='link-duplicate')state.memoTags.push({...state.memoTags[0]});
      if(mode==='link-extra')state.memoTags.push({...state.memoTags[0],memo_id:id(99)});
      if(mode==='field-added')state.memos[0].extra=true;
      if(mode==='field-missing')delete state.memos[0].body;
      return {httpStatus:409,code:'PT409',messageMatched:mode!=='bad-receipt'};
    }});}catch(e){error=e;}
  return {result,error,calls,confirms,records,rejected};
}
test('14RPC/6確認・完全空状態→2件trash→厳密拒否→全データ不変、順序は無視',async()=>{
  const r=await simulate();assert.ifError(r.error);assert.equal(r.calls.length,14);assert.equal(r.calls.filter(n=>n==='memo_load_snapshot').length,8);
  assert.deepEqual(r.confirms,['tag','create-0','create-1','trash-0','trash-1','empty-conflict']);assert.equal(r.calls.filter(n=>n==='memo_empty_trash').length,1);
  assert.equal(r.calls.at(-3),'memo_load_snapshot');assert.equal(r.calls.at(-2),'memo_empty_trash');
  assert.deepEqual(r.result.revisions,[2,2]);assert.equal(r.result.internalRequestLedger,'not-directly-verified');assert.ok(!JSON.stringify(r.records).includes('private'));
});
for(const mode of ['initial-memo','initial-tag','initial-link','wrong-user','old-user','tag-response','memo-response','trash-response','trash-time',
  'extra-trash','restored-before','revision-before','link-before','owner-before','memo-missing','all-deleted','revision-after','body-after','title-after','time-after','request-after','restored-after','tag-missing','tag-after','link-missing','link-duplicate','link-extra','field-added','field-missing','bad-receipt',
  ...['tag','create-0','create-1','trash-0','trash-1','empty-conflict'].map(s=>`cancel-${s}`),...['tag','create-0','create-1','trash-0','trash-1','empty-conflict'].map(s=>`record-${s}`),...Array.from({length:14},(_,i)=>`fail-${i+1}`)]){
  test(`${mode}: 停止・再送/復旧なし`,async()=>{
    const r=await simulate(mode);assert.ok(r.error);assert.ok(r.calls.length<=14);assert.ok(r.calls.filter(n=>n==='memo_empty_trash').length<=1);
    if(mode.startsWith('initial-')){assert.equal(r.calls.length,1);assert.equal(r.confirms.length,0);}
    if(['wrong-user','old-user'].includes(mode))assert.equal(r.calls.length,0);
    if(['extra-trash','restored-before','revision-before','link-before','owner-before'].includes(mode))assert.equal(r.rejected,false);
    if(mode.startsWith('fail-'))assert.equal(r.calls.length,Number(mode.slice(5)));
  });
}
const origin='https://yohoppqflnhhvqypwhfv.supabase.co',payload={p_ids:input.memoIds,p_revisions:[2,1]};
for(const mode of ['ok','200','204','400','code','message','snapshot-message','json','body','fetch','timeout'])test(`一括応答 ${mode}`,async()=>{
  let calls=0;const send=emptyTrashConflictResponse(origin,'sb_publishable_mock','private-token',async(url,o)=>{
    calls++;assert.equal(url,`${origin}/rest/v1/rpc/memo_empty_trash`);assert.equal(o.method,'POST');assert.equal(o.redirect,'error');assert.ok(o.signal instanceof AbortSignal);
    assert.equal(o.headers.Authorization,'Bearer private-token');assert.deepEqual(JSON.parse(o.body),payload);
    if(mode==='fetch')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
    return {status:['200','204','400'].includes(mode)?Number(mode):409,body:{cancel:async()=>{}},text:async()=>{
      if(mode==='body')throw new Error('private');if(mode==='json')return 'private';return JSON.stringify({code:mode==='code'?'40001':'PT409',message:mode==='message'?'private':mode==='snapshot-message'?'trash snapshot conflict':'trash revision conflict'});
    }};
  });
  if(mode==='ok')assert.deepEqual(await send(payload),{httpStatus:409,code:'PT409',messageMatched:true});else await assert.rejects(send(payload));assert.equal(calls,1);
});
test('ユーザー識別：一致・過去run UUID・不一致・無効値',()=>{
  verifyDedicatedUser(input.userId,input.userId,new Set());
  for(const [e,a,s] of [[input.userId,id(99),new Set()],[input.userId,input.userId,new Set([input.userId])],['invalid',input.userId,new Set()],[input.userId,undefined,new Set()]])assert.throws(()=>verifyDedicatedUser(e,a,s));
});
for(const [host,key,p] of [['https://production.invalid','sb_publishable_mock',payload],[origin,'service_role',payload],[origin,'sb_publishable_mock',{...payload,p_revisions:[2,2]}],[origin,'sb_publishable_mock',{...payload,p_ids:[input.memoIds[0],input.memoIds[0]]}],[origin,'sb_publishable_mock',{...payload,p_ids:[input.memoIds]}]])test('接続/キー/引数誤りは通信前拒否',async()=>{
  let calls=0;const send=emptyTrashConflictResponse(host,key,'token',async()=>{calls++;});await assert.rejects(send(p));assert.equal(calls,0);
});
test('通常経路から一括/個別削除・照合RPCへ到達不可',async()=>{
  let calls=0;const rpc=emptyTrashCaseRpc(origin,'sb_publishable_mock','token',async()=>{calls++;});
  for(const n of ['memo_empty_trash','memo_delete_permanently','memo_resolve_request'])assert.throws(()=>rpc(n,{}));assert.equal(calls,0);
});
