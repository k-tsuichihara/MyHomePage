import {isDeepStrictEqual as equal} from 'node:util';
import {compareTagDeleteSnapshots as same} from './tag-delete-contract.mjs';
import {permanentDeleteRpc} from './permanent-delete-contract.mjs';
import {UsageDiagnostic} from './tag-usage-diagnostics.mjs';
const check=(v,item)=>{if(!v)throw new UsageDiagnostic('取得後検証',item);};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function verifyDedicatedUser(expected,actual,recordedIds){
  check(UUID.test(expected)&&UUID.test(actual)&&expected.toLowerCase()===actual.toLowerCase(),'dedicatedUser.match');
  check(recordedIds instanceof Set&&!recordedIds.has(actual.toLowerCase()),'dedicatedUser.previouslyRecorded');
}
function micros(v){
  check(typeof v==='string'&&Number.isFinite(Date.parse(v)),'timestamp');
  const m=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  check(m,'timestamp.format');return BigInt(Date.parse(`${m[1]}${m[3]}`))*1000n+BigInt((m[2]??'').padEnd(6,'0'));
}
export async function runEmptyTrashConflictCase({runId,tagId,memoIds,requestIds,trashRequestIds,userId,expectedUserId,recordedIds,rpc,rejectEmpty,confirm,progress=async()=>{},setStage=()=>{}}){
  verifyDedicatedUser(expectedUserId,userId,recordedIds);
  check(memoIds?.length===2&&requestIds?.length===2&&trashRequestIds?.length===2,'input.lengths');
  const ids=[runId,tagId,...memoIds,...requestIds,...trashRequestIds];
  check(ids.every(id=>UUID.test(id))&&new Set(ids).size===ids.length,'input.ids');
  const read=async label=>{setStage(`${label}: スナップショット取得`);const s=await rpc('memo_load_snapshot',{});same(s,s);
    check([s.memos,s.tags,s.memoTags].every(rows=>rows.every(r=>r.user_id===userId)),'snapshot.owner');return s;};
  const expected=structuredClone(await read('initial'));
  check(expected.memos.length===0&&expected.tags.length===0&&expected.memoTags.length===0,'initial.mustBeCompletelyEmpty');
  const verify=async label=>{const s=await read(label);setStage(`${label}: 全フィールド比較`);same(s,expected);return s;};
  check(await confirm('tag',{id:tagId,expectedRevision:null,impact:'one-new-dedicated-tag'}),'confirmation');setStage('専用タグ作成');
  const name=`T26-${runId.replaceAll('-','').slice(0,24)}`,tag=await rpc('memo_save_tag',{p_id:tagId,p_name:name,p_expected_revision:null});
  check(tag?.id===tagId&&tag.user_id===userId&&tag.name===name&&String(tag.revision)==='1','tag.response');micros(tag.created_at);
  expected.tags.push(tag);await verify('tag');await progress('tag',{revision:1});
  for(let i=0;i<2;i++){
    const p={p_id:memoIds[i],p_request_id:requestIds[i],p_expected_revision:null,p_title:`DBTEST-EMPTY-CONFLICT-${i}-${runId}`,p_body:`empty trash conflict ${i} ${runId}`,p_tag_ids:[tagId]};
    check(await confirm(`create-${i}`,{id:p.p_id,requestId:p.p_request_id,expectedRevision:null,impact:'one-new-dedicated-memo-and-link'}),'confirmation');setStage(`専用メモ${i}作成`);
    const saved=await rpc('memo_save',p),m=saved?.memo;
    check(m&&m.id===p.p_id&&m.user_id===userId&&m.title===p.p_title&&m.body===p.p_body&&String(m.revision)==='1'&&m.last_request_id===p.p_request_id
      &&m.deleted_at===null&&m.pinned_at===null&&m.created_at===m.updated_at&&equal(saved.tagIds,[tagId]),'create.response');micros(m.created_at);
    expected.memos.push(m);expected.memoTags.push({user_id:userId,memo_id:p.p_id,tag_id:tagId});await verify(`create-${i}`);await progress(`create-${i}`,{revision:1});
  }
  for(let i=0;i<2;i++){
    const old=expected.memos.find(m=>m.id===memoIds[i]);
    check(await confirm(`trash-${i}`,{id:old.id,requestId:trashRequestIds[i],expectedRevision:1,impact:'dedicated-memo-only'}),'confirmation');setStage(`ゴミ箱移動${i}`);
    const row=await rpc('memo_change_state',{p_id:old.id,p_expected_revision:1,p_request_id:trashRequestIds[i],p_action:'trash'});
    check(row&&String(row.revision)==='2'&&micros(row.updated_at)>micros(old.updated_at)
      &&equal(row,{...old,revision:row.revision,updated_at:row.updated_at,deleted_at:row.updated_at,last_request_id:trashRequestIds[i]}),'trash.response');
    expected.memos=expected.memos.map(m=>m.id===old.id?row:m);await verify(`trash-${i}`);await progress(`trash-${i}`,{revision:2,deleted:true});
  }
  check(await confirm('empty-conflict',{ids:memoIds,expectedRevisions:[2,1],currentRevisions:[2,2],impact:'unexpected-success-deletes-entire-user-trash'}),'confirmation');
  // No user interaction or file I/O between the final read/validation and bulk request.
  const before=structuredClone(await verify('immediately-before-empty'));
  check(before.memos.length===2&&before.tags.length===1&&before.memoTags.length===2,'empty.counts');
  check(equal(before.memos.filter(m=>m.deleted_at!==null).map(m=>m.id).sort(),[...memoIds].sort()),'empty.exactTrashIds');
  for(let i=0;i<2;i++){
    const m=before.memos.find(m=>m.id===memoIds[i]);
    check(m?.user_id===userId&&String(m.revision)==='2'&&m.deleted_at!==null&&m.last_request_id===trashRequestIds[i],'empty.preconditions');micros(m.deleted_at);
  }
  setStage('一括削除revision競合要求');
  const receipt=await rejectEmpty({p_ids:[...memoIds],p_revisions:[2,1]});
  check(equal(receipt,{httpStatus:409,code:'PT409',messageMatched:true}),'empty.expectedRejection');
  const after=await read('after-rejection');setStage('拒否後の全フィールド比較');same(after,before);
  check(after.memos.length===2&&after.memos.every(m=>m.deleted_at!==null&&String(m.revision)==='2')&&after.tags.length===1&&after.memoTags.length===2,'empty.retained');
  await progress('empty-conflict',{httpStatus:409,code:'PT409',messageMatched:true,exactTrashIdsVerified:true,allDataUnchanged:true});
  return {memosRetained:2,tagsRetained:1,relationsRetained:2,revisions:[2,2],allDataUnchanged:true,initialEmptyVerified:true,
    internalRequestLedger:'not-directly-verified',failureInjectionRollback:'not-tested-prevalidation-rejection-only',rpcMaximum:14,confirmations:6};
}
export function emptyTrashCaseRpc(origin,key,token,fetchImpl=fetch){
  const normal=permanentDeleteRpc(origin,key,token,fetchImpl);
  return (name,p)=>{check(['memo_load_snapshot','memo_save_tag','memo_save','memo_change_state'].includes(name),'rpc.allowlist');return normal(name,p);};
}
export function emptyTrashConflictResponse(origin,key,token,fetchImpl=fetch){
  return async p=>{
    check(origin==='https://yohoppqflnhhvqypwhfv.supabase.co'&&/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)&&typeof token==='string'&&token.length>0,'connection');
    check(p&&equal(Object.keys(p).sort(),['p_ids','p_revisions'])&&Array.isArray(p.p_ids)&&p.p_ids.length===2&&p.p_ids.every(id=>UUID.test(id))&&new Set(p.p_ids).size===2&&equal(p.p_revisions,[2,1]),'empty.arguments');
    let response;try{response=await fetchImpl(`${origin}/rest/v1/rpc/memo_empty_trash`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(p),redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw new UsageDiagnostic('fetch通信','empty-conflict');}
    if(response.status!==409){try{await response.body?.cancel();}catch{}throw new UsageDiagnostic('HTTP応答','empty-conflict',response.status);}
    let text;try{text=await response.text();}catch{throw new UsageDiagnostic('応答本文受信','empty-conflict',409);}
    let e;try{e=JSON.parse(text);}catch{throw new UsageDiagnostic('JSON解析','empty-conflict',409);}
    check(e&&typeof e==='object'&&!Array.isArray(e)&&e.code==='PT409'&&e.message==='trash revision conflict','empty.errorContract');
    return {httpStatus:409,code:'PT409',messageMatched:true};
  };
}
