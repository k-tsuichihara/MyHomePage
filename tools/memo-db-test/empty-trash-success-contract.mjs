import {isDeepStrictEqual as equal} from 'node:util';
import {compareTagDeleteSnapshots as same} from './tag-delete-contract.mjs';
import {permanentDeleteRpc} from './permanent-delete-contract.mjs';
import {UsageDiagnostic} from './tag-usage-diagnostics.mjs';
const check=(v,item)=>{if(!v)throw new UsageDiagnostic('取得後検証',item);};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import {verifyDedicatedUser} from './empty-trash-conflict-contract.mjs';
export {verifyDedicatedUser};
function micros(v){
  check(typeof v==='string'&&Number.isFinite(Date.parse(v)),'timestamp');
  const m=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  check(m,'timestamp.format');return BigInt(Date.parse(`${m[1]}${m[3]}`))*1000n+BigInt((m[2]??'').padEnd(6,'0'));
}
export async function runEmptyTrashSuccessCase({runId,tagId,memoIds,requestIds,trashRequestIds,userId,expectedUserId,recordedIds,rpc,emptyTrash,confirm,progress=async()=>{},setStage=()=>{}}){
  verifyDedicatedUser(expectedUserId,userId,recordedIds);
  check(memoIds?.length===3&&requestIds?.length===3&&trashRequestIds?.length===2,'input.lengths');
  const ids=[runId,tagId,...memoIds,...requestIds,...trashRequestIds];
  check(ids.every(id=>UUID.test(id))&&new Set(ids).size===ids.length,'input.ids');
  const read=async label=>{setStage(`${label}: スナップショット取得`);const s=await rpc('memo_load_snapshot',{});same(s,s);
    check([s.memos,s.tags,s.memoTags].every(rows=>rows.every(r=>r.user_id===userId)),'snapshot.owner');return s;};
  const expected=structuredClone(await read('initial'));
  check(expected.memos.length===0&&expected.tags.length===0&&expected.memoTags.length===0,'initial.mustBeCompletelyEmpty');
  const verify=async label=>{const s=await read(label);setStage(`${label}: 全フィールド比較`);same(s,expected);return s;};
  check(await confirm('tag',{id:tagId,requestId:null,expectedRevision:null,impact:'one-new-dedicated-tag'}),'confirmation');setStage('専用タグ作成');
  const name=`T30-${runId.replaceAll('-','').slice(0,24)}`,tag=await rpc('memo_save_tag',{p_id:tagId,p_name:name,p_expected_revision:null});
  check(tag?.id===tagId&&tag.user_id===userId&&tag.name===name&&String(tag.revision)==='1','tag.response');micros(tag.created_at);
  expected.tags.push(tag);await verify('tag');await progress('tag',{revision:1});
  for(let i=0;i<3;i++){
    const p={p_id:memoIds[i],p_request_id:requestIds[i],p_expected_revision:null,p_title:`DBTEST-EMPTY-SUCCESS-${i}-${runId}`,p_body:`empty trash success ${i} ${runId}`,p_tag_ids:[tagId]};
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
  const targetIds=memoIds.slice(0,2);
  const confirmationSnapshot=await verify('before-confirmation');
  const confirmedRevisions=targetIds.map(id=>confirmationSnapshot.memos.find(m=>m.id===id).revision);
  check(confirmedRevisions.every(r=>String(r)==='2'),'empty.confirmedRevisions');
  check(await confirm('empty',{ids:targetIds,requestId:null,expectedRevisions:confirmedRevisions,count:2,impact:'entire-user-trash-permanently-deleted-normal-memo-retained'}),'confirmation');
  const before=structuredClone(await verify('immediately-before-empty'));
  check(before.memos.length===3&&before.tags.length===1&&before.memoTags.length===3,'empty.counts');
  check(equal(before.memos.filter(m=>m.deleted_at!==null).map(m=>m.id).sort(),[...targetIds].sort()),'empty.exactTrashIds');
  const revisions=targetIds.map((id,i)=>{
    const m=before.memos.find(m=>m.id===id);
    check(m?.user_id===userId&&String(m.revision)==='2'&&m.deleted_at!==null&&m.last_request_id===trashRequestIds[i],'empty.preconditions');micros(m.deleted_at);return m.revision;
  });
  check(equal(revisions,confirmedRevisions),'empty.confirmationUnchanged');
  const normal=before.memos.find(m=>m.id===memoIds[2]);check(normal?.deleted_at===null&&String(normal.revision)==='1','normal.precondition');
  setStage('ゴミ箱一括完全削除');
  const receipt=await emptyTrash({p_ids:targetIds,p_revisions:revisions});
  check(typeof receipt==='number'&&Number.isInteger(receipt)&&receipt===2,'empty.deletedCount');
  const expectedAfter={...before,memos:before.memos.filter(m=>!targetIds.includes(m.id)),memoTags:before.memoTags.filter(r=>!targetIds.includes(r.memo_id))};
  const after=await read('after-empty');setStage('削除後の全フィールド比較');same(after,expectedAfter);
  check(after.memos.length===1&&after.tags.length===1&&after.memoTags.length===1&&equal(after.memos[0],normal),'empty.retained');
  await progress('empty',{httpStatus:200,deletedCount:2,deletedMemosAbsent:true,deletedLinksAbsent:true,normalMemoUnchanged:true,tagUnchanged:true});
  return {memosRetained:1,tagsRetained:1,relationsRetained:1,deletedCount:2,initialEmptyVerified:true,normalMemoUnchanged:true,
    internalRequestLedger:'not-directly-verified',rpcMaximum:17,confirmations:7};
}
export function emptyTrashSuccessCaseRpc(origin,key,token,fetchImpl=fetch){
  const normal=permanentDeleteRpc(origin,key,token,fetchImpl);
  return (name,p)=>{check(['memo_load_snapshot','memo_save_tag','memo_save','memo_change_state'].includes(name),'rpc.allowlist');return normal(name,p);};
}
export function emptyTrashSuccessResponse(origin,key,token,fetchImpl=fetch){
  return async p=>{
    check(origin==='https://yohoppqflnhhvqypwhfv.supabase.co'&&/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)&&typeof token==='string'&&token.length>0,'connection');
    check(p&&equal(Object.keys(p).sort(),['p_ids','p_revisions'])&&Array.isArray(p.p_ids)&&p.p_ids.length===2&&p.p_ids.every(id=>UUID.test(id))&&new Set(p.p_ids).size===2&&Array.isArray(p.p_revisions)&&p.p_revisions.length===2&&p.p_revisions.every(r=>r===2||r==='2'),'empty.arguments');
    let response;try{response=await fetchImpl(`${origin}/rest/v1/rpc/memo_empty_trash`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(p),redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw new UsageDiagnostic('fetch通信','empty-success');}
    if(response.status!==200){try{await response.body?.cancel();}catch{}throw new UsageDiagnostic('HTTP応答','empty-success',response.status);}
    let text;try{text=await response.text();}catch{throw new UsageDiagnostic('応答本文受信','empty-success',200);}
    let e;try{e=JSON.parse(text);}catch{throw new UsageDiagnostic('JSON解析','empty-success',200);}
    check(typeof e==='number'&&Number.isInteger(e)&&e===2,'empty.responseCount');
    return e;
  };
}
