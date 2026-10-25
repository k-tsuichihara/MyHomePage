import test from 'node:test';
import assert from 'node:assert/strict';
import {runTagDeletedReplayCase} from './tag-deleted-replay-contract.mjs';
import {tagDeleteRpc} from './tag-delete-contract.mjs';
import './tag-deleted-replay-read.mjs';
globalThis.fetch=()=>{throw new Error('network forbidden');};
async function simulate(mode=''){
  const base={p_id:'memo',p_request_id:'create',p_expected_revision:null,p_title:'private title',p_body:'private body',p_tag_ids:['tag']};
  const state={memos:[{id:'existing',body:'private existing'}],tags:[{id:'existing-tag',name:'existing'}],
    memoTags:[{tag_id:'existing-tag',memo_id:'existing',user_id:'u'}]};
  const calls=[],confirmations=[],records=[];let saved,frozen,result,error,saveCalls=0,replayed=false;
  try{
    result=await runTagDeletedReplayCase({base,tagId:'tag',tagName:'T19A-dummy',userId:'u',
      confirm:async(action)=>{confirmations.push(action);return mode!==`cancel-${action}`;},
      progress:async(action,detail)=>{records.push({action,...detail});if(mode===`record-${action}`)throw new Error('mock');},
      rpc:async(name,payload)=>{
        calls.push({name,payload:structuredClone(payload)});
        if(name==='memo_load_snapshot'){
          const s=structuredClone(state);
          if(replayed){
            if(mode==='other-memo')s.memos[0].body='changed';if(mode==='other-tag')s.tags[0].name='changed';
            if(mode==='missing-existing-link')s.memoTags=s.memoTags.filter((r)=>r.memo_id!=='existing');
            if(mode==='duplicate-existing-link')s.memoTags.push({...s.memoTags[0]});
          }
          for(const k of ['memos','tags','memoTags'])s[k]=s[k].reverse().map((r)=>Object.fromEntries(Object.entries(r).reverse()));
          return s;
        }
        if(name==='memo_save_tag'){
          const row={id:'tag',user_id:'u',name:payload.p_name,revision:1,created_at:'2026-10-25T00:00:00Z'};state.tags.push(structuredClone(row));return row;
        }
        if(name==='memo_save'){
          saveCalls++;
          if(saveCalls===1){
            assert.deepEqual(payload,base);frozen=JSON.stringify(payload);
            saved={memo:{id:'memo',user_id:'u',title:payload.p_title,body:payload.p_body,revision:1,last_request_id:'create',pinned_at:null,deleted_at:null,
              created_at:'2026-10-25T00:00:00Z',updated_at:'2026-10-25T00:00:00Z'},tagIds:['tag']};
            state.memos.push(structuredClone(saved.memo));state.memoTags.push({user_id:'u',memo_id:'memo',tag_id:'tag'});return structuredClone(saved);
          }
          assert.equal(JSON.stringify(payload),frozen);assert.equal(payload.p_expected_revision,null);
          assert.ok(!state.tags.some((t)=>t.id==='tag'));assert.equal(state.memos[1].revision,2);assert.equal(state.memos[1].last_request_id,null);
          if(mode==='network')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
          if(mode==='unknown-tag')throw new Error('mock unknown tag');if(mode==='revision-conflict')throw new Error('mock conflict');
          replayed=true;
          const response=structuredClone(saved);
          if(mode==='current-response')return {memo:structuredClone(state.memos[1]),tagIds:[]};
          if(mode==='response-request')response.memo.last_request_id='wrong';if(mode==='response-tags')response.tagIds=[];
          if(mode==='response-date')response.memo.updated_at='2026-10-25T00:00:03Z';
          if(mode==='body-change')state.memos[1].body='changed';if(mode==='revision-change')state.memos[1].revision=3;
          if(mode==='request-change')state.memos[1].last_request_id='create';
          if(mode==='tag-revival')state.tags.push({id:'tag',user_id:'u',name:'private revived',revision:1});
          if(mode==='link-revival')state.memoTags.push({user_id:'u',memo_id:'memo',tag_id:'tag'});
          return response;
        }
        if(name==='memo_delete_tag'){
          assert.deepEqual(payload,{p_id:'tag',p_expected_revision:1});
          state.tags=state.tags.filter((t)=>t.id!=='tag');state.memoTags=state.memoTags.filter((r)=>r.tag_id!=='tag');
          state.memos[1]={...state.memos[1],revision:2,updated_at:'2026-10-25T00:00:01Z',last_request_id:null};
          if(mode==='delete-revision')state.memos[1].revision=1;
          if(mode==='delete-request')state.memos[1].last_request_id='create';
          return null;
        }
        assert.equal(name,'memo_resolve_request');assert.equal(JSON.stringify(payload),frozen);
        return mode==='resolve'?null:{status:'saved',result:structuredClone(saved)};
      }});
  }catch(e){error=e;}
  return {result,error,calls,confirmations,records,saveCalls};
}
test('履歴revision1を返すが現行revision2/タグ不在を維持、10RPC/4確認',async()=>{
  const r=await simulate();assert.ifError(r.error);assert.equal(r.calls.length,10);assert.equal(r.saveCalls,2);
  assert.deepEqual(r.confirmations,['tag','create','delete-tag','replay']);assert.equal(r.result.currentRevision,2);
  assert.equal(r.calls.filter((c)=>c.name==='memo_load_snapshot').length,5);
  assert.ok(!JSON.stringify(r.records).includes('private'));
});
for(const mode of ['current-response','response-request','response-tags','response-date','body-change','revision-change','request-change',
  'tag-revival','link-revival','other-memo','other-tag','missing-existing-link','duplicate-existing-link','network','timeout','unknown-tag',
  'revision-conflict','delete-revision','delete-request','resolve','cancel-tag','cancel-create','cancel-delete-tag','cancel-replay',
  'record-tag','record-create','record-delete-tag','record-replay']){
  test(`${mode}で停止・自動再送なし`,async()=>{
    const r=await simulate(mode);assert.ok(r.error);assert.ok(r.calls.length<=10);assert.ok(r.saveCalls<=2);
    assert.ok(r.calls.filter((c)=>c.name==='memo_delete_tag').length<=1);
    if(['record-delete-tag','delete-revision','delete-request','cancel-replay'].includes(mode))assert.equal(r.saveCalls,1);
    if(['network','timeout','unknown-tag','revision-conflict'].includes(mode))assert.ok(!r.calls.some((c)=>c.name==='memo_resolve_request'));
    if(mode==='cancel-tag')assert.equal(r.calls.length,1);
  });
}
for(const mode of ['ok','http','network','timeout','json']){
  test(`再利用通信 ${mode}（実通信なし）`,async()=>{
    let count=0;const rpc=tagDeleteRpc('https://yohoppqflnhhvqypwhfv.supabase.co',{},async(url,options)=>{
      count++;assert.ok(url.endsWith('/rpc/memo_save'));assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
      if(mode==='network')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
      return {status:mode==='http'?409:200,text:async()=>mode==='json'?'private-invalid-json':'{}'};
    });
    if(mode==='ok')assert.deepEqual(await rpc('memo_save',{}),{});else await assert.rejects(rpc('memo_save',{}));assert.equal(count,1);
  });
}
