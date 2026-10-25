import test from 'node:test';
import assert from 'node:assert/strict';
import {runDeleteConflictCase,deleteConflictResponse} from './delete-conflict-contract.mjs';
import './delete-conflict-read.mjs';
globalThis.fetch=()=>{throw new Error('network forbidden');};
const id=n=>`${n.toString(16).padStart(8,'0')}-1234-4234-8234-123456789abc`;
const input={runId:id(1),memoId:id(2),tagId:id(3),requestId:id(4),trashRequestId:id(5),userId:id(6)};
async function simulate(mode=''){
  const state={memos:[{id:'old-memo',user_id:input.userId,body:'private-existing'}],tags:[{id:'old-tag',user_id:input.userId,name:'old'}],
    memoTags:[{user_id:input.userId,memo_id:'old-memo',tag_id:'old-tag'}]};
  const calls=[],confirms=[],records=[];let result,error,rejected=false;
  const fail=()=>{if(mode===`fail-${calls.length}`)throw new Error('private');};
  try{result=await runDeleteConflictCase({...input,
    confirm:async(action)=>{confirms.push(action);
      if(action==='delete-conflict'&&mode==='changed-during-confirm')state.memos.find(m=>m.id===input.memoId).revision=3;
      return mode!==`cancel-${action}`;},
    progress:async(action,detail)=>{records.push({action,...detail});if(mode===`record-${action}`)throw new Error('private');},
    rejectDelete:async p=>{
      calls.push({name:'reject-delete',p});fail();assert.deepEqual(p,{p_id:input.memoId,p_expected_revision:1});rejected=true;
      const memo=state.memos.find(m=>m.id===input.memoId);
      if(mode==='memo-removed')state.memos=state.memos.filter(m=>m.id!==input.memoId);
      if(mode==='link-missing')state.memoTags=state.memoTags.filter(r=>r.memo_id!==input.memoId);
      if(mode==='tag-missing')state.tags=state.tags.filter(t=>t.id!==input.tagId);
      if(mode==='tag-changed')state.tags.find(t=>t.id===input.tagId).name='changed';
      if(mode==='revision')memo.revision=3;
      if(mode==='time')memo.updated_at='2026-10-25T00:00:02Z';
      if(mode==='last-request')memo.last_request_id=id(99);
      if(mode==='body')memo.body='changed';
      if(mode==='title')memo.title='changed';
      if(mode==='restored')memo.deleted_at=null;
      if(mode==='pinned')memo.pinned_at=memo.updated_at;
      if(mode==='other-body')state.memos[0].body='changed';
      if(mode==='other-link')state.memoTags[0].tag_id=id(99);
      if(mode==='duplicate-link')state.memoTags.push({...state.memoTags[1]});
      if(mode==='extra-link')state.memoTags.push({user_id:input.userId,memo_id:input.memoId,tag_id:'old-tag'});
      if(mode==='field-added')memo.extra=true;
      if(mode==='field-missing')delete memo.body;
      return mode==='bad-receipt'?{httpStatus:409,code:'PT409',messageMatched:false}:{httpStatus:409,code:'PT409',messageMatched:true};
    },
    rpc:async(name,p)=>{
      calls.push({name,p});fail();
      if(name==='memo_load_snapshot'){
        const s=structuredClone(state);
        if(mode==='collision'&&calls.length===1)s.memos.push({id:input.memoId,user_id:input.userId});
        if(mode==='owner')s.memos[0].user_id='other';
        for(const key of ['memos','tags','memoTags'])s[key]=s[key].reverse().map(r=>Object.fromEntries(Object.entries(r).reverse()));return s;
      }
      if(name==='memo_save_tag'){
        const t={id:input.tagId,user_id:input.userId,name:p.p_name,revision:1,created_at:'2026-10-25T00:00:00Z'};
        state.tags.push(structuredClone(t));return mode==='tag-response'?{...t,revision:2}:t;
      }
      if(name==='memo_save'){
        const m={id:input.memoId,user_id:input.userId,title:p.p_title,body:p.p_body,revision:1,last_request_id:input.requestId,pinned_at:null,deleted_at:null,
          created_at:'2026-10-25T00:00:00.123456Z',updated_at:'2026-10-25T00:00:00.123456Z'};
        state.memos.push(structuredClone(m));state.memoTags.push({user_id:input.userId,memo_id:input.memoId,tag_id:input.tagId});
        return {memo:mode==='memo-response'?{...m,last_request_id:id(99)}:m,tagIds:[input.tagId]};
      }
      assert.equal(name,'memo_change_state');assert.equal(p.p_expected_revision,1);assert.equal(p.p_action,'trash');
      const m=state.memos.find(r=>r.id===input.memoId),time=mode==='trash-time'?'2026-10-25T00:00:00.123455Z':'2026-10-25T00:00:01.123456Z';
      Object.assign(m,{revision:2,deleted_at:time,updated_at:time,last_request_id:input.trashRequestId});
      return mode==='trash-response'?{...m,revision:3}:structuredClone(m);
    }});}catch(e){error=e;}
  return {result,error,calls,confirms,records,rejected};
}
test('直前状態＋厳密な拒否＋全取得データ不変、10RPC/4確認・削除試行1回',async()=>{
  const r=await simulate();assert.ifError(r.error);assert.equal(r.calls.length,10);
  assert.deepEqual(r.confirms,['tag','create','trash','delete-conflict']);
  assert.equal(r.calls.filter(c=>c.name==='memo_load_snapshot').length,6);
  assert.equal(r.calls.filter(c=>c.name==='reject-delete').length,1);
  assert.equal(r.calls.at(-2).name,'reject-delete');assert.equal(r.calls.at(-3).name,'memo_load_snapshot');
  assert.equal(r.result.revision,2);assert.equal(r.result.deleted,true);assert.equal(r.result.internalRequestLedger,'not-directly-verified');
  assert.ok(!JSON.stringify(r.records).includes('private'));
});
for(const mode of ['collision','owner','tag-response','memo-response','trash-response','trash-time','changed-during-confirm','bad-receipt',
  'memo-removed','link-missing','tag-missing','tag-changed','revision','time','last-request','body','title','restored','pinned','other-body','other-link','duplicate-link','extra-link','field-added','field-missing',
  ...['tag','create','trash','delete-conflict'].map(s=>`cancel-${s}`),...['tag','create','trash','delete-conflict'].map(s=>`record-${s}`),...Array.from({length:10},(_,i)=>`fail-${i+1}`)]){
  test(`${mode}: 即停止・再試行なし`,async()=>{
    const r=await simulate(mode);assert.ok(r.error);assert.ok(r.calls.length<=10);
    for(const n of ['memo_save_tag','memo_save','memo_change_state','reject-delete'])assert.ok(r.calls.filter(c=>c.name===n).length<=1);
    if(mode.startsWith('fail-'))assert.equal(r.calls.length,Number(mode.slice(5)));
    if(mode==='changed-during-confirm')assert.equal(r.rejected,false);
  });
}
const origin='https://yohoppqflnhhvqypwhfv.supabase.co';
for(const mode of ['ok','204','200','400','code','message','json','body','fetch','timeout']){
  test(`拒否通信 ${mode}`,async()=>{
    let calls=0,cancelled=false;
    const send=deleteConflictResponse(origin,'sb_publishable_mock','private-token',async(url,o)=>{
      calls++;assert.equal(url,`${origin}/rest/v1/rpc/memo_delete_permanently`);assert.equal(o.method,'POST');assert.equal(o.redirect,'error');assert.ok(o.signal instanceof AbortSignal);
      assert.equal(o.headers.Authorization,'Bearer private-token');assert.deepEqual(JSON.parse(o.body),{p_id:input.memoId,p_expected_revision:1});
      if(mode==='fetch')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
      return {status:['204','200','400'].includes(mode)?Number(mode):409,body:{cancel:async()=>{cancelled=true;}},text:async()=>{
        if(mode==='body')throw new Error('private');if(mode==='json')return 'private';
        return JSON.stringify({code:mode==='code'?'40001':'PT409',message:mode==='message'?'private':'not found or revision conflict'});
      }};
    });
    const action=()=>send({p_id:input.memoId,p_expected_revision:1});
    if(mode==='ok'){const r=await action();assert.deepEqual(r,{httpStatus:409,code:'PT409',messageMatched:true});assert.ok(!JSON.stringify(r).includes('private'));}
    else await assert.rejects(action());assert.equal(calls,1);
    if(['204','200','400'].includes(mode))assert.equal(cancelled,true);
  });
}
for(const [host,key,payload] of [['https://production.invalid','sb_publishable_mock',{p_id:input.memoId,p_expected_revision:1}],
  [origin,'service_role',{p_id:input.memoId,p_expected_revision:1}],[origin,'sb_publishable_mock',{p_id:input.memoId,p_expected_revision:2}],
  [origin,'sb_publishable_mock',{p_id:'invalid',p_expected_revision:1}]])test('接続先/キー/引数の誤りは通信前停止',async()=>{
  let calls=0;const send=deleteConflictResponse(host,key,'token',async()=>{calls++;});await assert.rejects(send(payload));assert.equal(calls,0);
});
