import test from 'node:test';
import assert from 'node:assert/strict';
import {runTagDeleteCase,tagDeleteRpc,compareTagDeleteSnapshots} from './tag-delete-contract.mjs';
import './tag-delete-read.mjs';
globalThis.fetch=()=>{throw new Error('network forbidden');};
async function simulate(mode=''){
  const state={memos:[{id:'existing',body:'private'}],tags:[{id:'existing-tag',name:'existing'}],memoTags:[]};
  if(mode==='reordered')state.memoTags.push({tag_id:'existing-tag',memo_id:'existing',user_id:'u'});
  const calls=[],confirmations=[],records=[];let result,error,deleted=false;
  try{
    result=await runTagDeleteCase({runId:'01234567-89ab-4cde-8fab-0123456789ab',tagIds:['delete','keep'],memoIds:['m1','m2'],requestIds:['c1','c2','trash-id'],userId:'u',
      confirm:async(label)=>{confirmations.push(label);return mode!==`cancel-${label}`;},
      progress:async(label,detail)=>{records.push({label,...detail});if(mode===`record-${label}`)throw new Error('mock');},
      rpc:async(name,p)=>{
        calls.push({name,payload:structuredClone(p)});
        if(name==='memo_load_snapshot'){
          const s=structuredClone(state);
          if(deleted){
            if(mode==='tag-remains')s.tags.push({id:'delete',name:'private'});
            if(mode==='link-remains')s.memoTags.push({user_id:'u',memo_id:'m1',tag_id:'delete'});
            if(mode==='keep-link-lost')s.memoTags=[];
            if(mode==='other-memo')s.memos[0].body='changed';if(mode==='other-tag')s.tags[0].name='changed';
          }
          if(mode==='reordered')for(const k of ['memos','tags','memoTags']){
            s[k]=s[k].reverse().map((row)=>Object.fromEntries(Object.entries(row).reverse()));
          }
          return s;
        }
        if(name==='memo_save_tag'){
          const t={id:p.p_id,name:p.p_name,user_id:'u',revision:1,created_at:'2026-10-25T00:00:00Z'};state.tags.push(structuredClone(t));return t;
        }
        if(name==='memo_save'){
          const m={id:p.p_id,user_id:'u',title:p.p_title,body:p.p_body,revision:1,last_request_id:p.p_request_id,pinned_at:null,deleted_at:null,
            created_at:'2026-10-25T00:00:00Z',updated_at:'2026-10-25T00:00:00Z'};
          state.memos.push(structuredClone(m));state.memoTags.push(...p.p_tag_ids.map((id)=>({user_id:'u',memo_id:p.p_id,tag_id:id})));return {memo:m,tagIds:p.p_tag_ids};
        }
        if(name==='memo_change_state'){
          assert.equal(p.p_id,'m2');const m=state.memos[2];state.memos[2]={...m,revision:2,last_request_id:'trash-id',updated_at:'2026-10-25T00:00:01Z',deleted_at:'2026-10-25T00:00:01Z'};return structuredClone(state.memos[2]);
        }
        assert.equal(name,'memo_delete_tag');assert.deepEqual(p,{p_id:'delete',p_expected_revision:1});
        if(mode==='network')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
        deleted=true;state.tags=state.tags.filter((t)=>t.id!=='delete');state.memoTags=state.memoTags.filter((r)=>r.tag_id!=='delete');
        for(const m of state.memos.filter((m)=>['m1','m2'].includes(m.id))){m.revision++;m.updated_at='2026-10-25T00:00:02Z';m.last_request_id=null;}
        if(mode==='revision')state.memos[1].revision=1;
        if(mode==='trash-revision')state.memos[2].revision=2;
        if(mode==='request')state.memos[1].last_request_id='c1';
        if(mode==='body')state.memos[1].body='changed';if(mode==='title')state.memos[1].title='changed';
        if(mode==='created')state.memos[1].created_at='2026-10-25T00:00:01Z';
        if(mode==='trash-state')state.memos[2].deleted_at=null;
        if(mode==='date')state.memos[1].updated_at=state.memos[1].created_at;
        if(mode==='different-times')state.memos[2].updated_at='2026-10-25T00:00:03Z';
        return mode==='bad-receipt'?{}:null;
      }});
  }catch(e){error=e;}
  return {result,error,calls,confirmations,records};
}
test('通常/ゴミ箱メモのrevisionとlast_request_id更新・関連削除・13RPC/6確認',async()=>{
  const r=await simulate();assert.ifError(r.error);assert.equal(r.calls.length,13);assert.equal(r.confirmations.length,6);
  assert.equal(r.calls.filter((c)=>c.name==='memo_delete_tag').length,1);assert.equal(r.result.relationsRetained,1);
  assert.equal(r.result.normalMemoRevision,2);assert.equal(r.result.trashMemoRevision,3);
  assert.ok(!JSON.stringify(r.records).includes('private'));
});
test('既存関連あり・全行のキー順/配列順が異なっても全経路PASS',async()=>{
  const r=await simulate('reordered');assert.ifError(r.error);assert.equal(r.calls.length,13);assert.equal(r.confirmations.length,6);
});

function comparisonFixture(){return {
  memos:[{id:'m1',user_id:'u',body:'private-body',revision:1},{id:'m2',user_id:'u',body:'second',revision:2}],
  tags:[{id:'t1',user_id:'u',name:'private-name'},{id:'t2',user_id:'u',name:'second'}],
  memoTags:[{memo_id:'m1',tag_id:'t1',user_id:'u'},{memo_id:'m1',tag_id:'t2',user_id:'u'}],
};}
test('同じメモに複数タグ：複合キーで対応し順序差だけはPASS・入力無変更',()=>{
  const expected=comparisonFixture(),actual=structuredClone(expected);
  for(const k of ['memos','tags','memoTags'])actual[k]=actual[k].reverse().map((r)=>Object.fromEntries(Object.entries(r).reverse()));
  const before=structuredClone(actual);assert.doesNotThrow(()=>compareTagDeleteSnapshots(actual,expected));assert.deepEqual(actual,before);
});
for(const collection of ['memos','tags','memoTags']){
  for(const mode of ['duplicate-actual','duplicate-expected','missing','extra','value','added-field','missing-field','added-undefined','type','invalid-key']){
    test(`${collection}/${mode}はFAIL（全フィールドを維持）`,()=>{
      const expected=comparisonFixture(),actual=structuredClone(expected),row=actual[collection][0];
      if(mode==='duplicate-actual')actual[collection].push({...row});
      if(mode==='duplicate-expected')expected[collection].push({...expected[collection][0]});
      if(mode==='missing')actual[collection].pop();
      if(mode==='extra')actual[collection].push(collection==='memoTags'?{...row,tag_id:'extra'}:{...row,id:'extra'});
      if(mode==='value')row.user_id='private-owner';
      if(mode==='added-field')row['private-extra-key']='private-value';
      if(mode==='missing-field')delete row.user_id;
      if(mode==='added-undefined')row.extra=undefined;
      if(mode==='type')row.user_id=1;
      if(mode==='invalid-key')delete row[collection==='memoTags'?'memo_id':'id'];
      assert.throws(()=>compareTagDeleteSnapshots(actual,expected),(e)=>{
        assert.equal(e.phase,'取得後検証');assert.ok(e.item.startsWith(`snapshot.${collection}.`));
        assert.ok(!JSON.stringify(e).includes('private'));return true;
      });
    });
  }
}
test('複合キーの単純結合なら衝突する値も別関連として対応する',()=>{
  const expected={memos:[],tags:[],memoTags:[{memo_id:'a:b',tag_id:'c',user_id:'u'},{memo_id:'a',tag_id:'b:c',user_id:'u'}]};
  const actual=structuredClone(expected);actual.memoTags.reverse();assert.doesNotThrow(()=>compareTagDeleteSnapshots(actual,expected));
});
test('同じ行数でも関連欠落と別関連の追加を検出',()=>{
  const expected=comparisonFixture(),actual=structuredClone(expected);actual.memoTags[0].tag_id='other';
  assert.throws(()=>compareTagDeleteSnapshots(actual,expected),(e)=>e.item==='snapshot.memoTags.missing');
});
for(const mode of ['tag-remains','link-remains','keep-link-lost','other-memo','other-tag','revision','trash-revision','request','body','title',
  'created','trash-state','date','different-times','bad-receipt','network','timeout','cancel-tag-delete','cancel-memo-1','cancel-delete-tag','record-tag-delete','record-trash']){
  test(`${mode}停止・自動再送なし`,async()=>{
    const r=await simulate(mode);assert.ok(r.error);assert.ok(r.calls.length<=13);assert.ok(r.calls.filter((c)=>c.name==='memo_delete_tag').length<=1);
    if(['cancel-delete-tag','record-trash'].includes(mode))assert.equal(r.calls.filter((c)=>c.name==='memo_delete_tag').length,0);
    if(mode==='cancel-tag-delete')assert.equal(r.calls.length,1);
  });
}
for(const mode of ['void','json','http','network','timeout','body','invalid-json','nonempty-void']){
  test(`HTTP ${mode}を分類・実通信なし`,async()=>{
    let count=0;const name=['json','invalid-json'].includes(mode)?'memo_save':'memo_delete_tag';
    const rpc=tagDeleteRpc('https://yohoppqflnhhvqypwhfv.supabase.co',{},async(_url,options)=>{
      count++;assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
      if(mode==='network')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
      return {status:mode==='http'?409:name==='memo_delete_tag'?204:200,text:async()=>{
        if(mode==='body')throw new TypeError('private');if(mode==='invalid-json')return 'private';
        return mode==='nonempty-void'?'private':name==='memo_delete_tag'?'':'{}';
      }};
    });
    if(mode==='void')assert.equal(await rpc(name,{}),null);else if(mode==='json')assert.deepEqual(await rpc(name,{}),{});
    else await assert.rejects(rpc(name,{}),(e)=>{assert.ok(!JSON.stringify(e).includes('private'));return true;});
    assert.equal(count,1);await assert.rejects(rpc('memo_delete_permanently',{}));assert.equal(count,1);
  });
}
