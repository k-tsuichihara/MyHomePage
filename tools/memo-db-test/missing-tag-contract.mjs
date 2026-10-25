import {compareSnapshots} from './snapshot-comparison.mjs';
import {isDeepStrictEqual as equal} from 'node:util';
const check=(v)=>{if(!v)throw new Error('verification failed');};
const same=compareSnapshots;
export function missingTagName(runId){
  check(/^[0-9a-f-]{36}$/.test(runId));return `T16A-${runId.replaceAll('-','').slice(0,24)}`;
}
export async function runMissingTagCase({base,updateRequestId,tagId,missingTagId,tagName,userId,rpc,rejectSave,
  confirm,progress=async()=>{},setStage=()=>{}}){
  const ids=[base.p_id,base.p_request_id,updateRequestId,tagId,missingTagId];
  check(ids.every((id)=>typeof id==='string'&&id.length>0)&&new Set(ids).size===5
    &&base.p_expected_revision===null&&equal(base.p_tag_ids,[tagId])&&/^[A-Za-z0-9-]{1,30}$/.test(tagName));
  const snapshot=()=>{setStage('スナップショット取得');return rpc('memo_load_snapshot',{});};
  const before=await snapshot();same(before,before);
  check(!before.memos.some((m)=>m.id===base.p_id)&&!before.tags.some((t)=>[tagId,missingTagId].includes(t.id)
    ||t.name.replace(/[A-Z]/g,(c)=>c.toLowerCase())===tagName.toLowerCase()));
  check(await confirm('tag',{id:tagId,expectedRevision:null}));setStage('専用タグ作成');
  const tag=await rpc('memo_save_tag',{p_id:tagId,p_name:tagName,p_expected_revision:null});
  check(tag&&tag.id===tagId&&tag.user_id===userId&&tag.name===tagName&&String(tag.revision)==='1'
    &&typeof tag.created_at==='string'&&Number.isFinite(Date.parse(tag.created_at)));
  const expected={...structuredClone(before),tags:[...before.tags,tag]};
  same(await snapshot(),expected);await progress('tag',{revision:1});
  check(await confirm('create',{id:base.p_id,requestId:base.p_request_id,tagIds:[tagId],expectedRevision:null}));setStage('専用メモ作成');
  const saved=await rpc('memo_save',base),m=saved?.memo;
  check(m&&m.id===base.p_id&&m.user_id===userId&&m.title===base.p_title&&m.body===base.p_body
    &&String(m.revision)==='1'&&m.last_request_id===base.p_request_id&&m.pinned_at===null&&m.deleted_at===null
    &&typeof m.created_at==='string'&&Number.isFinite(Date.parse(m.created_at))&&m.created_at===m.updated_at&&equal(saved.tagIds,[tagId]));
  expected.memos.push(m);expected.memoTags.push({user_id:userId,memo_id:base.p_id,tag_id:tagId});
  const baseline=await snapshot();same(baseline,expected);
  check(!baseline.tags.some((t)=>t.id===missingTagId));await progress('create',{revision:1,linkedTagCount:1});
  const submitted={...base,p_request_id:updateRequestId,p_expected_revision:1,
    p_body:`${base.p_body}\nrejected missing-tag update ${updateRequestId}`,p_tag_ids:[missingTagId]};
  check(submitted.p_body!==m.body&&!equal(submitted.p_tag_ids,base.p_tag_ids));
  const frozen=JSON.stringify(submitted);
  check(await confirm('reject-update',{id:base.p_id,requestId:updateRequestId,missingTagId,expectedRevision:1}));setStage('存在しないタグで更新試行');
  const response=await rejectSave(JSON.parse(frozen));
  check(response.status===400&&response.codeMatches===true&&response.messageMatches===true);
  same(await snapshot(),baseline);
  setStage('作成要求照合');const creation=await rpc('memo_resolve_request',base);
  check(creation?.status==='saved'&&equal(creation.result,saved));
  setStage('拒否された保存要求照合');check(await rpc('memo_resolve_request',JSON.parse(frozen))===null);
  await progress('reject-update',{revision:1,linkedTagCount:1,httpStatus:400,code:'22023',messageMatched:true,allDataUnchanged:true});
  return {revision:1,tagsRetained:1,linkedTagCount:1,allDataUnchanged:true,
    rejectedSaveResolution:'null-not-proof-of-non-execution',missingTagScope:'absent-from-own-snapshot-not-global-catalog-proof',
    rollbackScope:'rejected-before-writes-not-mid-transaction-rollback-proof'};
}
export async function missingTagResponse(url,headers,payload,fetchImpl=fetch){
  const response=await fetchImpl(url,{method:'POST',headers,body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(response.status!==400){try{await response.body?.cancel();}catch{}throw new Error('unexpected HTTP');}
  const data=await response.json();return {status:400,codeMatches:data?.code==='22023',messageMatches:data?.message==='unknown tag'};
}
