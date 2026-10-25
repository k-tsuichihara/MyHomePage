import test from 'node:test';
import assert from 'node:assert/strict';
import {TARGET_RUN,validateDeleteRecords,inspectDeleteSnapshot,inspectionRequest,InspectionError} from './inspect-tag-delete-contract.mjs';
import './inspect-tag-delete.mjs';
globalThis.fetch=()=>{throw new Error('network forbidden');};
const origin='https://yohoppqflnhhvqypwhfv.supabase.co';
// Synthetic records, not copied from private runs. Only public IDs pinned by
// the unchanged diagnostic validator are retained; all other values are invented.
const id=(n)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const run={version:1,test:'tag-delete-read',runId:TARGET_RUN,status:'prepared',
  projectHost:new URL(origin).hostname,userId:id(1),tagIds:[id(2),id(3)],
  memoIds:['ffa12df4-197e-4045-ae11-23a296a735f7',id(4)],
  requestIds:['fe9314ca-9a51-4ab8-9b78-1baa184dcd29',id(5),id(6)],startedAt:'2026-01-01T00:00:00Z'};
const result=(action)=>({runId:run.runId,action,status:'passed',tagIds:[...run.tagIds],memoIds:[...run.memoIds],completedAt:'2026-01-01T00:00:01Z'});
const records={identity:run,deleted:result('tag-delete'),kept:result('tag-keep'),
  failure:{...result('failure'),status:'failed',stage:'memo-1: 取得後検証',
    diagnostic:{phase:'取得後検証',item:'snapshot.memoTags.allFields'},completedAt:'2026-01-01T00:00:02Z'}};
function fixture(){
  return {memos:[{id:run.memoIds[0],user_id:run.userId,revision:1,last_request_id:run.requestIds[0],deleted_at:null,pinned_at:null,
    title:`DBTEST-TAG-DELETE-1-${run.runId}`,body:`tag delete test 1 ${run.runId}`,created_at:'2026-10-25T00:00:00Z',updated_at:'2026-10-25T00:00:00Z'}],
    tags:run.tagIds.map((id,i)=>({id,user_id:run.userId,name:`T18${i===0?'D':'K'}-${run.runId.replaceAll('-','').slice(0,24)}`,revision:1})),
    memoTags:run.tagIds.map((tag_id)=>({tag_id,memo_id:run.memoIds[0],user_id:run.userId}))};
}
test('対象run・タグ作成PASS2件・失敗記録の対応を検証',()=>{assert.equal(validateDeleteRecords(records,new URL(origin).hostname).runId,TARGET_RUN);});
for(const mode of ['host','request','pass','failure'])test(`記録 ${mode}不一致で停止`,()=>{
  const r=structuredClone(records);if(mode==='request')r.identity.requestIds[0]=r.identity.requestIds[1];
  if(mode==='pass')r.deleted.status='failed';if(mode==='failure')r.failure.diagnostic.item='other';
  assert.throws(()=>validateDeleteRecords(r,mode==='host'?'invalid.example':new URL(origin).hostname),InspectionError);
});
test('期待現在状態は全項目PASS・実値を出さない',()=>{
  const checks=inspectDeleteSnapshot(run,fixture());assert.ok(checks.every((c)=>c.passed));
  const output=JSON.stringify(checks);assert.ok(!output.includes('tag delete test'));assert.ok(!output.includes('DBTEST'));assert.ok(!output.includes('T18D-'));
});
test('関連のキー順・配列順が異なっても同じ診断結果',()=>{
  const s=fixture(),initial=inspectDeleteSnapshot(run,s);s.tags.reverse();
  s.memoTags.reverse();s.memoTags=s.memoTags.map((r)=>({user_id:r.user_id,memo_id:r.memo_id,tag_id:r.tag_id}));
  assert.deepEqual(inspectDeleteSnapshot(run,s),initial);
});
for(const mode of ['missing-memo','revision','request','deleted','pinned','title','body','dates','missing-delete-tag','missing-keep-tag',
  'tag-name','tag-revision','missing-link','duplicate-link','extra-link','relation-owner','memo2','orphan']){
  test(`差分 ${mode}を機密値なしでFAIL表示`,()=>{
    const s=fixture();
    if(mode==='missing-memo')s.memos=[];if(mode==='revision')s.memos[0].revision=2;
    if(mode==='request')s.memos[0].last_request_id='private-id';if(mode==='deleted')s.memos[0].deleted_at='2026-10-25T01:00:00Z';
    if(mode==='pinned')s.memos[0].pinned_at='2026-10-25T01:00:00Z';if(mode==='title')s.memos[0].title='private-title';
    if(mode==='body')s.memos[0].body='private-body';if(mode==='dates')s.memos[0].updated_at='2026-10-25T01:00:00Z';
    if(mode==='missing-delete-tag')s.tags.shift();if(mode==='missing-keep-tag')s.tags.pop();
    if(mode==='tag-name')s.tags[0].name='private-name';if(mode==='tag-revision')s.tags[0].revision=2;
    if(mode==='missing-link')s.memoTags.pop();if(mode==='duplicate-link')s.memoTags.push({...s.memoTags[0]});
    if(mode==='extra-link')s.memoTags.push({memo_id:run.memoIds[0],tag_id:'absent',user_id:run.userId});
    if(mode==='relation-owner')s.memoTags[0].user_id='private-owner';
    if(mode==='memo2')s.memos.push({...s.memos[0],id:run.memoIds[1]});
    if(mode==='orphan')s.memoTags.push({memo_id:'absent',tag_id:run.tagIds[0],user_id:run.userId});
    const checks=inspectDeleteSnapshot(run,s);assert.ok(checks.some((c)=>!c.passed));assert.ok(!JSON.stringify(checks).includes('private'));
  });
}
test('取得形式不正は取得後検証エラー',()=>{assert.throws(()=>inspectDeleteSnapshot(run,null),(e)=>e.phase==='取得後検証');});
for(const mode of ['login','snapshot','network','timeout','http','body','json']){
  test(`通信 ${mode}を区別・実通信なし`,async()=>{
    let count=0;
    const action=()=>inspectionRequest(origin,'private-key',mode==='login'?'login':'snapshot',
      {email:'private-email',password:'private-password',token:'private-token'},async(url,options)=>{
        count++;assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
        if(mode==='login')assert.ok(url.endsWith('/auth/v1/token?grant_type=password'));
        else{assert.ok(url.endsWith('/rest/v1/rpc/memo_load_snapshot'));assert.equal(options.body,'{}');}
        if(mode==='network')throw new TypeError('private-error');if(mode==='timeout')throw new DOMException('private-error','TimeoutError');
        return {status:mode==='http'?503:200,text:async()=>{if(mode==='body')throw new TypeError('private-error');return mode==='json'?'private-json':'{}';}};
      });
    if(['login','snapshot'].includes(mode))assert.deepEqual(await action(),{});
    else await assert.rejects(action(),(e)=>{
      assert.equal(e.phase,{network:'fetch通信',timeout:'fetch通信',http:'HTTP応答',body:'応答本文受信',json:'JSON解析'}[mode]);
      assert.ok(!JSON.stringify(e).includes('private'));return true;
    });assert.equal(count,1);
  });
}
test('他origin・書き込みRPCはfetch前に拒否',async()=>{
  let count=0;const f=()=>{count++;throw new Error('forbidden');};
  await assert.rejects(inspectionRequest('https://production.example','key','snapshot',{token:'x'},f));
  await assert.rejects(inspectionRequest(origin,'key','memo_save',{token:'x'},f));
  await assert.rejects(inspectionRequest(origin,'key','memo_delete_tag',{token:'x'},f));assert.equal(count,0);
});
