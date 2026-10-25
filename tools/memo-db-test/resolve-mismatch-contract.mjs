import {isDeepStrictEqual as equal} from 'node:util';
import {compareTagDeleteSnapshots as same} from './tag-delete-contract.mjs';
import {UsageDiagnostic} from './tag-usage-diagnostics.mjs';
const check=(v,item)=>{if(!v)throw new UsageDiagnostic('取得後検証',item);};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import {verifyProtectedSnapshots} from './deleted-id-contract.mjs';
export function case28Source(identity,result,source26,source27){
  const keys=['version','test','runId','memoId','tagId','requestId','trashRequestId','recreateRequestId','userId','sourceRunId','source27RunId','projectHost','startedAt'];
  check(identity?.test==='deleted-id-read'&&identity.status==='prepared'&&result?.status==='passed'&&keys.every(k=>equal(identity[k],result[k]))
    &&identity.sourceRunId===source26.runId&&identity.source27RunId===source27.runId&&identity.userId===source26.userId&&identity.userId===source27.userId
    &&identity.projectHost==='yohoppqflnhhvqypwhfv.supabase.co'&&result.existingDataUnchanged===true
    &&result.memosRetained===0&&result.tagsRetained===1&&result.relationsRetained===0,'case28.records');
  check(['runId','memoId','tagId','requestId','trashRequestId','recreateRequestId','userId'].every(k=>UUID.test(identity[k]))
    &&![source26.tagId,source27.tagId].includes(identity.tagId)&&!source26.memoIds.includes(identity.memoId)&&identity.memoId!==source27.memoId,'case28.ids');
  return {runId:identity.runId,userId:identity.userId,memoId:identity.memoId,tagId:identity.tagId};
}
export function verifyExisting(s,a,b,c,userId){
  verifyProtectedSnapshots(s,a,b,userId);
  check(c?.userId===userId,'case28.user');const tags=s.tags.filter(t=>t.id===c.tagId);
  check(tags.length===1&&tags[0].user_id===userId&&String(tags[0].revision)==='1','case28.tag');
  check(!s.memos.some(m=>m.id===c.memoId)&&!s.memoTags.some(r=>r.memo_id===c.memoId),'case28.deletedMemo');
}
function micros(v){
  check(typeof v==='string'&&Number.isFinite(Date.parse(v)),'timestamp');
  const m=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  check(m,'timestamp.format');return BigInt(Date.parse(`${m[1]}${m[3]}`))*1000n+BigInt((m[2]??'').padEnd(6,'0'));
}
export async function runResolveMismatchCase({runId,memoId,tagId,requestId,userId,protectedRun,protected27,protected28,rpc,saveFrozen,rejectResolve,confirm,progress=async()=>{},setStage=()=>{}}){
  const ids=[runId,memoId,tagId,requestId];
  check(ids.every(id=>UUID.test(id))&&new Set(ids).size===ids.length&&UUID.test(userId),'input.ids');
  const name=`T29-${runId.replaceAll('-','').slice(0,24)}`;
  // Preserve all original arguments; mismatch changes only body, never requestId.
  const frozen=JSON.stringify({p_id:memoId,p_request_id:requestId,p_expected_revision:null,
    p_title:`DBTEST-RESOLVE-MISMATCH-${runId}`,p_body:`resolve mismatch test ${runId}`,p_tag_ids:[tagId]});
  const read=async(label)=>{setStage(`${label}: スナップショット取得`);const s=await rpc('memo_load_snapshot',{});same(s,s);
    check([s.memos,s.tags,s.memoTags].every(rows=>rows.every(r=>r.user_id===userId)),'snapshot.owner');return s;};
  const expected=structuredClone(await read('initial'));
  const baseline=structuredClone(expected);
  verifyExisting(baseline,protectedRun,protected27,protected28,userId);
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
  setStage('元保存要求の正常照合');
  const original=JSON.parse(frozen);
  check(equal(await rpc('memo_resolve_request',original),{status:'saved',result:saved}),'resolve.originalBefore');
  const before=structuredClone(await read('immediately-before-mismatch'));same(before,expected);
  const changed={...JSON.parse(frozen),p_body:original.p_body+' / mismatch'};
  check(changed.p_body!==original.p_body&&equal({...changed,p_body:original.p_body},original),'resolve.onlyBodyChanged');
  setStage('本文不一致の読み取り専用照合');
  check(equal(await rejectResolve(changed),{httpStatus:400,code:'22023',messageMatched:true}),'resolve.expectedRejection');
  const after=await read('after-mismatch');same(after,before);
  await progress('mismatch',{httpStatus:400,code:'22023',messageMatched:true,allDataUnchanged:true});
  setStage('元保存結果の再照合');
  check(equal(await rpc('memo_resolve_request',JSON.parse(frozen)),{status:'saved',result:saved}),'resolve.originalAfter');
  const final=await read('final');same(final,expected);verifyExisting(final,protectedRun,protected27,protected28,userId);
  await progress('original',{savedResultUnchanged:true,allDataUnchanged:true});
  return {memosRetained:1,tagsRetained:1,relationsRetained:1,existingDataUnchanged:true,savedResultUnchanged:true,
    baselineCounts:{memos:baseline.memos.length,tags:baseline.tags.length,memoTags:baseline.memoTags.length},
    finalCounts:{memos:final.memos.length,tags:final.tags.length,memoTags:final.memoTags.length},
    internalRequestLedger:'not-directly-verified',rpcMaximum:11,confirmations:2};
}
export function resolveMismatchRejection(origin,key,token,fetchImpl=fetch){
  return async payload=>{
    check(origin==='https://yohoppqflnhhvqypwhfv.supabase.co'&&/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)&&typeof token==='string'&&token.length>0,'connection');
    check(payload&&UUID.test(payload.p_id)&&UUID.test(payload.p_request_id)&&payload.p_expected_revision===null
      &&typeof payload.p_title==='string'&&typeof payload.p_body==='string'&&Array.isArray(payload.p_tag_ids)&&payload.p_tag_ids.length===1&&UUID.test(payload.p_tag_ids[0]),'resolve.arguments');
    let r;try{r=await fetchImpl(`${origin}/rest/v1/rpc/memo_resolve_request`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw new UsageDiagnostic('fetch通信','resolve-mismatch');}
    if(r.status!==400){try{await r.body?.cancel();}catch{}throw new UsageDiagnostic('HTTP応答','resolve-mismatch',r.status);}
    let text;try{text=await r.text();}catch{throw new UsageDiagnostic('応答本文受信','resolve-mismatch',400);}
    let e;try{e=JSON.parse(text);}catch{throw new UsageDiagnostic('JSON解析','resolve-mismatch',400);}
    check(e&&typeof e==='object'&&!Array.isArray(e)&&e.code==='22023'&&e.message==='request mismatch','resolve.errorContract');
    return {httpStatus:400,code:'22023',messageMatched:true};
  };
}
