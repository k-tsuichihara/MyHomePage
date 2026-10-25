import test from 'node:test';
import assert from 'node:assert/strict';
import {runInputLimitsCase,limitInputs,codePoints,limitRejection} from './input-limits-contract.mjs';
import './input-limits-read.mjs';
globalThis.fetch=()=>{throw new Error('network forbidden');};
const runId='01234567-89ab-4cde-8fab-0123456789ab';
test('境界入力はコードポイント数、UTF16単位ではない',()=>{
  const v=limitInputs(runId);
  for(const [key,n] of [['tag',30],['tagOver',31],['title',100],['titleOver',101],['body',10000],['bodyOver',10001]]){
    assert.equal(codePoints(v[key]),n);assert.equal(v[key].length,n+1);
  }
  assert.equal(codePoints('a\n😀'),3);
});
async function simulate(mode=''){
  const state={memos:[{id:'existing',body:'private'}],tags:[{id:'existing-tag',name:'existing'}],memoTags:[]};
  const calls=[],confirmations=[],records=[];const v=limitInputs(runId);let result,error;
  try{
    result=await runInputLimitsCase({runId,tagId:'tag',memoId:'memo',requestIds:['create','title-over','body-valid','body-over'],userId:'u',
      confirm:async(action)=>{confirmations.push(action);return mode!==`cancel-${action}`;},
      progress:async(action,detail)=>{records.push({action,...detail});if(mode===`record-${action}`)throw new Error('mock');},
      rpc:async(name,payload)=>{
        calls.push({name,payload:structuredClone(payload)});
        if(name==='memo_load_snapshot'){
          const s=structuredClone(state);for(const k of ['memos','tags','memoTags'])s[k]=s[k].reverse().map((r)=>Object.fromEntries(Object.entries(r).reverse()));return s;
        }
        if(name==='memo_save_tag'){
          assert.equal(payload.p_name,v.tag);const t={id:'tag',name:v.tag,user_id:'u',revision:1,created_at:'2026-10-25T00:00:00Z'};
          if(mode==='tag-truncated')t.name=t.name.slice(0,-2);state.tags.push(structuredClone(t));return t;
        }
        if(name==='memo_resolve_request')return mode==='resolve'?{status:'saved',result:{}}:null;
        assert.equal(name,'memo_save');const create=payload.p_expected_revision===null;
        if(create){
          assert.equal(payload.p_title,v.title);assert.equal(payload.p_request_id,'create');
          const m={id:'memo',user_id:'u',title:payload.p_title,body:payload.p_body,revision:1,last_request_id:'create',pinned_at:null,deleted_at:null,
            created_at:'2026-10-25T00:00:00Z',updated_at:'2026-10-25T00:00:00Z'};
          if(mode==='title-truncated')m.title='short';state.memos.push(structuredClone(m));state.memoTags.push({user_id:'u',memo_id:'memo',tag_id:'tag'});return {memo:m,tagIds:['tag']};
        }
        assert.equal(payload.p_body,v.body);assert.equal(payload.p_request_id,'body-valid');assert.equal(payload.p_expected_revision,1);
        const row={...state.memos[1],body:v.body,revision:2,last_request_id:'body-valid',updated_at:'2026-10-25T00:00:01Z'};
        if(mode==='body-truncated')row.body='short';state.memos[1]=structuredClone(row);return {memo:row,tagIds:['tag']};
      },
      reject:async(name,payload)=>{
        calls.push({name,payload:structuredClone(payload),rejection:true});const tag=name==='memo_save_tag';
        if(tag)assert.deepEqual(payload,{p_id:'tag',p_name:v.tagOver,p_expected_revision:1});
        else if(payload.p_request_id==='title-over'){
          assert.equal(payload.p_title,v.titleOver);assert.equal(payload.p_expected_revision,1);
        }else{assert.equal(payload.p_request_id,'body-over');assert.equal(payload.p_body,v.bodyOver);assert.equal(payload.p_expected_revision,2);}
        if(mode==='timeout')throw new DOMException('private','TimeoutError');if(mode==='network')throw new TypeError('private');
        const mutate=mode.startsWith('memo-')&&!tag;
        if(mutate){
          if(mode==='memo-body')state.memos[1].body='changed';if(mode==='memo-revision')state.memos[1].revision++;
          if(mode==='memo-request')state.memos[1].last_request_id='wrong';if(mode==='memo-link')state.memoTags=[];
        }
        if(mode==='tag-changed')state.tags[1].revision=2;if(mode==='other-changed')state.memos[0].body='changed';
        return {status:mode==='success'?200:mode==='http'?409:400,codeMatches:mode!=='code',message:mode==='message'?'wrong':tag?'invalid tag input':'invalid memo content'};
      }});
  }catch(e){error=e;}
  return {result,error,calls,confirmations,records};
}
test('上限許可3件・超過拒否3件、15RPC・確認6回・順序非依存比較',async()=>{
  const r=await simulate();assert.ifError(r.error);assert.equal(r.calls.length,15);
  assert.deepEqual(r.confirmations,['tag-30','tag-31','title-100','title-101','body-10000','body-10001']);
  assert.equal(r.calls.filter((c)=>c.name==='memo_load_snapshot').length,7);assert.equal(r.result.boundariesVerified,6);
  assert.ok(!JSON.stringify(r.records).includes('😀'));assert.ok(!JSON.stringify(r.records).includes('private'));
});
for(const mode of ['tag-truncated','title-truncated','body-truncated','success','http','code','message','timeout','network',
  'tag-changed','other-changed','memo-body','memo-revision','memo-request','memo-link','resolve',
  'cancel-tag-30','cancel-title-101','cancel-body-10000','record-tag-30','record-title-100','record-body-10000']){
  test(`${mode}で停止・再送なし`,async()=>{
    const r=await simulate(mode);assert.ok(r.error);assert.ok(r.calls.length<=15);
    assert.ok(r.calls.filter((c)=>c.name==='memo_save_tag').length<=2);assert.ok(r.calls.filter((c)=>c.name==='memo_save').length<=4);
    if(['timeout','network','success','http','code','message'].includes(mode))assert.equal(r.calls.filter((c)=>c.rejection).length,1);
    if(mode==='cancel-tag-30')assert.equal(r.calls.length,1);
  });
}
for(const mode of ['tag','memo','http','success','code','message','network','timeout','json','body']){
  test(`拒否通信 ${mode}（実ネットワークなし）`,async()=>{
    let count=0;const name=mode==='tag'?'memo_save_tag':'memo_save';
    const action=()=>limitRejection('https://yohoppqflnhhvqypwhfv.supabase.co',{},name,{},async(_url,options)=>{
      count++;assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
      if(mode==='network')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
      return {status:mode==='success'?200:mode==='http'?409:400,text:async()=>{
        if(mode==='body')throw new TypeError('private');if(mode==='json')return 'private-invalid-json';
        return JSON.stringify({code:mode==='code'?'23514':'22023',message:mode==='message'?'private':name==='memo_save_tag'?'invalid tag input':'invalid memo content'});
      }};
    });
    if(['http','success','network','timeout','json','body'].includes(mode))await assert.rejects(action());
    else{const r=await action();assert.equal(r.codeMatches,mode!=='code');assert.equal(r.message,mode==='message'?null:name==='memo_save_tag'?'invalid tag input':'invalid memo content');}
    assert.equal(count,1);
  });
}
test('拒否通信も他origin・許可外RPCを送信前に拒否',async()=>{
  let count=0;const f=()=>{count++;};await assert.rejects(limitRejection('https://production.example',{},'memo_save',{},f));
  await assert.rejects(limitRejection('https://yohoppqflnhhvqypwhfv.supabase.co',{},'memo_delete_tag',{},f));assert.equal(count,0);
});
