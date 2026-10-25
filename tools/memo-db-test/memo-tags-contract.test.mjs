import test from 'node:test';
import assert from 'node:assert/strict';
import {runMemoTagsCase,memoTagsRpc,memoTagNames} from './memo-tags-contract.mjs';
import './memo-tags-read.mjs';
globalThis.fetch=()=>{throw new Error('network forbidden');};
async function simulate(mode=''){
  const base={p_id:'memo',p_request_id:'create',p_expected_revision:null,p_title:'private title',p_body:'private body',p_tag_ids:['a']};
  const state={memos:[{id:'old',body:'private existing'}],tags:[{id:'old-tag',name:'existing'}],memoTags:[]};

  if(mode==='order-only'){
    if(!state.memos.length)state.memos.push({id:'old',user_id:'u',deleted_at:null,body:'existing'});
    if(!state.tags.length)state.tags.push({id:'old-tag',user_id:'u',name:'existing'});
    state.memoTags.push({user_id:'u',memo_id:'old',tag_id:'old-tag'});
  }
  const names=memoTagNames('01234567-89ab-4cde-8fab-0123456789ab');
  if(mode==='collision')state.tags[0].name=names[0].toLowerCase();
  const calls=[],confirmations=[],records=[],receipts=new Map();let result,error;
  try{
    result=await runMemoTagsCase({base,updateRequestId:'update',tagIds:['a','b'],tagNames:names,userId:'u',
      confirm:async(action)=>{confirmations.push(action);return mode!==`cancel-${action}`;},
      progress:async(action,detail)=>{records.push({action,...detail});if(mode===`record-${action}`)throw new Error('mock');},
      rpc:async(name,payload)=>{
        calls.push({name,payload:structuredClone(payload)});
        if(name==='memo_load_snapshot'){
          const s=structuredClone(state);
          if(s.memos[1]?.revision===2){
            if(mode==='other')s.memos[0].body='changed';if(mode==='tag-master')s.tags[1].revision=2;
            if(mode==='missing-link')s.memoTags=[];
            if(mode==='old-link')s.memoTags.push({user_id:'u',memo_id:'memo',tag_id:'a'});
            if(mode==='wrong-owner')s.memoTags[0].user_id='other';
            if(mode==='snapshot-body')s.memos[1].body='wrong';
          }
          if(mode==='order-only')for(const k of ['memos','tags','memoTags'])s[k]=s[k].reverse().map(row=>Object.fromEntries(Object.entries(row).reverse()));
          return s;
        }
        if(name==='memo_save_tag'){
          const row={id:payload.p_id,user_id:'u',name:payload.p_name,revision:1,created_at:'2026-10-20T00:00:00Z'};
          state.tags.push(structuredClone(row));return row;
        }
        if(name==='memo_resolve_request'){
          assert.deepEqual(payload,receipts.get(payload.p_request_id).payload);
          return mode==='resolve'?null:{status:'saved',result:structuredClone(receipts.get(payload.p_request_id).result)};
        }
        assert.equal(name,'memo_save');const update=payload.p_request_id==='update';
        if(update){
          assert.equal(payload.p_expected_revision,1);assert.notEqual(payload.p_body,base.p_body);assert.deepEqual(payload.p_tag_ids,['b']);
          if(mode==='network')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
        }
        const m=update?{...state.memos[1],body:payload.p_body,revision:2,last_request_id:'update',updated_at:'2026-10-20T00:00:00.000001Z'}
          :{id:'memo',user_id:'u',title:payload.p_title,body:payload.p_body,revision:1,last_request_id:'create',pinned_at:null,deleted_at:null,created_at:'2026-10-20T00:00:00Z',updated_at:'2026-10-20T00:00:00Z'};
        if(update){
          if(mode==='body')m.body=base.p_body;if(mode==='revision')m.revision=3;if(mode==='title')m.title='wrong';
          if(mode==='date')m.created_at=m.updated_at;if(mode==='request')m.last_request_id='wrong';
          if(mode==='pinned')m.pinned_at=m.updated_at;
          state.memos[1]=structuredClone(m);
        }else state.memos.push(structuredClone(m));
        state.memoTags=[...state.memoTags.filter(r=>r.memo_id!=='memo'),{user_id:'u',memo_id:'memo',tag_id:update?'b':'a'}];
        const saved={memo:m,tagIds:mode==='response-tags'&&update?['a']:payload.p_tag_ids};
        receipts.set(payload.p_request_id,{payload:structuredClone(payload),result:structuredClone(saved)});return saved;
      }});
  }catch(e){error=e;}
  return {result,error,calls,confirmations,records};
}
test('本文更新・revision2・タグA解除/B追加・要求照合：11 RPC/確認4回',async()=>{
  const r=await simulate();assert.ifError(r.error);assert.equal(r.calls.length,11);
  assert.deepEqual(r.confirmations,['tag-a','tag-b','create','update']);
  assert.equal(r.calls.filter((c)=>c.name==='memo_save').length,2);assert.equal(r.calls.filter((c)=>c.name==='memo_load_snapshot').length,5);
  assert.equal(r.result.oldTagRemoved,true);assert.equal(r.result.saveRequestsResolved,true);
  assert.ok(!JSON.stringify(r.records).includes('private'));assert.ok(!JSON.stringify(r.records).includes('T15'));
});
for(const mode of ['collision','other','tag-master','missing-link','old-link','wrong-owner','snapshot-body','body','revision','title','date','request','pinned',
  'response-tags','resolve','network','timeout','cancel-tag-a','cancel-tag-b','cancel-create','cancel-update',
  'record-tag-a','record-create','record-update']){
  test(`${mode}停止・再送なし`,async()=>{
    const r=await simulate(mode);assert.ok(r.error);assert.ok(r.calls.length<=11);
    assert.ok(r.calls.filter((c)=>c.name==='memo_save').length<=2);assert.ok(r.calls.filter((c)=>c.name==='memo_save_tag').length<=2);
    if(mode==='cancel-update')assert.equal(r.calls.filter((c)=>c.name==='memo_save').length,1);
    if(mode==='record-tag-a')assert.equal(r.calls.filter((c)=>c.name==='memo_save_tag').length,1);
    if(mode==='record-create')assert.equal(r.calls.filter((c)=>c.name==='memo_save').length,1);
    if(['network','timeout'].includes(mode))assert.ok(!r.calls.some((c)=>c.name==='memo_resolve_request'));
  });
}
for(const mode of ['ok','http','network','timeout','json']){
  test(`通信 ${mode}（ネットワークなし）`,async()=>{
    let count=0;const rpc=memoTagsRpc('https://invalid.example',{},async(_url,options)=>{
      count++;assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
      if(mode==='network')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
      return {status:mode==='http'?409:200,json:async()=>{if(mode==='json')throw new SyntaxError('private');return {dummy:true};}};
    });
    if(mode==='ok')assert.deepEqual(await rpc('memo_save',{}),{dummy:true});else await assert.rejects(rpc('memo_save',{}));
    assert.equal(count,1);await assert.rejects(rpc('memo_delete_tag',{}));assert.equal(count,1);
  });
}

test('既存関連あり・全snapshotのキー順/配列順だけが異なっても完走',async()=>{
  const r=await simulate('order-only');assert.ifError(r.error);assert.ok(r.result);
});
