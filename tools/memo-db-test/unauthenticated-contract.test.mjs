import test from 'node:test';
import assert from 'node:assert/strict';
import {runUnauthenticatedCase,unauthenticatedApi} from './unauthenticated-contract.mjs';
import './unauthenticated-read.mjs';
globalThis.fetch=()=>{throw new Error('network forbidden');};
async function simulate(mode=''){
  const state={memos:[{id:'old',body:'private'}],tags:[{id:'old-tag',name:'old'}],memoTags:[]};
  const calls=[],confirms=[],records=[];let result,error,probes=0;
  try{
    result=await runUnauthenticatedCase({runId:'01234567-89ab-4cde-8fab-0123456789ab',memoId:'memo',tagId:'tag',requestId:'request',userId:'u',
      confirm:async(label)=>{confirms.push(label);return mode!==`cancel-${label}`;},
      progress:async(label,detail)=>{records.push({label,...detail});if(mode===`record-${label}`)throw new Error('mock');},
      rpc:async(name,p)=>{
        calls.push(name);
        if(name==='memo_load_snapshot'){
          const s=structuredClone(state);if(probes&&mode==='changed')s.memos[1].body='changed';
          for(const k of ['memos','tags','memoTags'])s[k]=s[k].reverse().map((r)=>Object.fromEntries(Object.entries(r).reverse()));return s;
        }
        if(name==='memo_save_tag'){
          const t={id:'tag',name:p.p_name,user_id:'u',revision:1,created_at:'2026-10-25T00:00:00Z'};state.tags.push(structuredClone(t));return t;
        }
        assert.equal(name,'memo_save');const m={id:'memo',user_id:'u',title:p.p_title,body:p.p_body,revision:1,last_request_id:'request',pinned_at:null,deleted_at:null,
          created_at:'2026-10-25T00:00:00Z',updated_at:'2026-10-25T00:00:00Z'};
        state.memos.push(structuredClone(m));state.memoTags.push({user_id:'u',memo_id:'memo',tag_id:'tag'});return {memo:m,tagIds:['tag']};
      },
      tableRead:async(target)=>{
        calls.push(`authenticated-${target}`);if(mode==='authenticated-empty')return [];
        return target==='memos'?[{id:'memo',user_id:'u'}]:target==='tags'?[{id:'tag',user_id:'u'}]:[{user_id:'u',memo_id:'memo',tag_id:'tag'}];
      },
      anonymous:async(target)=>{
        calls.push(`anon-${target}`);probes++;
        if(mode==='network')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
        return {status:mode==='empty'||mode==='exposed'?200:mode==='403'?403:401,empty:mode==='empty',codeMatches:mode!=='code',
          messagePresent:mode!=='no-message',messageKind:mode==='function-guard'?'function-unauthenticated':mode==='localized'?'unclassified':'privilege-denied'};
      }});
  }catch(e){error=e;}
  return {result,error,calls,confirms,records};
}
test('認証正常読取→未認証401/42501→各回全データ不変、RPC10+SELECT6',async()=>{
  const r=await simulate();assert.ifError(r.error);assert.equal(r.calls.length,16);assert.deepEqual(r.confirms,['tag','create']);
  assert.equal(r.calls.filter((n)=>n==='memo_load_snapshot').length,7);
  assert.equal(r.result.denialsVerified,4);assert.ok(!JSON.stringify(r.records).includes('private'));
});
test('機械可読契約42501が一致しても分類不能の本文を実行前権限拒否と断定しない',async()=>{
  const r=await simulate('localized');assert.ifError(r.error);
  assert.equal(r.records.find((r)=>r.label==='anon-memos').mechanism,'42501-privilege-error-exact-layer-unconfirmed');
});
for(const mode of ['authenticated-empty','empty','exposed','403','code','no-message','function-guard','changed','network','timeout',
  'cancel-tag','cancel-create','record-tag','record-create','record-anon-memos']){
  test(`${mode}停止・自動再送なし`,async()=>{
    const r=await simulate(mode);assert.ok(r.error);assert.ok(r.calls.length<=16);
    assert.ok(r.calls.filter((n)=>n==='memo_save').length<=1);
    for(const target of ['memos','tags','memo_tags','snapshot'])assert.ok(r.calls.filter((n)=>n===`anon-${target}`).length<=1);
    if(['empty','exposed','403','code','function-guard','changed','network','timeout'].includes(mode))assert.equal(r.calls.filter((n)=>n.startsWith('anon-')).length,1);
    if(mode==='cancel-tag')assert.equal(r.calls.length,1);
  });
}
const origin='https://yohoppqflnhhvqypwhfv.supabase.co';
const ids={memoId:'01234567-89ab-4cde-8fab-0123456789ab',tagId:'11234567-89ab-4cde-8fab-0123456789ab'};
for(const target of ['memos','tags','memo_tags','snapshot']){
  test(`ヘッダー分離・経路固定 ${target}`,async()=>{
    const observed=[];
    const api=unauthenticatedApi(origin,'private-key','private-token',ids,async(url,options)=>{
      observed.push({url,options});assert.equal(options.method,target==='snapshot'?'POST':'GET');
      assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.headers.apikey,'private-key');
      return options.headers.Authorization?{status:200,text:async()=>'[]'}:
        {status:401,text:async()=>JSON.stringify({code:'42501',message:'permission denied for table private-name'})};
    });
    await api(target,true);const result=await api(target,false);
    assert.equal(observed[0].options.headers.Authorization,'Bearer private-token');
    assert.ok(!Object.hasOwn(observed[1].options.headers,'Authorization'));
    assert.equal(observed[0].url,observed[1].url);assert.ok(!JSON.stringify(result).includes('private'));
    if(target==='snapshot')assert.equal(observed[1].options.body,'{}');else assert.ok(!Object.hasOwn(observed[1].options,'body'));
  });
}
for(const mode of ['empty','null','data','bad-code','guard','localized','network','timeout','http','body','json']){
  test(`API応答 ${mode}の安全な分類`,async()=>{
    let count=0;const api=unauthenticatedApi(origin,'private-key','private-token',ids,async()=>{
      count++;if(mode==='network')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
      return {status:['empty','null','data'].includes(mode)?200:mode==='http'?403:401,text:async()=>{
        if(mode==='body')throw new TypeError('private');if(mode==='json')return 'private-invalid-json';
        if(mode==='empty')return '[]';if(mode==='null')return 'null';if(mode==='data')return '[{"body":"private"}]';
        return JSON.stringify({code:mode==='bad-code'?'PGRST302':'42501',message:mode==='guard'?'unauthenticated':mode==='localized'?'private-localized':'permission denied for function memo_load_snapshot'});
      }};
    });
    if(['network','timeout','http','body','json'].includes(mode))await assert.rejects(api('snapshot',false));
    else{const r=await api('snapshot',false);assert.ok(!JSON.stringify(r).includes('private'));
      if(['empty','null','data'].includes(mode))assert.equal(r.empty,mode!=='data');
      if(mode==='guard')assert.equal(r.messageKind,'function-unauthenticated');
      if(mode==='bad-code')assert.equal(r.codeMatches,false);
    }assert.equal(count,1);
  });
}
test('他origin・任意RPC・無効IDはfetch前に拒否',async()=>{
  let count=0;const f=()=>{count++;};
  await assert.rejects(unauthenticatedApi('https://production.example','key','token',ids,f)('memos',false));
  await assert.rejects(unauthenticatedApi(origin,'key','token',ids,f)('memo_save',false));
  await assert.rejects(unauthenticatedApi(origin,'key','token',{...ids,memoId:'bad'},f)('memos',false));assert.equal(count,0);
});
