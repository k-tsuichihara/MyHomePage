import {isDeepStrictEqual as equal} from 'node:util';
import {compareTagDeleteSnapshots as same} from './tag-delete-contract.mjs';
import {UsageDiagnostic} from './tag-usage-diagnostics.mjs';
const check=(v,item)=>{if(!v)throw new UsageDiagnostic('取得後検証',item);};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function case26Source(identity,result){
  const keys=['version','test','runId','tagId','memoIds','requestIds','trashRequestIds','userId','projectHost','startedAt'];
  check(identity?.test==='empty-trash-conflict-read'&&identity.status==='prepared'&&result?.status==='passed'
    &&keys.every(k=>equal(identity[k],result[k]))&&identity.projectHost==='yohoppqflnhhvqypwhfv.supabase.co'
    &&result.allDataUnchanged===true&&equal(result.revisions,[2,2])&&result.memosRetained===2&&result.tagsRetained===1&&result.relationsRetained===2,'case26.records');
  check(UUID.test(identity.runId)&&UUID.test(identity.userId)&&UUID.test(identity.tagId)
    &&['memoIds','requestIds','trashRequestIds'].every(k=>Array.isArray(identity[k])&&identity[k].length===2&&identity[k].every(id=>UUID.test(id)))
    &&new Set([identity.tagId,...identity.memoIds,...identity.requestIds,...identity.trashRequestIds]).size===7,'case26.ids');
  return structuredClone({runId:identity.runId,userId:identity.userId,tagId:identity.tagId,memoIds:identity.memoIds,trashRequestIds:identity.trashRequestIds});
}
export function verifyCase26Snapshot(s,source,userId){
  check(userId===source.userId,'case26.authenticatedUser');
  same(s,s);
  for(let i=0;i<2;i++){
    const rows=s.memos.filter(m=>m.id===source.memoIds[i]),m=rows[0];
    check(rows.length===1&&m.user_id===userId&&String(m.revision)==='2'&&m.deleted_at!==null&&m.pinned_at===null
      &&m.last_request_id===source.trashRequestIds[i],'case26.memo');micros(m.deleted_at);
    check(equal(s.memoTags.filter(r=>r.memo_id===m.id),[{user_id:userId,memo_id:m.id,tag_id:source.tagId}]),'case26.link');
  }
  const tags=s.tags.filter(t=>t.id===source.tagId);
  check(tags.length===1&&tags[0].user_id===userId&&String(tags[0].revision)==='1','case26.tag');
}
function micros(v){
  check(typeof v==='string'&&Number.isFinite(Date.parse(v)),'timestamp');
  const m=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  check(m,'timestamp.format');return BigInt(Date.parse(`${m[1]}${m[3]}`))*1000n+BigInt((m[2]??'').padEnd(6,'0'));
}
export async function runDeletedReplayCase({runId,memoId,tagId,requestId,trashRequestId,userId,protectedRun,rpc,saveFrozen,confirm,progress=async()=>{},setStage=()=>{}}){
  const ids=[runId,memoId,tagId,requestId,trashRequestId];
  check(ids.every(id=>UUID.test(id))&&new Set(ids).size===ids.length&&UUID.test(userId),'input.ids');
  const name=`T27-${runId.replaceAll('-','').slice(0,24)}`;
  // Serialize once; both actual HTTP saves use this exact immutable string.
  const frozen=JSON.stringify({p_id:memoId,p_request_id:requestId,p_expected_revision:null,
    p_title:`DBTEST-DELETED-REPLAY-${runId}`,p_body:`deleted replay test ${runId}`,p_tag_ids:[tagId]});
  const read=async(label)=>{setStage(`${label}: スナップショット取得`);const s=await rpc('memo_load_snapshot',{});same(s,s);
    check([s.memos,s.tags,s.memoTags].every(rows=>rows.every(r=>r.user_id===userId)),'snapshot.owner');return s;};
  const expected=structuredClone(await read('initial'));
  const baseline=structuredClone(expected);
  if(protectedRun)verifyCase26Snapshot(baseline,protectedRun,userId);
  check(!expected.memos.some(m=>m.id===memoId)&&!expected.tags.some(t=>t.id===tagId||t.name.replace(/[A-Z]/g,c=>c.toLowerCase())===name.toLowerCase()),'input.collision');
  const verify=async(label)=>{const s=await read(label);setStage(`${label}: 全フィールド比較`);same(s,expected);};
  check(await confirm('tag',{id:tagId,requestId:null,expectedRevision:null,operation:'create-tag',impact:'one-new-dedicated-tag'}),'confirmation');setStage('専用タグ作成');
  const tag=await rpc('memo_save_tag',{p_id:tagId,p_name:name,p_expected_revision:null});
  check(tag?.id===tagId&&tag.user_id===userId&&tag.name===name&&String(tag.revision)==='1','tag.response');micros(tag.created_at);
  expected.tags.push(tag);await verify('tag');await progress('tag',{revision:1});
  check(await confirm('create',{id:memoId,requestId,expectedRevision:null,tagIds:[tagId],operation:'create-memo',impact:'one-new-dedicated-memo-and-link'}),'confirmation');setStage('専用メモ作成');
  const saved=await saveFrozen(frozen),m=saved?.memo;
  check(m&&m.id===memoId&&m.user_id===userId&&m.title===JSON.parse(frozen).p_title&&m.body===JSON.parse(frozen).p_body
    &&String(m.revision)==='1'&&m.last_request_id===requestId&&m.deleted_at===null&&m.pinned_at===null
    &&m.created_at===m.updated_at&&equal(saved.tagIds,[tagId]),'create.response');micros(m.created_at);
  expected.memos.push(m);expected.memoTags.push({user_id:userId,memo_id:memoId,tag_id:tagId});await verify('create');await progress('create',{revision:1});
  check(await confirm('trash',{id:memoId,requestId:trashRequestId,expectedRevision:1,operation:'trash',impact:'dedicated-memo-only'}),'confirmation');setStage('ゴミ箱移動');
  const trash=await rpc('memo_change_state',{p_id:memoId,p_expected_revision:1,p_request_id:trashRequestId,p_action:'trash'});
  check(trash&&String(trash.revision)==='2'&&micros(trash.updated_at)>micros(m.updated_at)
    &&equal(trash,{...m,revision:trash.revision,updated_at:trash.updated_at,deleted_at:trash.updated_at,last_request_id:trashRequestId}),'trash.response');
  expected.memos=expected.memos.map(r=>r.id===memoId?trash:r);await verify('trash-before-delete');await progress('trash',{revision:2,deleted:true});
  check(await confirm('delete',{id:memoId,requestId:null,expectedRevision:2,operation:'delete-permanently',impact:'dedicated-memo-and-link-removed-tag-retained'}),'confirmation');setStage('個別完全削除');
  const receipt=await rpc('memo_delete_permanently',{p_id:memoId,p_expected_revision:trash.revision});
  check(receipt===null,'delete.voidReceipt');
  expected.memos=expected.memos.filter(r=>r.id!==memoId);expected.memoTags=expected.memoTags.filter(r=>r.memo_id!==memoId);
  await verify('delete');await progress('delete',{memoAbsent:true,linkAbsent:true,tagRetained:true,otherDataUnchanged:true});
  check(await confirm('replay',{id:memoId,requestId,expectedRevision:null,operation:'replay-original-save-once',impact:'unexpected-success-may-resurrect-dedicated-memo-and-link'}),'confirmation');
  const before=structuredClone(await read('immediately-before-replay'));same(before,expected);
  setStage('元保存要求の意図的リプレイ');
  const replay=await saveFrozen(frozen);
  check(equal(replay,{status:'previously-applied-deleted'}),'replay.deletedReceipt');
  const after=await read('after-replay');setStage('リプレイ後全フィールド比較');same(after,before);
  check(!after.memos.some(r=>r.id===memoId)&&!after.memoTags.some(r=>r.memo_id===memoId)
    &&after.tags.filter(r=>r.id===tagId).length===1,'replay.noResurrection');
  same(after,{...baseline,tags:[...baseline.tags,tag]});
  if(protectedRun)verifyCase26Snapshot(after,protectedRun,userId);
  await progress('replay',{deletedReceipt:true,allDataUnchanged:true,memoAbsent:true,linkAbsent:true,tagRetained:true});
  return {memosRetained:0,tagsRetained:1,relationsRetained:0,revisionBeforeDelete:2,deletedReceipt:true,allDataUnchanged:true,
    existingDataUnchanged:true,baselineCounts:{memos:baseline.memos.length,tags:baseline.tags.length,memoTags:baseline.memoTags.length},
    finalCounts:{memos:after.memos.length,tags:after.tags.length,memoTags:after.memoTags.length},
    internalRequestLedger:'not-directly-verified',rpcMaximum:12,confirmations:5};
}
// Raw immutable JSON is passed to fetch unchanged on both sends.
export function frozenSaveRpc(origin,key,token,fetchImpl=fetch){
  return async body=>{
    check(origin==='https://yohoppqflnhhvqypwhfv.supabase.co'&&/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)&&typeof token==='string'&&token.length>0,'connection');
    check(typeof body==='string','save.body');
    let response;try{response=await fetchImpl(`${origin}/rest/v1/rpc/memo_save`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body,redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw new UsageDiagnostic('fetch通信','frozen-save');}
    if(response.status!==200){try{await response.body?.cancel();}catch{}throw new UsageDiagnostic('HTTP応答','frozen-save',response.status);}
    let text;try{text=await response.text();}catch{throw new UsageDiagnostic('応答本文受信','frozen-save',200);}
    try{return JSON.parse(text);}catch{throw new UsageDiagnostic('JSON解析','frozen-save',200);}
  };
}
