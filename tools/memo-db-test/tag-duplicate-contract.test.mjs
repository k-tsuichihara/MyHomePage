import test from 'node:test';
import assert from 'node:assert/strict';
import {runTagDuplicateCase,duplicateNames,asciiKey,duplicateRpc,DUPLICATE_MESSAGE} from './tag-duplicate-contract.mjs';
import './tag-duplicate-read.mjs';
globalThis.fetch=()=>{throw new Error('network forbidden');};
async function simulate(mode=''){
  const names=duplicateNames('01234567-89ab-4cde-8fab-0123456789ab'),ids=['a','b','c','d','e'];
  const state={memos:[{id:'memo',body:'private'}],tags:[{id:'old',name:'existing'}],memoTags:[]};
  if(mode==='precollision')state.tags[0].name=asciiKey(names.upper);
  const calls=[],confirmations=[],records=[];let result,error,rejections=0;
  try{
    result=await runTagDuplicateCase({ids,names,userId:'u',
      confirm:async(label)=>{confirmations.push(label);return mode!==`cancel-${label}`;},
      progress:async(label,detail)=>{records.push({label,...detail});if(mode===`record-${label}`)throw new Error('mock');},
      rpc:async(name,payload,reject)=>{
        calls.push({name,payload:structuredClone(payload),reject});
        if(name==='memo_load_snapshot'){
          const s=structuredClone(state);
          if(rejections){
            if(mode==='other')s.tags[0].name='changed';if(mode==='memo')s.memos[0].body='changed';
            if(mode==='relation')s.memoTags.push({memo_id:'memo',tag_id:'a'});
            if(mode==='changed')s.tags[1].revision=2;
          }
          return s;
        }
        assert.equal(name,'memo_save_tag');
        if(reject){
          rejections++;
          if(rejections===1)assert.deepEqual(payload,{p_id:'b',p_name:names.ascii,p_expected_revision:null});
          if(rejections===2)assert.deepEqual(payload,{p_id:'c',p_name:asciiKey(names.ascii),p_expected_revision:null});
          if(rejections===3)assert.deepEqual(payload,{p_id:'e',p_name:names.upper,p_expected_revision:1});
          if(mode==='network')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
          return {status:mode==='success'?200:mode==='http'?400:409,codeMatches:mode!=='code',messageMatches:mode!=='message'};
        }
        if(mode==='nonascii-rejected'&&payload.p_id==='e')throw new Error('mock');
        const row={id:payload.p_id,name:payload.p_name,user_id:'u',revision:1,created_at:'2026-10-17T00:00:00Z'};
        if(mode==='id')row.id='wrong';if(mode==='name')row.name='wrong';if(mode==='owner')row.user_id='wrong';if(mode==='revision')row.revision=2;
        state.tags.push(structuredClone(row));return row;
      }});
  }catch(e){error=e;}
  return {result,error,calls,confirmations,records};
}
test('完全一致・ASCII差拒否、Ä/ä別作成、重複rename拒否：13 RPC/確認6回',async()=>{
  const r=await simulate();assert.ifError(r.error);assert.equal(r.calls.length,13);assert.equal(r.confirmations.length,6);
  assert.equal(r.calls.filter((c)=>c.name==='memo_save_tag').length,6);assert.equal(r.result.tagsRetained,3);
  assert.ok(!JSON.stringify(r.records).includes('T14'));assert.ok(!JSON.stringify(r.records).includes('private'));
});
test('名前生成とASCII専用キー',()=>{
  const n=duplicateNames('01234567-89ab-4cde-8fab-0123456789ab');
  assert.equal(asciiKey('ABCÄä日本語'),'abcÄä日本語');assert.notEqual(asciiKey(n.upper),asciiKey(n.lower));
  assert.ok(Object.values(n).every((s)=>Array.from(s).length===29));
});
for(const mode of ['precollision','success','http','code','message','id','name','owner','revision','changed','other','memo','relation',
  'network','timeout','nonascii-rejected','cancel-create-ascii','cancel-duplicate-exact','cancel-rename-duplicate',
  'record-create-ascii','record-duplicate-exact','record-create-nonascii-lower']){
  test(`${mode}は停止・再送なし`,async()=>{
    const r=await simulate(mode);assert.ok(r.error);assert.ok(r.calls.length<=13);
    assert.ok(r.calls.filter((c)=>c.name==='memo_save_tag').length<=6);
    if(['success','http','code','message','network','timeout'].includes(mode))assert.equal(r.calls.filter((c)=>c.reject).length,1);
    if(['precollision','cancel-create-ascii'].includes(mode))assert.equal(r.calls.length,1);
    if(mode==='record-create-ascii')assert.equal(r.calls.filter((c)=>c.name==='memo_save_tag').length,1);
  });
}
for(const mode of ['ok','duplicate','success','http','code','message','network','timeout','json']){
  test(`HTTP ${mode}（実通信なし）`,async()=>{
    let count=0;const rejection=mode!=='ok';
    const rpc=duplicateRpc('https://invalid.example',{},async(_url,options)=>{
      count++;assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
      if(mode==='network')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
      return {status:mode==='ok'||mode==='success'?200:mode==='http'?400:409,json:async()=>{
        if(mode==='json')throw new SyntaxError('private');
        return mode==='ok'?{dummy:true}:{code:mode==='code'?'PT409':'23505',message:mode==='message'?'private':DUPLICATE_MESSAGE};
      }};
    });
    if(['success','http','network','timeout','json'].includes(mode))await assert.rejects(rpc('memo_save_tag',{},rejection));
    else{const r=await rpc('memo_save_tag',{},rejection);if(rejection){assert.equal(r.codeMatches,mode!=='code');assert.equal(r.messageMatches,mode!=='message');}}
    assert.equal(count,1);await assert.rejects(rpc('memo_delete_tag',{}));assert.equal(count,1);
  });
}
