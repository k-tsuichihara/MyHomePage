import test from 'node:test';
import assert from 'node:assert/strict';
import {runTrashEditCase,trashEditResponse} from './trash-edit-contract.mjs';
import './trash-edit-read.mjs';
globalThis.fetch=()=>{throw new Error('network forbidden');};
async function simulate(mode='') {
  const base={p_id:'dedicated',p_request_id:'create',p_expected_revision:null,p_title:'private title',p_body:'private body',p_tag_ids:[]};
  const state={memos:[{id:'existing',body:'private existing'}],tags:[{id:'tag'}],memoTags:[]};
  const calls=[],confirmations=[],records=[];
  let saved,rejected=false,editPayload,result,error;
  try {
    result=await runTrashEditCase({base,trashRequestId:'trash',editRequestId:'edit',userId:'user',
      confirm:async(action)=>{confirmations.push(action);return mode!==`cancel-${action}`;},
      progress:async(action,detail)=>{records.push({action,...detail});if(mode===`record-${action}`)throw new Error('mock');},
      rpc:async(name,payload)=>{
        calls.push({name,payload:structuredClone(payload)});
        if(name==='memo_load_snapshot') {
          if(rejected&&mode==='read-failure')throw new Error('mock');
          const s=structuredClone(state);
          if(!rejected&&mode==='stale-baseline'&&s.memos[1]?.deleted_at) s.memos[1].revision=3;
          return s;
        }
        if(name==='memo_save') {
          saved={memo:{id:'dedicated',user_id:'user',title:base.p_title,body:base.p_body,revision:1,last_request_id:'create',
            created_at:'2026-10-16T00:00:00Z',updated_at:'2026-10-16T00:00:00Z',pinned_at:null,deleted_at:null},tagIds:[]};
          state.memos.push(structuredClone(saved.memo));return structuredClone(saved);
        }
        if(name==='memo_change_state') {
          assert.deepEqual(payload,{p_id:'dedicated',p_expected_revision:1,p_request_id:'trash',p_action:'trash'});
          state.memos[1]={...saved.memo,revision:2,last_request_id:'trash',updated_at:'2026-10-16T00:00:01Z',deleted_at:'2026-10-16T00:00:01Z'};
          return structuredClone(state.memos[1]);
        }
        assert.equal(name,'memo_resolve_request');
        if(payload.p_request_id==='create') {
          assert.deepEqual(payload,base);return mode==='creation-resolve'?null:{status:'saved',result:structuredClone(saved)};
        }
        assert.deepEqual(payload,editPayload);
        return mode==='rejected-resolve'?{status:'saved',result:saved}:null;
      },
      rejectEdit:async(payload)=>{
        calls.push({name:'memo_save',payload:structuredClone(payload)});editPayload=structuredClone(payload);
        assert.equal(payload.p_expected_revision,2);assert.equal(payload.p_id,'dedicated');assert.equal(payload.p_request_id,'edit');
        assert.notEqual(payload.p_title,base.p_title);assert.notEqual(payload.p_body,base.p_body);assert.deepEqual(payload.p_tag_ids,[]);
        assert.equal(state.memos[1].revision,2);assert.notEqual(state.memos[1].deleted_at,null);
        if(mode==='network')throw new TypeError('private');
        if(mode==='timeout')throw new DOMException('private','TimeoutError');
        rejected=true;
        const changes={revision:['revision',3],date:['updated_at','2026-10-16T00:00:02Z'],request:['last_request_id','edit'],
          deleted:['deleted_at',null],pinned:['pinned_at','2026-10-16T00:00:02Z'],title:['title',payload.p_title],body:['body',payload.p_body]};
        if(changes[mode])state.memos[1][changes[mode][0]]=changes[mode][1];
        if(mode==='other')state.memos[0].body='changed';
        if(mode==='tag')state.tags.push({id:'unexpected'});
        if(mode==='relation')state.memoTags.push({memo_id:'dedicated',tag_id:'tag'});
        return {status:mode==='success'?200:mode==='http'?400:409,codeMatches:mode!=='old40001',messageMatches:mode!=='state-message'};
      },
    });
  }catch(e){error=e;}
  return {result,error,calls,confirmations,records};
}
test('最新revision=2で編集拒否、9 RPC・確認3回・拒否要求照合null',async()=>{
  const r=await simulate();assert.ifError(r.error);assert.equal(r.calls.length,9);
  assert.deepEqual(r.confirmations,['create','trash','edit']);
  assert.equal(r.calls.filter((v)=>v.name==='memo_save').length,2);
  assert.equal(r.calls.filter((v)=>v.name==='memo_load_snapshot').length,4);
  assert.equal(r.calls.filter((v)=>v.name==='memo_resolve_request').length,2);
  assert.equal(r.result.revision,2);assert.equal(r.result.rejectedSaveResolution,'null-not-proof-of-non-execution');
  assert.ok(!JSON.stringify(r.records).includes('private'));
});
for(const mode of ['stale-baseline','success','http','old40001','state-message','revision','date','request','deleted','pinned',
  'title','body','other','tag','relation','network','timeout','read-failure','creation-resolve','rejected-resolve',
  'cancel-create','cancel-trash','cancel-edit','record-create','record-trash','record-edit']) {
  test(`${mode}停止・再送なし`,async()=>{
    const r=await simulate(mode);assert.ok(r.error);assert.ok(r.calls.length<=9);
    for(const id of ['create','trash','edit'])assert.ok(r.calls.filter((v)=>['memo_save','memo_change_state'].includes(v.name)&&v.payload.p_request_id===id).length<=1);
    if(['stale-baseline','cancel-edit','record-trash','creation-resolve'].includes(mode))assert.ok(!r.calls.some((v)=>v.name==='memo_save'&&v.payload.p_request_id==='edit'));
    if(['timeout','network','success','http'].includes(mode))assert.ok(!r.calls.some((v)=>v.name==='memo_resolve_request'&&v.payload.p_request_id==='edit'));
    if(mode==='cancel-create')assert.equal(r.calls.length,1);
  });
}
for(const mode of ['ok','success','http','old40001','message','network','timeout','json']) {
  test(`保存拒否HTTP ${mode}（実通信なし）`,async()=>{
    let calls=0;
    const action=()=>trashEditResponse('https://invalid.example',{}, {p_expected_revision:2},async(_url,options)=>{
      calls++;assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
      assert.deepEqual(JSON.parse(options.body),{p_expected_revision:2});
      if(mode==='network')throw new TypeError('private');
      if(mode==='timeout')throw new DOMException('private','TimeoutError');
      return {status:mode==='success'?200:mode==='http'?400:409,json:async()=>{
        if(mode==='json')throw new SyntaxError('private');
        return {code:mode==='old40001'?'40001':'PT409',message:mode==='message'?'revision conflict':'memo revision conflict'};
      }};
    });
    if(['success','http','network','timeout','json'].includes(mode))await assert.rejects(action());
    else {const r=await action();assert.equal(r.codeMatches,mode!=='old40001');assert.equal(r.messageMatches,mode!=='message');}
    assert.equal(calls,1);
  });
}
