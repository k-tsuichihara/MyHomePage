import test from 'node:test';
import assert from 'node:assert/strict';
import {runTagUsageCase,tagUsage,verifyUsageCounts} from './tag-usage-contract.mjs';
import {UsageDiagnostic,safeUsageFailure} from './tag-usage-diagnostics.mjs';
import './tag-usage-read.mjs';
globalThis.fetch=()=>{throw new Error('network forbidden');};
const fixture=()=>({tags:[{id:'used',user_id:'u'},{id:'unused',user_id:'u'}],
  memos:[{id:'normal',user_id:'u',deleted_at:null},{id:'trash',user_id:'u',deleted_at:'2026-10-20T00:00:00Z'}],
  memoTags:[{user_id:'u',memo_id:'normal',tag_id:'used'},{user_id:'u',memo_id:'trash',tag_id:'used'}]});
test('独立集計：通常のみ1・未使用0、復元で2・全ゴミ箱で0',()=>{
  const s=fixture();assert.deepEqual([...tagUsage(s,'u')],[['used',1],['unused',0]]);
  s.memos[1].deleted_at=null;assert.equal(tagUsage(s,'u').get('used'),2);
  s.memos.forEach((m)=>{m.deleted_at='2026-10-20T00:00:00Z';});assert.equal(tagUsage(s,'u').get('used'),0);
});
for(const mode of ['duplicate','orphan-memo','orphan-tag','owner','missing-deleted','duplicate-memo']){
  test(`集計入力 ${mode}を拒否`,()=>{
    const s=fixture();if(mode==='duplicate')s.memoTags.push({...s.memoTags[0]});
    if(mode==='orphan-memo')s.memoTags[0].memo_id='missing';if(mode==='orphan-tag')s.memoTags[0].tag_id='missing';
    if(mode==='owner')s.memoTags[0].user_id='other';if(mode==='missing-deleted')delete s.memos[0].deleted_at;
    if(mode==='duplicate-memo')s.memos.push({...s.memos[0]});assert.throws(()=>tagUsage(s,'u'));
  });
}
async function simulate(mode=''){
  const state={memos:[],tags:[],memoTags:[]},calls=[],confirmations=[],records=[],stages=[];let result,error;
  try{
    result=await runTagUsageCase({runId:'01234567-89ab-4cde-8fab-0123456789ab',tagIds:['used','unused'],memoIds:['m1','m2'],requestIds:['c1','c2','trash-id','restore-id'],userId:'u',
      setStage:(s)=>stages.push(s),
      confirm:async(action)=>{confirmations.push(action);return mode!==`cancel-${action}`;},
      progress:async(action,detail)=>{records.push({action,...detail});if(mode===`record-${action}`)throw new Error('mock');},
      rpc:async(name,p)=>{
        calls.push({name,payload:structuredClone(p)});
        if(name==='memo_load_snapshot'){
          const s=structuredClone(state);
          if(s.memos.length===2){
            if(mode==='lost-relation')s.memoTags.pop();if(mode==='extra-relation')s.memoTags.push({user_id:'u',memo_id:'m1',tag_id:'unused'});
            if(mode==='tag-change')s.tags[0].revision=2;if(mode==='body-change')s.memos[0].body='changed';
            if(mode==='unknown-field')s.memos[0]['private-unknown-key']='private-value';
          }return s;
        }
        if(name==='memo_save_tag'){
          const t={id:p.p_id,name:p.p_name,user_id:'u',revision:1,created_at:'2026-10-20T00:00:00Z'};
          state.tags.push(structuredClone(t));return t;
        }
        if(name==='memo_save'){
          const m={id:p.p_id,title:p.p_title,body:p.p_body,user_id:'u',revision:1,last_request_id:p.p_request_id,
            created_at:'2026-10-20T00:00:00Z',updated_at:'2026-10-20T00:00:00Z',pinned_at:null,deleted_at:null};
          state.memos.push(structuredClone(m));state.memoTags.push({user_id:'u',memo_id:p.p_id,tag_id:'used'});return {memo:m,tagIds:['used']};
        }
        assert.equal(name,'memo_change_state');assert.equal(p.p_id,'m2');const trash=p.p_action==='trash';
        assert.equal(p.p_expected_revision,trash?1:2);assert.equal(p.p_request_id,trash?'trash-id':'restore-id');
        if(mode==='network')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
        const updated=trash?'2026-10-20T00:00:01Z':'2026-10-20T00:00:02Z';
        const row={...state.memos[1],revision:trash?2:3,last_request_id:p.p_request_id,updated_at:updated,deleted_at:trash?updated:null};
        if(mode==='revision')row.revision=99;if(mode==='deleted')row.deleted_at=trash?null:updated;
        if(mode==='request')row.last_request_id='wrong';if(mode==='pinned')row.pinned_at=updated;
        state.memos[1]=structuredClone(row);return row;
      }});
  }catch(e){error=e;}
  return {result,error,calls,confirmations,records,stages};
}
for(const [mode,item] of [['lost-relation','snapshot.memoTags.length'],['extra-relation','snapshot.memoTags.length'],
  ['tag-change','snapshot.tags.revision'],['body-change','snapshot.memos.body'],['unknown-field','snapshot.memos.otherFieldsOrMultiplicity']]){
  test(`取得後差分 ${mode}の段階と項目を特定`,async()=>{
    const r=await simulate(mode);assert.ok(r.error instanceof UsageDiagnostic);
    assert.equal(r.error.phase,'取得後検証');assert.equal(r.error.item,item);
    assert.equal(r.stages.at(-1),'memo-2: 取得後検証');
    assert.ok(!JSON.stringify(safeUsageFailure(r.error)).includes('private'));
  });
}
test('件数照合は使用タグ・未使用タグを区別し不一致を拒否',()=>{
  assert.throws(()=>verifyUsageCounts(new Map([['a',2],['u',0]]),['a','u'],1,true),
    (e)=>e.phase==='件数照合'&&e.item==='counts.usedTag');
  assert.throws(()=>verifyUsageCounts(new Map([['a',1],['u',1]]),['a','u'],1,true),
    (e)=>e.phase==='件数照合'&&e.item==='counts.unusedTag');
  assert.doesNotThrow(()=>verifyUsageCounts(new Map([['a',1],['u',0]]),['a','u'],1,true));
});
test('統合：複数メモ/未使用/ゴミ箱除外/復元、13 RPC・6確認',async()=>{
  const r=await simulate();assert.ifError(r.error);assert.equal(r.calls.length,13);assert.equal(r.confirmations.length,6);
  assert.deepEqual(r.records.map((r)=>r.usedTagCount),[0,0,1,2,1,2]);assert.equal(r.result.unusedTagCount,0);
  assert.equal(r.calls.filter((c)=>c.name==='memo_load_snapshot').length,7);assert.ok(!JSON.stringify(r.records).includes('DBTEST'));
});
for(const mode of ['lost-relation','extra-relation','tag-change','body-change','revision','deleted','request','pinned','network','timeout',
  'cancel-tag-used','cancel-memo-1','cancel-trash','cancel-restore','record-tag-used','record-memo-2','record-trash']){
  test(`${mode}停止・再送なし`,async()=>{
    const r=await simulate(mode);assert.ok(r.error);assert.ok(r.calls.length<=13);
    assert.ok(r.calls.filter((c)=>c.name==='memo_save').length<=2);assert.ok(r.calls.filter((c)=>c.name==='memo_change_state').length<=2);
    if(['network','timeout','record-trash'].includes(mode))assert.ok(!r.calls.some((c)=>c.payload.p_action==='restore'));
    if(mode==='cancel-tag-used')assert.equal(r.calls.length,1);
  });
}
