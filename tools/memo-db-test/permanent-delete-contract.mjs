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
export async function runPermanentDeleteCase({runId,memoId,tagId,requestId,trashRequestId,userId,rpc,confirm,progress=async()=>{},setStage=()=>{}}){
  const ids=[runId,memoId,tagId,requestId,trashRequestId];
  check(ids.every(id=>UUID.test(id))&&new Set(ids).size===ids.length&&UUID.test(userId),'input.ids');
  const name=`T24-${runId.replaceAll('-','').slice(0,24)}`;
  // Retain the immutable original creation payload only in memory for read-only resolution.
  const frozen=JSON.stringify({p_id:memoId,p_request_id:requestId,p_expected_revision:null,
    p_title:`DBTEST-DELETE-${runId}`,p_body:`permanent delete test ${runId}`,p_tag_ids:[tagId]});
  const read=async(label)=>{setStage(`${label}: スナップショット取得`);const s=await rpc('memo_load_snapshot',{});same(s,s);
    check([s.memos,s.tags,s.memoTags].every(rows=>rows.every(r=>r.user_id===userId)),'snapshot.owner');return s;};
  const expected=structuredClone(await read('initial'));
  check(!expected.memos.some(m=>m.id===memoId)&&!expected.tags.some(t=>t.id===tagId||t.name.replace(/[A-Z]/g,c=>c.toLowerCase())===name.toLowerCase()),'input.collision');
  const verify=async(label)=>{const s=await read(label);setStage(`${label}: 全フィールド比較`);same(s,expected);};
  check(await confirm('tag',{id:tagId,operation:'create-tag',impact:'one-new-dedicated-tag'}),'confirmation');setStage('専用タグ作成');
  const tag=await rpc('memo_save_tag',{p_id:tagId,p_name:name,p_expected_revision:null});
  check(tag?.id===tagId&&tag.user_id===userId&&tag.name===name&&String(tag.revision)==='1','tag.response');micros(tag.created_at);
  expected.tags.push(tag);await verify('tag');await progress('tag',{revision:1});
  check(await confirm('create',{id:memoId,requestId,tagIds:[tagId],operation:'create-memo',impact:'one-new-dedicated-memo-and-link'}),'confirmation');setStage('専用メモ作成');
  const saved=await rpc('memo_save',JSON.parse(frozen)),m=saved?.memo;
  check(m&&m.id===memoId&&m.user_id===userId&&m.title===JSON.parse(frozen).p_title&&m.body===JSON.parse(frozen).p_body
    &&String(m.revision)==='1'&&m.last_request_id===requestId&&m.deleted_at===null&&m.pinned_at===null
    &&m.created_at===m.updated_at&&equal(saved.tagIds,[tagId]),'create.response');micros(m.created_at);
  expected.memos.push(m);expected.memoTags.push({user_id:userId,memo_id:memoId,tag_id:tagId});await verify('create');await progress('create',{revision:1});
  check(await confirm('trash',{id:memoId,requestId:trashRequestId,expectedRevision:1,operation:'trash',impact:'dedicated-memo-only'}),'confirmation');setStage('ゴミ箱移動');
  const trash=await rpc('memo_change_state',{p_id:memoId,p_expected_revision:1,p_request_id:trashRequestId,p_action:'trash'});
  check(trash&&String(trash.revision)==='2'&&micros(trash.updated_at)>micros(m.updated_at)
    &&equal(trash,{...m,revision:trash.revision,updated_at:trash.updated_at,deleted_at:trash.updated_at,last_request_id:trashRequestId}),'trash.response');
  expected.memos=expected.memos.map(r=>r.id===memoId?trash:r);await verify('trash-before-delete');await progress('trash',{revision:2,deleted:true});
  check(await confirm('delete',{id:memoId,expectedRevision:2,operation:'delete-permanently',impact:'dedicated-memo-and-link-removed-tag-retained'}),'confirmation');setStage('個別完全削除');
  const receipt=await rpc('memo_delete_permanently',{p_id:memoId,p_expected_revision:trash.revision});
  check(receipt===null,'delete.voidReceipt');
  expected.memos=expected.memos.filter(r=>r.id!==memoId);expected.memoTags=expected.memoTags.filter(r=>r.memo_id!==memoId);
  await verify('delete');await progress('delete',{memoAbsent:true,linkAbsent:true,tagRetained:true,otherDataUnchanged:true});
  setStage('削除済み作成要求照合');
  const resolved=await rpc('memo_resolve_request',JSON.parse(frozen));
  check(equal(resolved,{status:'previously-applied-deleted'}),'resolve.deletedReceipt');
  await progress('resolve',{creationRequestDeletedReceipt:true,internalResultNull:'not-directly-verified'});
  return {memosRetained:0,tagsRetained:1,relationsRetained:0,revisionBeforeDelete:2,creationRequestDeletedReceipt:true,
    internalResultNull:'not-directly-verified',rpcMaximum:10,confirmations:4};
}
// Six allowlisted RPC routes only. No SQL/DML, bulk deletion, auth administration or retry.
export function permanentDeleteRpc(origin,key,token,fetchImpl=fetch){
  return async(name,payload)=>{
    check(origin==='https://yohoppqflnhhvqypwhfv.supabase.co'&&/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)&&typeof token==='string'&&token.length>0,'connection');
    check(['memo_load_snapshot','memo_save_tag','memo_save','memo_change_state','memo_delete_permanently','memo_resolve_request'].includes(name),'rpc.allowlist');
    let response;try{response=await fetchImpl(`${origin}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw new UsageDiagnostic('fetch通信',name);}
    const isDelete=name==='memo_delete_permanently';
    if(response.status!==(isDelete?204:200)){try{await response.body?.cancel();}catch{}throw new UsageDiagnostic('HTTP応答',name,response.status);}
    let text;try{text=await response.text();}catch{throw new UsageDiagnostic('応答本文受信',name,response.status);}
    if(isDelete){check(text==='','delete.emptyVoidResponse');return null;}
    try{return JSON.parse(text);}catch{throw new UsageDiagnostic('JSON解析',name,response.status);}
  };
}
