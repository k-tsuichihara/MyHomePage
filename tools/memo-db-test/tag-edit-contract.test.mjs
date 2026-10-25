import test from 'node:test';
import assert from 'node:assert/strict';
import {runTagEditCase,tagRpc,tagNames} from './tag-edit-contract.mjs';
import './tag-edit-read.mjs';
globalThis.fetch=()=>{throw new Error('network forbidden');};
async function simulate(mode='') {
  const names=tagNames('01234567-89ab-4cde-8fab-0123456789ab');
  const state={memos:[{id:'existing',body:'private'}],tags:[{id:'existing-tag',name:'existing'}],memoTags:[]};
  const calls=[],confirmations=[],records=[];let initial,result,error,reads=0;
  if(mode==='name-collision')state.tags[0].name=names[0].toLowerCase();
  try {
    result=await runTagEditCase({tagId:'dedicated',names,userId:'user',
      confirm:async(action)=>{confirmations.push(action);return mode!==`cancel-${action}`;},
      progress:async(action,detail)=>{records.push({action,...detail});if(mode===`record-${action}`)throw new Error('mock');},
      rpc:async(name,payload,rejection)=>{
        calls.push({name,payload:structuredClone(payload),rejection});
        if(name==='memo_load_snapshot') {
          reads++;if(mode==='read-failure'&&reads===3)throw new Error('mock');
          const s=structuredClone(state);
          if(reads===4) {
            if(mode==='changed')s.tags[1].revision=3;
            if(mode==='other-tag')s.tags[0].name='changed';
            if(mode==='memo')s.memos[0].body='changed';
            if(mode==='relation')s.memoTags.push({memo_id:'existing',tag_id:'dedicated'});
          }
          return s;
        }
        assert.equal(name,'memo_save_tag');assert.equal(payload.p_id,'dedicated');
        if(payload.p_expected_revision===null) {
          assert.equal(payload.p_name,names[0]);
          initial={id:'dedicated',user_id:'user',name:names[0],revision:1,created_at:'2026-10-16T00:00:00Z'};
          if(mode==='create-id')initial.id='wrong';if(mode==='create-name')initial.name='wrong';
          if(mode==='owner')initial.user_id='other';
          state.tags.push(structuredClone(initial));return structuredClone(initial);
        }
        assert.equal(payload.p_expected_revision,1);
        if(!rejection) {
          assert.equal(payload.p_name,names[1]);
          const row={...initial,name:names[1],revision:2};
          if(mode==='rename-id')row.id='wrong';if(mode==='rename-name')row.name='wrong';
          if(mode==='revision')row.revision=3;if(mode==='date')row.created_at='2026-10-16T00:00:01Z';
          state.tags[1]=structuredClone(row);return row;
        }
        assert.equal(payload.p_name,names[2]);
        if(mode==='network')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
        return {status:mode==='success'?200:mode==='http'?400:409,codeMatches:mode!=='code',messageMatches:mode!=='message'};
      }});
  }catch(e){error=e;}
  return {result,error,calls,confirmations,records};
}
test('作成・名前変更・古いrevision競合、7 RPC・確認3回',async()=>{
  const r=await simulate();assert.ifError(r.error);assert.equal(r.calls.length,7);
  assert.deepEqual(r.confirmations,['create','rename','conflict']);assert.equal(r.result.revision,2);
  assert.ok(!JSON.stringify(r.records).includes('T13'));assert.ok(!JSON.stringify(r.records).includes('private'));
});
test('生成名は30文字以内・ASCIIキーで異なり識別子付き',()=>{
  const names=tagNames('01234567-89ab-4cde-8fab-0123456789ab');
  assert.equal(new Set(names.map((n)=>n.toLowerCase())).size,3);assert.ok(names.every((n)=>n.length===29));
});
for(const mode of ['name-collision','create-id','create-name','owner','rename-id','rename-name','revision','date',
  'changed','other-tag','memo','relation','network','timeout','success','http','code','message','read-failure',
  'cancel-create','cancel-rename','cancel-conflict','record-create','record-rename','record-conflict']) {
  test(`${mode}は停止・再送なし`,async()=>{
    const r=await simulate(mode);assert.ok(r.error);assert.ok(r.calls.length<=7);
    assert.ok(r.calls.filter((c)=>c.name==='memo_save_tag').length<=3);
    if(['cancel-create','name-collision'].includes(mode))assert.equal(r.calls.length,1);
    if(mode==='record-create')assert.equal(r.calls.filter((c)=>c.name==='memo_save_tag').length,1);
    if(mode==='record-rename')assert.equal(r.calls.filter((c)=>c.name==='memo_save_tag').length,2);
  });
}
for(const mode of ['ok','conflict','http','success','code','message','network','timeout','json']) {
  test(`HTTP ${mode}（ネットワークなし）`,async()=>{
    let count=0;const rejection=mode!=='ok';
    const rpc=tagRpc('https://invalid.example',{},async(url,options)=>{
      count++;assert.ok(url.endsWith('/rpc/memo_save_tag'));assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
      if(mode==='network')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
      return {status:mode==='ok'||mode==='success'?200:mode==='http'?400:409,json:async()=>{
        if(mode==='json')throw new SyntaxError('private');
        return mode==='ok'?{dummy:true}:{code:mode==='code'?'40001':'PT409',message:mode==='message'?'revision conflict':'tag revision conflict'};
      }};
    });
    if(['http','success','network','timeout','json'].includes(mode))await assert.rejects(rpc('memo_save_tag',{},rejection));
    else {
      const r=await rpc('memo_save_tag',{},rejection);
      if(mode==='ok')assert.deepEqual(r,{dummy:true});else{assert.equal(r.codeMatches,mode!=='code');assert.equal(r.messageMatches,mode!=='message');}
    }
    assert.equal(count,1);await assert.rejects(rpc('memo_delete_tag',{}));assert.equal(count,1);
  });
}
