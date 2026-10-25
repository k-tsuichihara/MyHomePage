import {compareSnapshots} from './snapshot-comparison.mjs';
import {isDeepStrictEqual as equal} from 'node:util';
import {UsageDiagnostic} from './tag-usage-diagnostics.mjs';
const check=(v,item='condition')=>{if(!v)throw new UsageDiagnostic('取得後検証',item);};
const same=compareSnapshots;
function micros(v){
  check(typeof v==='string'&&Number.isFinite(Date.parse(v)));
  const m=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  check(m);return BigInt(Date.parse(`${m[1]}${m[3]}`))*1000n+BigInt((m[2]??'').padEnd(6,'0'));
}
export function usageNames(runId){check(/^[0-9a-f-]{36}$/.test(runId));return ['A','U'].map((s)=>`T17${s}-${runId.replaceAll('-','').slice(0,24)}`);}
export function tagUsage(snapshot,userId){
  check(snapshot&&['memos','tags','memoTags'].every((k)=>Array.isArray(snapshot[k])),'aggregate.snapshotShape');
  const memos=new Map(),counts=new Map(),links=new Set();
  for(const m of snapshot.memos){
    check(m&&typeof m.id==='string'&&m.user_id===userId&&!memos.has(m.id),'aggregate.memos.identityOwnerOrDuplicate');
    check(m.deleted_at===null||(typeof m.deleted_at==='string'&&Number.isFinite(Date.parse(m.deleted_at))),'aggregate.memos.deleted_at');memos.set(m.id,m);
  }
  for(const t of snapshot.tags){check(t&&typeof t.id==='string'&&t.user_id===userId&&!counts.has(t.id),'aggregate.tags.identityOwnerOrDuplicate');counts.set(t.id,0);}
  for(const r of snapshot.memoTags){
    check(r&&r.user_id===userId&&memos.has(r.memo_id)&&counts.has(r.tag_id),'aggregate.memoTags.ownerOrReferences');
    const pair=JSON.stringify([r.memo_id,r.tag_id]);check(!links.has(pair),'aggregate.memoTags.duplicate');links.add(pair);
    if(memos.get(r.memo_id).deleted_at===null)counts.set(r.tag_id,counts.get(r.tag_id)+1);
  }
  return counts;
}
export function verifyUsageCounts(counts,tagIds,used,hasUnused){
  if(counts.get(tagIds[0])!==used)throw new UsageDiagnostic('件数照合','counts.usedTag');
  if(hasUnused&&counts.get(tagIds[1])!==0)throw new UsageDiagnostic('件数照合','counts.unusedTag');
}
export async function runTagUsageCase({runId,tagIds,memoIds,requestIds,userId,rpc,confirm,progress=async()=>{},setStage=()=>{}}){
  check(tagIds.length===2&&memoIds.length===2&&requestIds.length===4
    &&new Set([...tagIds,...memoIds,...requestIds]).size===8);
  const names=usageNames(runId);
  const read=(label)=>{setStage(`${label}: スナップショット取得`);return rpc('memo_load_snapshot',{});};
  const before=await read('initial');setStage('initial: 取得後検証');same(before,before);tagUsage(before,userId);
  check(!before.memos.some((m)=>memoIds.includes(m.id))&&!before.tags.some((t)=>tagIds.includes(t.id)
    ||names.some((n)=>n.toLowerCase()===t.name.replace(/[A-Z]/g,(c)=>c.toLowerCase()))));
  const expected=structuredClone(before);
  const verify=async(label,used)=>{
    const s=await read(label);setStage(`${label}: 取得後検証`);same(s,expected);
    setStage(`${label}: 集計入力検証`);const counts=tagUsage(s,userId);
    setStage(`${label}: 件数照合`);verifyUsageCounts(counts,tagIds,used,expected.tags.some((t)=>t.id===tagIds[1]));
    await progress(label,{usedTagCount:used,unusedTagCount:expected.tags.some((t)=>t.id===tagIds[1])?0:null});
  };
  for(let i=0;i<2;i++){
    const label=i===0?'tag-used':'tag-unused',p={p_id:tagIds[i],p_name:names[i],p_expected_revision:null};
    check(await confirm(label,{id:p.p_id,expectedRevision:null}));setStage(label);
    const t=await rpc('memo_save_tag',p);
    check(t&&t.id===p.p_id&&t.name===p.p_name&&t.user_id===userId&&String(t.revision)==='1');micros(t.created_at);
    expected.tags.push(t);await verify(label,0);
  }
  for(let i=0;i<2;i++){
    const label=`memo-${i+1}`,p={p_id:memoIds[i],p_request_id:requestIds[i],p_expected_revision:null,
      p_title:`DBTEST-USAGE-${i+1}-${runId}`,p_body:`tag usage test ${i+1} ${runId}`,p_tag_ids:[tagIds[0]]};
    check(await confirm(label,{id:p.p_id,requestId:p.p_request_id,tagIds:p.p_tag_ids,expectedRevision:null}));setStage(label);
    const saved=await rpc('memo_save',p),m=saved?.memo;
    check(m&&m.id===p.p_id&&m.user_id===userId&&m.title===p.p_title&&m.body===p.p_body&&String(m.revision)==='1'
      &&m.last_request_id===p.p_request_id&&m.pinned_at===null&&m.deleted_at===null&&m.created_at===m.updated_at&&equal(saved.tagIds,[tagIds[0]]));micros(m.created_at);
    expected.memos.push(m);expected.memoTags.push({user_id:userId,memo_id:p.p_id,tag_id:tagIds[0]});await verify(label,i+1);
  }
  for(const [action,revision,index,used] of [['trash',2,2,1],['restore',3,3,2]]){
    const previous=expected.memos.find((m)=>m.id===memoIds[1]);
    const p={p_id:memoIds[1],p_request_id:requestIds[index],p_expected_revision:revision-1,p_action:action};
    check(await confirm(action,{id:p.p_id,requestId:p.p_request_id,expectedRevision:p.p_expected_revision,action}));setStage(action);
    const row=await rpc('memo_change_state',p);
    check(row&&String(row.revision)===String(revision)&&micros(row.updated_at)>micros(previous.updated_at)
      &&row.deleted_at===(action==='trash'?row.updated_at:null));
    check(equal(row,{...previous,revision:row.revision,updated_at:row.updated_at,deleted_at:row.deleted_at,last_request_id:p.p_request_id}));
    expected.memos=expected.memos.map((m)=>m.id===row.id?row:m);await verify(action,used);
  }
  return {usedTagCount:2,unusedTagCount:0,memosRetained:2,tagsRetained:2,relationsRetained:2,
    countSource:'local-aggregation-of-snapshot-no-server-count-api',stateRequestResolution:'not-verified-no-readonly-api'};
}
