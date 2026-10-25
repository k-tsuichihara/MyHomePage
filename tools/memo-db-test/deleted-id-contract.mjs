import {isDeepStrictEqual as equal} from 'node:util';
import {compareTagDeleteSnapshots as same} from './tag-delete-contract.mjs';
import {UsageDiagnostic} from './tag-usage-diagnostics.mjs';
const check=(v,item)=>{if(!v)throw new UsageDiagnostic('取得後検証',item);};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import {verifyCase26Snapshot} from './deleted-replay-contract.mjs';
export function case27Source(identity,result,source26){
  const keys=['version','test','runId','memoId','tagId','requestId','trashRequestId','userId','sourceRunId','projectHost','startedAt'];
  check(identity?.test==='deleted-replay-read'&&identity.status==='prepared'&&result?.status==='passed'
    &&keys.every(k=>equal(identity[k],result[k]))&&identity.projectHost==='yohoppqflnhhvqypwhfv.supabase.co'
    &&identity.sourceRunId===source26.runId&&identity.userId===source26.userId
    &&result.existingDataUnchanged===true&&result.allDataUnchanged===true&&result.deletedReceipt===true
    &&result.memosRetained===0&&result.tagsRetained===1&&result.relationsRetained===0,'case27.records');
  check(['runId','memoId','tagId','requestId','trashRequestId','userId'].every(k=>UUID.test(identity[k]))
    &&identity.tagId!==source26.tagId&&!source26.memoIds.includes(identity.memoId),'case27.ids');
  return {runId:identity.runId,userId:identity.userId,memoId:identity.memoId,tagId:identity.tagId};
}
export function verifyProtectedSnapshots(s,source26,source27,userId){
  verifyCase26Snapshot(s,source26,userId);
  check(source27?.userId===userId,'case27.user');
  const tags=s.tags.filter(t=>t.id===source27.tagId);
  check(tags.length===1&&tags[0].user_id===userId&&String(tags[0].revision)==='1','case27.tag');
  check(!s.memos.some(m=>m.id===source27.memoId)&&!s.memoTags.some(r=>r.memo_id===source27.memoId),'case27.deletedMemo');
}
function micros(v){
  check(typeof v==='string'&&Number.isFinite(Date.parse(v)),'timestamp');
  const m=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  check(m,'timestamp.format');return BigInt(Date.parse(`${m[1]}${m[3]}`))*1000n+BigInt((m[2]??'').padEnd(6,'0'));
}
export async function runDeletedIdCase({runId,memoId,tagId,requestId,trashRequestId,recreateRequestId,userId,protectedRun,protected27,rpc,saveFrozen,rejectCreate,confirm,progress=async()=>{},setStage=()=>{}}){
  const ids=[runId,memoId,tagId,requestId,trashRequestId,recreateRequestId];
  check(ids.every(id=>UUID.test(id))&&new Set(ids).size===ids.length&&UUID.test(userId),'input.ids');
  const name=`T28-${runId.replaceAll('-','').slice(0,24)}`;
  // Retain the original valid creation payload; recreation changes only requestId.
  const frozen=JSON.stringify({p_id:memoId,p_request_id:requestId,p_expected_revision:null,
    p_title:`DBTEST-DELETED-ID-${runId}`,p_body:`deleted id test ${runId}`,p_tag_ids:[tagId]});
  const read=async(label)=>{setStage(`${label}: スナップショット取得`);const s=await rpc('memo_load_snapshot',{});same(s,s);
    check([s.memos,s.tags,s.memoTags].every(rows=>rows.every(r=>r.user_id===userId)),'snapshot.owner');return s;};
  const expected=structuredClone(await read('initial'));
  const baseline=structuredClone(expected);
  verifyProtectedSnapshots(baseline,protectedRun,protected27,userId);
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
  check(await confirm('recreate',{id:memoId,requestId:recreateRequestId,originalRequestId:requestId,expectedRevision:null,operation:'recreate-deleted-id-once',impact:'unexpected-success-may-resurrect-dedicated-memo-and-link'}),'confirmation');
  const before=structuredClone(await read('immediately-before-recreate'));same(before,expected);
  check(!before.memos.some(r=>r.id===memoId)&&!before.memoTags.some(r=>r.memo_id===memoId),'recreate.deletedPrecondition');
  setStage('別requestIdによる再作成要求');
  const submitted={...JSON.parse(frozen),p_request_id:recreateRequestId};
  const rejected=await rejectCreate(submitted);
  check(equal(rejected,{httpStatus:409,code:'PT409',messageMatched:true}),'recreate.expectedRejection');
  const after=await read('after-recreate');setStage('再作成拒否後全フィールド比較');same(after,before);
  same(after,{...baseline,tags:[...baseline.tags,tag]});
  verifyProtectedSnapshots(after,protectedRun,protected27,userId);
  check(!after.memos.some(r=>r.id===memoId)&&!after.memoTags.some(r=>r.memo_id===memoId)&&after.tags.filter(r=>r.id===tagId).length===1,'recreate.noResurrection');
  await progress('recreate',{httpStatus:409,code:'PT409',messageMatched:true,allDataUnchanged:true,memoAbsent:true,linkAbsent:true,tagRetained:true});
  return {memosRetained:0,tagsRetained:1,relationsRetained:0,existingDataUnchanged:true,
    baselineCounts:{memos:baseline.memos.length,tags:baseline.tags.length,memoTags:baseline.memoTags.length},
    finalCounts:{memos:after.memos.length,tags:after.tags.length,memoTags:after.memoTags.length},
    internalRegistryAndLedger:'not-directly-verified',rpcMaximum:12,confirmations:5};
}
export function deletedIdRejection(origin,key,token,fetchImpl=fetch){
  return async payload=>{
    check(origin==='https://yohoppqflnhhvqypwhfv.supabase.co'&&/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)&&typeof token==='string'&&token.length>0,'connection');
    check(payload&&UUID.test(payload.p_id)&&UUID.test(payload.p_request_id)&&payload.p_expected_revision===null
      &&typeof payload.p_title==='string'&&typeof payload.p_body==='string'&&Array.isArray(payload.p_tag_ids)&&payload.p_tag_ids.length===1&&UUID.test(payload.p_tag_ids[0]),'recreate.arguments');
    let r;try{r=await fetchImpl(`${origin}/rest/v1/rpc/memo_save`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw new UsageDiagnostic('fetch通信','deleted-id');}
    if(r.status!==409){try{await r.body?.cancel();}catch{}throw new UsageDiagnostic('HTTP応答','deleted-id',r.status);}
    let text;try{text=await r.text();}catch{throw new UsageDiagnostic('応答本文受信','deleted-id',409);}
    let e;try{e=JSON.parse(text);}catch{throw new UsageDiagnostic('JSON解析','deleted-id',409);}
    check(e&&typeof e==='object'&&!Array.isArray(e)&&e.code==='PT409'&&e.message==='previously used memo id','recreate.errorContract');
    return {httpStatus:409,code:'PT409',messageMatched:true};
  };
}
