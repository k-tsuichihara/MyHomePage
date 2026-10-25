import test from 'node:test';
import assert from 'node:assert/strict';
import {runInvalidStateCase,REJECTION_NAMES,INVALID_CASES,invalidStateResponse} from './invalid-state-contract.mjs';
import './invalid-state-read.mjs';
globalThis.fetch=()=>{throw new Error('network forbidden');};
async function simulate(mode='') {
  const base={p_id:'dedicated',p_request_id:'create',p_expected_revision:null,p_title:'private title',p_body:'private body',p_tag_ids:[]};
  const rejectionIds=Object.fromEntries(REJECTION_NAMES.map((n)=>[n,`request-${n}`]));
  const state={memos:[{id:'existing',body:'private existing'}],tags:[{id:'tag'}],memoTags:[]};
  const calls=[],confirmations=[],records=[];
  let saved,result,error,attempts=0;
  try {
    result=await runInvalidStateCase({base,trashRequestId:'trash',rejectionIds,userId:'user',
      confirm:async(name)=>{confirmations.push(name);return mode!==`cancel-${name}`;},
      progress:async(name,detail)=>{records.push({name,...detail});if(mode===`record-${name}`)throw new Error('mock');},
      rpc:async(name,payload)=>{
        calls.push({name,payload:structuredClone(payload)});
        if(name==='memo_load_snapshot')return structuredClone(state);
        if(name==='memo_resolve_request') {
          assert.deepEqual(payload,base);return mode==='resolve'?null:{status:'saved',result:structuredClone(saved)};
        }
        if(name==='memo_save') {
          saved={memo:{id:'dedicated',user_id:'user',title:base.p_title,body:base.p_body,revision:1,
            last_request_id:'create',created_at:'2026-10-16T00:00:00Z',updated_at:'2026-10-16T00:00:00Z',pinned_at:null,deleted_at:null},tagIds:[]};
          state.memos.push(structuredClone(saved.memo));return structuredClone(saved);
        }
        assert.equal(name,'memo_change_state');
        assert.deepEqual(payload,{p_id:'dedicated',p_expected_revision:1,p_request_id:'trash',p_action:'trash'});
        state.memos[1]={...saved.memo,revision:2,last_request_id:'trash',updated_at:'2026-10-16T00:00:01Z',deleted_at:'2026-10-16T00:00:01Z'};
        if(mode==='prepare-wrong')state.memos[1].pinned_at='2026-10-16T00:00:01Z';
        return structuredClone(state.memos[1]);
      },
      reject:async(payload)=>{
        calls.push({name:'memo_change_state',payload:structuredClone(payload)});
        const name=REJECTION_NAMES[attempts++];
        const definition=INVALID_CASES.find((c)=>c.name===name);
        const expected={p_id:'dedicated',p_expected_revision:attempts<=10?1:2,p_request_id:rejectionIds[name],p_action:'pin',
          ...(definition?.overrides??{p_action:name==='restore-normal'?'restore':name.split('-')[0]})};
        assert.deepEqual(payload,expected);
        if(mode==='network')throw new TypeError('private');
        if(mode==='timeout')throw new DOMException('private','TimeoutError');
        const changes={revision:['revision',99],date:['updated_at','2026-10-16T00:00:02Z'],request:['last_request_id','wrong'],
          state:['deleted_at','2026-10-16T00:00:02Z'],body:['body','changed']};
        if(changes[mode])state.memos[1][changes[mode][0]]=changes[mode][1];
        if(mode==='other')state.memos[0].body='changed';
        if(mode==='tag')state.tags.push({id:'unexpected'});
        if(mode==='relation')state.memoTags.push({memo_id:'dedicated',tag_id:'tag'});
        return {status:mode==='success'?200:mode==='http'?409:400,code:mode==='code'?'PT409':'22023',
          message:mode==='message'?'wrong':definition?'invalid argument':'invalid memo state'};
      },
    });
  }catch(e){error=e;}
  return {result,error,calls,confirmations,records,attempts};
}
test('13拒否の全引数・32 RPC・確認15回・作成要求のみ照合',async()=>{
  const r=await simulate();assert.ifError(r.error);assert.equal(r.calls.length,32);assert.equal(r.confirmations.length,15);
  assert.equal(r.attempts,13);assert.equal(r.calls.filter((c)=>c.name==='memo_load_snapshot').length,16);
  assert.equal(r.result.rejectionsVerified,13);assert.equal(r.result.revision,2);assert.equal(r.result.deleted,true);
  assert.ok(!JSON.stringify(r.records).includes('private'));
});
for(const mode of ['success','http','code','message','revision','date','request','state','body','other','tag','relation',
  'network','timeout','resolve','prepare-wrong','cancel-create','cancel-action-null','cancel-prepare-trash','record-create','record-action-null','record-prepare-trash']) {
  test(`${mode}停止・自動再送なし`,async()=>{
    const r=await simulate(mode);assert.ok(r.error);assert.ok(r.calls.length<=32);
    assert.ok(r.calls.filter((c)=>c.name==='memo_save').length<=1);
    for(const id of new Set(r.calls.filter((c)=>c.name==='memo_change_state').map((c)=>c.payload.p_request_id))) {
      assert.equal(r.calls.filter((c)=>c.name==='memo_change_state'&&c.payload.p_request_id===id).length,1);
    }
    if(['success','http','code','message','revision','network','timeout'].includes(mode))assert.equal(r.attempts,1);
    if(mode==='cancel-create')assert.equal(r.calls.length,1);
  });
}
for(const mode of ['argument','state','http-success','http409','code','message','json','timeout','network']) {
  test(`拒否通信 ${mode}（実通信なし）`,async()=>{
    let count=0;
    const action=()=>invalidStateResponse('https://invalid.example',{}, {p_action:null},async(_url,options)=>{
      count++;assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
      assert.deepEqual(JSON.parse(options.body),{p_action:null});
      if(mode==='timeout')throw new DOMException('private','TimeoutError');
      if(mode==='network')throw new TypeError('private');
      return {status:mode==='http-success'?200:mode==='http409'?409:400,json:async()=>{
        if(mode==='json')throw new SyntaxError('private');
        return {code:mode==='code'?'private':'22023',message:mode==='message'?'private':mode==='state'?'invalid memo state':'invalid argument'};
      }};
    });
    if(['http-success','http409','json','timeout','network'].includes(mode))await assert.rejects(action());
    else {
      const r=await action();assert.equal(r.code,mode==='code'?null:'22023');
      assert.equal(r.message,mode==='message'?null:mode==='state'?'invalid memo state':'invalid argument');
      assert.ok(!JSON.stringify(r).includes('private'));
    }
    assert.equal(count,1);
  });
}
