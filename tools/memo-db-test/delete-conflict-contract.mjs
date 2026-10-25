import {isDeepStrictEqual as equal} from 'node:util';
import {compareTagDeleteSnapshots as same} from './tag-delete-contract.mjs';
import {UsageDiagnostic} from './tag-usage-diagnostics.mjs';
const check=(v,item)=>{if(!v)throw new UsageDiagnostic('取得後検証',item);};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function micros(v){
  check(typeof v==='string'&&Number.isFinite(Date.parse(v)),'timestamp');
  const m=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  check(m,'timestamp.format');return BigInt(Date.parse(`${m[1]}${m[3]}`))*1000n+BigInt((m[2]??'').padEnd(6,'0'));
}
export async function runDeleteConflictCase({runId,memoId,tagId,requestId,trashRequestId,userId,rpc,rejectDelete,confirm,progress=async()=>{},setStage=()=>{}}){
  const ids=[runId,memoId,tagId,requestId,trashRequestId];
  check(ids.every(id=>UUID.test(id))&&new Set(ids).size===ids.length&&UUID.test(userId),'input.ids');
  const name=`T25-${runId.replaceAll('-','').slice(0,24)}`;
  const read=async(label)=>{setStage(`${label}: スナップショット取得`);const s=await rpc('memo_load_snapshot',{});same(s,s);
    check([s.memos,s.tags,s.memoTags].every(rows=>rows.every(r=>r.user_id===userId)),'snapshot.owner');return s;};
  const expected=structuredClone(await read('initial'));
  check(!expected.memos.some(m=>m.id===memoId)&&!expected.tags.some(t=>t.id===tagId||t.name.replace(/[A-Z]/g,c=>c.toLowerCase())===name.toLowerCase()),'input.collision');
  const verify=async(label)=>{const s=await read(label);setStage(`${label}: 全フィールド比較`);same(s,expected);return s;};
  check(await confirm('tag',{id:tagId,expectedRevision:null,operation:'create-tag',impact:'one-new-dedicated-tag'}),'confirmation');setStage('専用タグ作成');
  const tag=await rpc('memo_save_tag',{p_id:tagId,p_name:name,p_expected_revision:null});
  check(tag?.id===tagId&&tag.user_id===userId&&tag.name===name&&String(tag.revision)==='1','tag.response');micros(tag.created_at);
  expected.tags.push(tag);await verify('tag');await progress('tag',{revision:1});
  const payload={p_id:memoId,p_request_id:requestId,p_expected_revision:null,p_title:`DBTEST-DELETE-CONFLICT-${runId}`,p_body:`delete conflict test ${runId}`,p_tag_ids:[tagId]};
  check(await confirm('create',{id:memoId,requestId,expectedRevision:null,tagIds:[tagId],operation:'create-memo',impact:'one-new-dedicated-memo-and-link'}),'confirmation');setStage('専用メモ作成');
  const saved=await rpc('memo_save',payload),m=saved?.memo;
  check(m&&m.id===memoId&&m.user_id===userId&&m.title===payload.p_title&&m.body===payload.p_body
    &&String(m.revision)==='1'&&m.last_request_id===requestId&&m.deleted_at===null&&m.pinned_at===null
    &&m.created_at===m.updated_at&&equal(saved.tagIds,[tagId]),'create.response');micros(m.created_at);
  expected.memos.push(m);expected.memoTags.push({user_id:userId,memo_id:memoId,tag_id:tagId});await verify('create');await progress('create',{revision:1});
  check(await confirm('trash',{id:memoId,requestId:trashRequestId,expectedRevision:1,operation:'trash',impact:'dedicated-memo-only'}),'confirmation');setStage('ゴミ箱移動');
  const trash=await rpc('memo_change_state',{p_id:memoId,p_expected_revision:1,p_request_id:trashRequestId,p_action:'trash'});
  check(trash&&String(trash.revision)==='2'&&micros(trash.updated_at)>micros(m.updated_at)
    &&equal(trash,{...m,revision:trash.revision,updated_at:trash.updated_at,deleted_at:trash.updated_at,last_request_id:trashRequestId}),'trash.response');
  expected.memos=expected.memos.map(r=>r.id===memoId?trash:r);await verify('trash');await progress('trash',{revision:2,deleted:true});
  check(await confirm('delete-conflict',{id:memoId,expectedRevision:1,currentRevision:2,operation:'delete-permanently-stale-revision',impact:'unexpected-success-would-delete-dedicated-memo-and-link'}),'confirmation');
  // Re-read AFTER interactive confirmation. Baseline is held only in memory, never logged.
  const before=structuredClone(await verify('immediately-before-delete'));
  const rows=before.memos.filter(r=>r.id===memoId),row=rows[0];
  check(rows.length===1&&row.user_id===userId&&String(row.revision)==='2'&&row.deleted_at!==null&&row.last_request_id===trashRequestId,'delete.preconditions');
  micros(row.deleted_at);
  setStage('古いrevisionによる完全削除要求');
  const receipt=await rejectDelete({p_id:memoId,p_expected_revision:1});
  check(equal(receipt,{httpStatus:409,code:'PT409',messageMatched:true}),'delete.expectedRejection');
  const after=await read('after-rejection');setStage('拒否後の全フィールド比較');same(after,before);
  const retained=after.memos.filter(r=>r.id===memoId);
  check(retained.length===1&&retained[0].deleted_at!==null&&String(retained[0].revision)==='2','delete.retained');
  await progress('delete-conflict',{httpStatus:409,code:'PT409',messageMatched:true,preconditionsVerified:true,allDataUnchanged:true,revision:2,deleted:true});
  return {memosRetained:1,tagsRetained:1,relationsRetained:1,revision:2,deleted:true,allDataUnchanged:true,
    internalRequestLedger:'not-directly-verified',causeAssessment:'preconditions-and-response-combined-not-message-alone',rpcMaximum:10,confirmations:4};
}
export function deleteConflictResponse(origin,key,token,fetchImpl=fetch){
  return async payload=>{
    check(origin==='https://yohoppqflnhhvqypwhfv.supabase.co'&&/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)&&typeof token==='string'&&token.length>0,'connection');
    check(payload&&UUID.test(payload.p_id)&&equal(Object.keys(payload).sort(),['p_expected_revision','p_id'])&&payload.p_expected_revision===1,'delete.arguments');
    let response;try{response=await fetchImpl(`${origin}/rest/v1/rpc/memo_delete_permanently`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw new UsageDiagnostic('fetch通信','delete-conflict');}
    if(response.status!==409){try{await response.body?.cancel();}catch{}throw new UsageDiagnostic('HTTP応答','delete-conflict',response.status);}
    let text;try{text=await response.text();}catch{throw new UsageDiagnostic('応答本文受信','delete-conflict',409);}
    let error;try{error=JSON.parse(text);}catch{throw new UsageDiagnostic('JSON解析','delete-conflict',409);}
    check(error&&typeof error==='object'&&!Array.isArray(error)&&error.code==='PT409'&&error.message==='not found or revision conflict','delete.errorContract');
    return {httpStatus:409,code:'PT409',messageMatched:true};
  };
}
