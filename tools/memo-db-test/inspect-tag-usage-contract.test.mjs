import test from 'node:test';
import assert from 'node:assert/strict';
import {TARGET_RUN,validateUsageRecords,inspectionRequest,inspectUsageSnapshot,InspectionError} from './inspect-tag-usage-contract.mjs';
import {usageNames} from './tag-usage-contract.mjs';
import './inspect-tag-usage.mjs';
globalThis.fetch=()=>{throw new Error('network forbidden');};
const origin='https://yohoppqflnhhvqypwhfv.supabase.co';
// Synthetic records, not copied from private runs. Only public IDs pinned by
// the unchanged diagnostic validator are retained; all other values are invented.
const id=(n)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const run={version:1,test:'tag-usage-read',runId:TARGET_RUN,status:'prepared',
  projectHost:new URL(origin).hostname,userId:id(1),tagIds:[id(2),id(3)],
  memoIds:['a7d08104-f2ef-48e0-9cd2-7378b9ec8363',id(4)],
  requestIds:['241be954-fceb-462e-920f-82c189639910',id(5),id(6),id(7)],startedAt:'2026-01-01T00:00:00Z'};
const result=(action)=>({runId:run.runId,action,status:'passed',tagIds:[...run.tagIds],memoIds:[...run.memoIds],completedAt:'2026-01-01T00:00:01Z'});
const records={identity:run,used:{...result('tag-used'),usedTagCount:0,unusedTagCount:null},
  unused:{...result('tag-unused'),usedTagCount:0,unusedTagCount:0},
  failure:{...result('failure'),status:'failed',stage:'スナップショット取得',completedAt:'2026-01-01T00:00:02Z'}};
function fixture(){
  return {memos:[{id:run.memoIds[0],user_id:run.userId,revision:1,last_request_id:run.requestIds[0],deleted_at:null,pinned_at:null,
    title:`DBTEST-USAGE-1-${run.runId}`,body:`tag usage test 1 ${run.runId}`,created_at:'2026-10-21T00:00:00Z',updated_at:'2026-10-21T00:00:00Z'}],
    tags:usageNames(run.runId).map((name,i)=>({id:run.tagIds[i],user_id:run.userId,name,revision:1})),
    memoTags:[{user_id:run.userId,memo_id:run.memoIds[0],tag_id:run.tagIds[0]}]};
}
test('実行記録4ファイルの対応を読み取り専用で照合',()=>{
  assert.equal(validateUsageRecords(records,new URL(origin).hostname).runId,TARGET_RUN);
});
for(const mode of ['host','request','pass','failure'])test(`記録不一致 ${mode}は停止`,()=>{
  const r=structuredClone(records);
  if(mode==='request')r.identity.requestIds[0]=r.identity.requestIds[1];
  if(mode==='pass')r.used.status='failed';if(mode==='failure')r.failure.stage='other';
  assert.throws(()=>validateUsageRecords(r,mode==='host'?'invalid.example':new URL(origin).hostname),InspectionError);
});
test('期待現在状態を項目別PASS、本文・タグ名・認証情報を診断値に含めない',()=>{
  const checks=inspectUsageSnapshot(run,fixture());assert.ok(checks.every((c)=>c.passed));
  const serialized=JSON.stringify(checks);assert.ok(!serialized.includes('tag usage test'));assert.ok(!serialized.includes('DBTEST'));
  assert.ok(!serialized.includes(usageNames(run.runId)[0]));
});
for(const mode of ['missing','revision','request','deleted','pinned','title','body','dates','relation','tag-name','tag-revision','memo2','owner','orphan']){
  test(`差分 ${mode}は安全な項目名でFAIL`,()=>{
    const s=fixture();
    if(mode==='missing')s.memos=[];if(mode==='revision')s.memos[0].revision=2;
    if(mode==='request')s.memos[0].last_request_id='private-token';if(mode==='deleted')s.memos[0].deleted_at='2026-10-21T01:00:00Z';
    if(mode==='pinned')s.memos[0].pinned_at='2026-10-21T01:00:00Z';
    if(mode==='title')s.memos[0].title='private-title';if(mode==='body')s.memos[0].body='private-body';
    if(mode==='dates')s.memos[0].updated_at='2026-10-21T01:00:00Z';if(mode==='relation')s.memoTags=[];
    if(mode==='tag-name')s.tags[0].name='private-name';if(mode==='tag-revision')s.tags[0].revision=2;
    if(mode==='memo2')s.memos.push({...s.memos[0],id:run.memoIds[1]});if(mode==='owner')s.memos[0].user_id='private-owner';
    if(mode==='orphan')s.memoTags.push({user_id:run.userId,memo_id:'absent',tag_id:run.tagIds[0]});
    const checks=inspectUsageSnapshot(run,s);assert.ok(checks.some((c)=>!c.passed));assert.ok(!JSON.stringify(checks).includes('private'));
  });
}
test('取得形式不正は取得後検証エラー',()=>{assert.throws(()=>inspectUsageSnapshot(run,null),(e)=>e.phase==='取得後検証');});
for(const mode of ['login','snapshot','network','timeout','http','body','json']){
  test(`通信段階 ${mode}を区別・1回のみ`,async()=>{
    let count=0;
    const action=()=>inspectionRequest(origin,'private-key',mode==='login'?'login':'snapshot',
      {email:'private-email',password:'private-password',token:'private-token'},async(url,options)=>{
        count++;assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
        if(mode==='login')assert.ok(url.endsWith('/auth/v1/token?grant_type=password'));
        else{assert.ok(url.endsWith('/rest/v1/rpc/memo_load_snapshot'));assert.equal(options.body,'{}');}
        if(mode==='network')throw Object.assign(new TypeError('private-error'),{cause:{code:'ECONNRESET'}});
        if(mode==='timeout')throw new DOMException('private-error','TimeoutError');
        return {status:mode==='http'?503:200,text:async()=>{
          if(mode==='body')throw new TypeError('private-error');return mode==='json'?'private-not-json':'{}';
        }};
      });
    if(['login','snapshot'].includes(mode))assert.deepEqual(await action(),{});
    else await assert.rejects(action(),(e)=>{
      const phase={network:'fetch通信',timeout:'fetch通信',http:'HTTP応答',body:'応答本文受信',json:'JSON解析'}[mode];
      assert.equal(e.phase,phase);assert.ok(!JSON.stringify(e).includes('private'));return true;
    });
    assert.equal(count,1);
  });
}
test('本番/任意RPCをfetch前に拒否',async()=>{
  let count=0;const f=()=>{count++;throw new Error('forbidden');};
  await assert.rejects(inspectionRequest('https://production.example','key','snapshot',{token:'x'},f));
  await assert.rejects(inspectionRequest(origin,'key','memo_save',{token:'x'},f));
  await assert.rejects(inspectionRequest(origin,'key','snapshot',{},f));assert.equal(count,0);
});
