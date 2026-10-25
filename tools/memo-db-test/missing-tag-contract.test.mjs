import test from 'node:test';
import assert from 'node:assert/strict';
import {runMissingTagCase,missingTagResponse} from './missing-tag-contract.mjs';
import './missing-tag-read.mjs';
globalThis.fetch=()=>{throw new Error('network forbidden');};
async function simulate(mode=''){
  const base={p_id:'memo',p_request_id:'create',p_expected_revision:null,p_title:'private title',p_body:'private body',p_tag_ids:['tag']};
  const state={memos:[{id:'old',body:'private existing'}],tags:[{id:'old-tag',name:'existing'}],memoTags:[]};
  if(mode==='missing-id-exists')state.tags.push({id:'missing',name:'existing-missing'});
  const calls=[],confirmations=[],records=[];let saved,submitted,result,error,rejected=false;
  try{
    result=await runMissingTagCase({base,updateRequestId:'update',tagId:'tag',missingTagId:'missing',tagName:'T16A-dummy',userId:'u',
      confirm:async(action)=>{confirmations.push(action);return mode!==`cancel-${action}`;},
      progress:async(action,detail)=>{records.push({action,...detail});if(mode===`record-${action}`)throw new Error('mock');},
      rpc:async(name,payload)=>{
        calls.push({name,payload:structuredClone(payload)});
        if(name==='memo_load_snapshot'){
          if(rejected&&mode==='read-failure')throw new Error('mock');return structuredClone(state);
        }
        if(name==='memo_save_tag'){
          const tag={id:'tag',name:payload.p_name,user_id:'u',revision:1,created_at:'2026-10-20T00:00:00Z'};
          state.tags.push(structuredClone(tag));return tag;
        }
        if(name==='memo_save'){
          assert.deepEqual(payload,base);
          saved={memo:{id:'memo',user_id:'u',title:base.p_title,body:base.p_body,revision:1,last_request_id:'create',
            created_at:'2026-10-20T00:00:00Z',updated_at:'2026-10-20T00:00:00Z',pinned_at:null,deleted_at:null},tagIds:['tag']};
          state.memos.push(structuredClone(saved.memo));state.memoTags.push({user_id:'u',memo_id:'memo',tag_id:'tag'});return structuredClone(saved);
        }
        assert.equal(name,'memo_resolve_request');
        if(payload.p_request_id==='create'){assert.deepEqual(payload,base);return mode==='create-resolve'?null:{status:'saved',result:structuredClone(saved)};}
        assert.deepEqual(payload,submitted);return mode==='reject-resolve'?{status:'saved',result:saved}:null;
      },
      rejectSave:async(payload)=>{
        calls.push({name:'memo_save',payload:structuredClone(payload)});submitted=structuredClone(payload);
        assert.equal(payload.p_expected_revision,1);assert.equal(payload.p_request_id,'update');assert.equal(payload.p_id,'memo');
        assert.notEqual(payload.p_body,base.p_body);assert.equal(payload.p_title,base.p_title);assert.deepEqual(payload.p_tag_ids,['missing']);
        assert.ok(!state.tags.some((t)=>t.id==='missing'));
        if(mode==='network')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');rejected=true;
        const changes={body:['body',payload.p_body],revision:['revision',2],date:['updated_at','2026-10-20T00:00:01Z'],
          request:['last_request_id','update'],title:['title','changed'],state:['deleted_at','2026-10-20T00:00:01Z']};
        if(changes[mode])state.memos[1][changes[mode][0]]=changes[mode][1];
        if(mode==='link-removed')state.memoTags=[];
        if(mode==='link-added')state.memoTags.push({user_id:'u',memo_id:'memo',tag_id:'missing'});
        if(mode==='other')state.memos[0].body='changed';if(mode==='tag-master')state.tags[1].revision=2;
        return {status:mode==='success'?200:mode==='http'?409:400,codeMatches:mode!=='code',messageMatches:mode!=='message'};
      }});
  }catch(e){error=e;}
  return {result,error,calls,confirmations,records};
}
test('unknown tag拒否・全データ不変・9 RPC/確認3回',async()=>{
  const r=await simulate();assert.ifError(r.error);assert.equal(r.calls.length,9);
  assert.deepEqual(r.confirmations,['tag','create','reject-update']);assert.equal(r.result.revision,1);
  assert.equal(r.calls.filter((c)=>c.name==='memo_save').length,2);assert.equal(r.calls.filter((c)=>c.name==='memo_load_snapshot').length,4);
  assert.equal(r.result.linkedTagCount,1);assert.ok(!JSON.stringify(r.records).includes('private'));
});
for(const mode of ['missing-id-exists','success','http','code','message','body','revision','date','request','title','state',
  'link-removed','link-added','other','tag-master','network','timeout','read-failure','create-resolve','reject-resolve',
  'cancel-tag','cancel-create','cancel-reject-update','record-tag','record-create','record-reject-update']){
  test(`${mode}停止・自動再送なし`,async()=>{
    const r=await simulate(mode);assert.ok(r.error);assert.ok(r.calls.length<=9);
    assert.ok(r.calls.filter((c)=>c.name==='memo_save_tag').length<=1);
    for(const id of ['create','update'])assert.ok(r.calls.filter((c)=>c.name==='memo_save'&&c.payload.p_request_id===id).length<=1);
    if(['timeout','network','http','success','body','link-removed'].includes(mode))assert.ok(!r.calls.some((c)=>c.name==='memo_resolve_request'));
    if(['cancel-tag','missing-id-exists'].includes(mode))assert.equal(r.calls.length,1);
  });
}
for(const mode of ['ok','success','http','code','message','network','timeout','json']){
  test(`拒否HTTP ${mode}（ネットワークなし）`,async()=>{
    let count=0;const action=()=>missingTagResponse('https://invalid.example',{}, {p_tag_ids:['missing']},async(_url,options)=>{
      count++;assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
      assert.deepEqual(JSON.parse(options.body),{p_tag_ids:['missing']});
      if(mode==='network')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
      return {status:mode==='success'?200:mode==='http'?409:400,json:async()=>{
        if(mode==='json')throw new SyntaxError('private');
        return {code:mode==='code'?'PT409':'22023',message:mode==='message'?'memo revision conflict':'unknown tag'};
      }};
    });
    if(['success','http','network','timeout','json'].includes(mode))await assert.rejects(action());
    else{const r=await action();assert.equal(r.codeMatches,mode!=='code');assert.equal(r.messageMatches,mode!=='message');}
    assert.equal(count,1);
  });
}
