import test from 'node:test';
import assert from 'node:assert/strict';
import {permanentDeleteRpc,runPermanentDeleteCase} from './permanent-delete-contract.mjs';
import './permanent-delete-read.mjs';
globalThis.fetch=()=>{throw new Error('network forbidden');};
const id=n=>`${n.toString(16).padStart(8,'0')}-1234-4234-8234-123456789abc`;
const input={runId:id(1),memoId:id(2),tagId:id(3),requestId:id(4),trashRequestId:id(5),userId:id(6)};
async function simulate(mode=''){
  const state={memos:[{id:'old-memo',user_id:input.userId,body:'private-existing'}],tags:[{id:'old-tag',user_id:input.userId,name:'old'}],
    memoTags:[{user_id:input.userId,memo_id:'old-memo',tag_id:'old-tag'}]};
  const calls=[],confirms=[],records=[];let result,error,deleted=false;
  try{result=await runPermanentDeleteCase({...input,
    confirm:async(action)=>{confirms.push(action);return mode!==`cancel-${action}`;},
    progress:async(action,detail)=>{records.push({action,...detail});if(mode===`record-${action}`)throw new Error('private');},
    rpc:async(name,p)=>{
      calls.push({name,p});if(mode===`fail-${calls.length}`)throw new Error('private');
      if(name==='memo_load_snapshot'){
        const s=structuredClone(state);
        if(mode==='collision'&&calls.length===1)s.memos.push({id:input.memoId,user_id:input.userId});
        if(mode==='owner')s.memos[0].user_id='other';
        if(deleted){
          if(mode==='tag-missing')s.tags=s.tags.filter(t=>t.id!==input.tagId);
          if(mode==='tag-changed')s.tags.find(t=>t.id===input.tagId).name='changed';
          if(mode==='other-body')s.memos[0].body='changed';
          if(mode==='other-link-missing')s.memoTags=[];
          if(mode==='other-extra-field')s.memos[0].extra=true;
          if(mode==='other-missing-field')delete s.memos[0].body;
          if(mode==='duplicate-tag')s.tags.push({...s.tags[0]});
          if(mode==='extra-memo')s.memos.push({id:'extra',user_id:input.userId});
        }
        for(const key of ['memos','tags','memoTags'])s[key]=s[key].reverse().map(r=>Object.fromEntries(Object.entries(r).reverse()));
        return s;
      }
      if(name==='memo_save_tag'){
        const row={id:input.tagId,user_id:input.userId,name:p.p_name,revision:1,created_at:'2026-10-25T00:00:00Z'};
        state.tags.push(structuredClone(row));return mode==='tag-id'?{...row,id:id(99)}:row;
      }
      if(name==='memo_save'){
        const memo={id:p.p_id,user_id:input.userId,title:p.p_title,body:p.p_body,revision:1,last_request_id:p.p_request_id,pinned_at:null,deleted_at:null,
          created_at:'2026-10-25T00:00:00.123456Z',updated_at:'2026-10-25T00:00:00.123456Z'};
        state.memos.push(structuredClone(memo));state.memoTags.push({user_id:input.userId,memo_id:input.memoId,tag_id:input.tagId});
        if(mode==='duplicate-link')state.memoTags.push({...state.memoTags[1]});
        if(mode==='missing-link')state.memoTags.pop();
        if(mode==='link-owner')state.memoTags[1].user_id='other';
        return {memo:mode==='create-revision'?{...memo,revision:2}:memo,tagIds:mode==='create-tags'?[]:[input.tagId]};
      }
      if(name==='memo_change_state'){
        assert.equal(p.p_action,'trash');assert.equal(p.p_expected_revision,1);
        const m=state.memos.find(r=>r.id===input.memoId),time=mode==='trash-time'?'2026-10-25T00:00:00.123455Z':'2026-10-25T00:00:01.123456Z';
        Object.assign(m,{revision:2,deleted_at:time,updated_at:time,last_request_id:input.trashRequestId});
        return mode==='trash-body'?{...m,body:'changed'}:mode==='trash-request'?{...m,last_request_id:id(99)}:mode==='trash-revision'?{...m,revision:3}:structuredClone(m);
      }
      if(name==='memo_delete_permanently'){
        assert.deepEqual(p,{p_id:input.memoId,p_expected_revision:2});deleted=true;
        if(mode!=='memo-remains')state.memos=state.memos.filter(m=>m.id!==input.memoId);
        if(mode!=='link-remains')state.memoTags=state.memoTags.filter(r=>r.memo_id!==input.memoId);
        return mode==='delete-receipt'?{}:null;
      }
      assert.equal(name,'memo_resolve_request');assert.deepEqual(p,calls.find(c=>c.name==='memo_save').p);
      return mode==='resolve-null'?null:mode==='resolve-saved'?{status:'saved',result:{}}:mode==='resolve-extra'?{status:'previously-applied-deleted',result:{}}:{status:'previously-applied-deleted'};
    }});}catch(e){error=e;}
  return {result,error,calls,confirms,records};
}
test('正常経路・順序非依存・10RPC・4確認・削除1回・元要求再送なし',async()=>{
  const r=await simulate();assert.ifError(r.error);assert.equal(r.calls.length,10);
  assert.deepEqual(r.confirms,['tag','create','trash','delete']);
  assert.equal(r.calls.filter(c=>c.name==='memo_load_snapshot').length,5);
  for(const n of ['memo_save_tag','memo_save','memo_change_state','memo_delete_permanently','memo_resolve_request'])assert.equal(r.calls.filter(c=>c.name===n).length,1);
  assert.equal(r.result.internalResultNull,'not-directly-verified');assert.equal(r.result.tagsRetained,1);
  assert.ok(!JSON.stringify(r.records).includes('private'));
});
for(const mode of ['collision','owner','tag-id','create-revision','create-tags','duplicate-link','missing-link','link-owner','trash-time','trash-body','trash-request','trash-revision',
  'tag-missing','tag-changed','other-body','other-link-missing','other-extra-field','other-missing-field','duplicate-tag','extra-memo','memo-remains','link-remains','delete-receipt','resolve-null','resolve-saved','resolve-extra',
  ...['tag','create','trash','delete'].map(s=>`cancel-${s}`),...['tag','create','trash','delete','resolve'].map(s=>`record-${s}`),...Array.from({length:10},(_,i)=>`fail-${i+1}`)]){
  test(`${mode}: FAIL・即停止・再送/後片付けなし`,async()=>{
    const r=await simulate(mode);assert.ok(r.error);assert.ok(r.calls.length<=10);
    for(const name of ['memo_save_tag','memo_save','memo_change_state','memo_delete_permanently','memo_resolve_request'])assert.ok(r.calls.filter(c=>c.name===name).length<=1);
    if(mode.startsWith('fail-'))assert.equal(r.calls.length,Number(mode.slice(5)));
    if(['memo-remains','link-remains','delete-receipt','tag-changed','tag-missing'].includes(mode))assert.ok(!r.calls.some(c=>c.name==='memo_resolve_request'));
  });
}
const origin='https://yohoppqflnhhvqypwhfv.supabase.co';
for(const mode of ['void','wrong200','wrong409','void-body','fetch','timeout','body','json','json-ok']){
  test(`通信判定 ${mode}`,async()=>{
    let count=0;const rpc=permanentDeleteRpc(origin,'sb_publishable_mock','private-token',async(url,o)=>{
      count++;assert.equal(o.method,'POST');assert.equal(o.redirect,'error');assert.ok(o.signal instanceof AbortSignal);
      assert.equal(o.headers.Authorization,'Bearer private-token');assert.equal(o.headers.apikey,'sb_publishable_mock');
      assert.equal(new URL(url).origin,origin);
      if(mode==='fetch')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
      return {status:mode==='wrong409'?409:mode==='wrong200'||mode.startsWith('json')?200:204,body:{cancel:async()=>{}},text:async()=>{
        if(mode==='body')throw new Error('private');return mode==='json'?'private':mode==='json-ok'?'{}':mode==='void-body'?'null':'';}};
    });
    const act=()=>rpc(mode.startsWith('json')?'memo_load_snapshot':'memo_delete_permanently',{});
    if(mode==='void')assert.equal(await act(),null);else if(mode==='json-ok')assert.deepEqual(await act(),{});else await assert.rejects(act());
    assert.equal(count,1);
  });
}
for(const [host,key,name] of [['https://production.invalid','sb_publishable_mock','memo_save'],[origin,'service_role','memo_save'],[origin,'sb_publishable_mock','memo_empty_trash']])test('接続先・キー・経路制限で通信前停止',async()=>{
  let count=0;const rpc=permanentDeleteRpc(host,key,'token',async()=>{count++;});await assert.rejects(rpc(name,{}));assert.equal(count,0);
});
