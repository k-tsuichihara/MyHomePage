import {compareSnapshots} from './snapshot-comparison.mjs';
import {isDeepStrictEqual as equal} from 'node:util';
const check=(v)=>{if(!v)throw new Error('verification failed');};
const same=compareSnapshots;
function micros(v){
  check(typeof v==='string'&&Number.isFinite(Date.parse(v)));
  const m=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  check(m);return BigInt(Date.parse(`${m[1]}${m[3]}`))*1000n+BigInt((m[2]??'').padEnd(6,'0'));
}
export function memoTagNames(runId){
  check(/^[0-9a-f-]{36}$/.test(runId));const suffix=runId.replaceAll('-','').slice(0,24);
  return [`T15A-${suffix}`,`T15B-${suffix}`];
}
export async function runMemoTagsCase({base,updateRequestId,tagIds,tagNames,userId,rpc,confirm,
  progress=async()=>{},setStage=()=>{}}){
  check(base.p_expected_revision===null&&equal(base.p_tag_ids,[tagIds[0]])&&tagIds.length===2
    &&new Set([base.p_id,base.p_request_id,updateRequestId,...tagIds]).size===5
    &&tagNames.length===2&&new Set(tagNames.map((n)=>n.toLowerCase())).size===2
    &&tagNames.every((n)=>/^[A-Za-z0-9-]{1,30}$/.test(n)));
  const snapshot=()=>{setStage('スナップショット取得');return rpc('memo_load_snapshot',{});};
  const before=await snapshot();same(before,before);
  check(!before.memos.some((m)=>m.id===base.p_id)&&!before.tags.some((t)=>tagIds.includes(t.id)||tagNames.some((n)=>n.toLowerCase()===t.name.replace(/[A-Z]/g,(c)=>c.toLowerCase()))));
  const expected=structuredClone(before);
  for(let i=0;i<2;i++){
    const label=`tag-${i===0?'a':'b'}`,payload={p_id:tagIds[i],p_name:tagNames[i],p_expected_revision:null};
    check(await confirm(label,{id:payload.p_id,expectedRevision:null}));setStage(label);
    const row=await rpc('memo_save_tag',payload);
    check(row&&row.id===tagIds[i]&&row.user_id===userId&&row.name===tagNames[i]&&String(row.revision)==='1');
    micros(row.created_at);expected.tags.push(row);same(await snapshot(),expected);await progress(label,{revision:1});
  }
  check(await confirm('create',{id:base.p_id,requestId:base.p_request_id,tagIds:base.p_tag_ids,expectedRevision:null}));setStage('メモ作成');
  const initial=await rpc('memo_save',base),m=initial?.memo;
  check(m&&m.id===base.p_id&&m.user_id===userId&&m.title===base.p_title&&m.body===base.p_body
    &&String(m.revision)==='1'&&m.last_request_id===base.p_request_id&&m.pinned_at===null&&m.deleted_at===null
    &&m.created_at===m.updated_at&&equal(initial.tagIds,[tagIds[0]]));micros(m.created_at);
  expected.memos.push(m);expected.memoTags.push({user_id:userId,memo_id:base.p_id,tag_id:tagIds[0]});
  same(await snapshot(),expected);await progress('create',{revision:1,tagCount:1});
  const submitted={...base,p_request_id:updateRequestId,p_expected_revision:1,
    p_body:`${base.p_body}\nupdated with tag replacement ${updateRequestId}`,p_tag_ids:[tagIds[1]]};
  check(submitted.p_body!==m.body&&!equal(submitted.p_tag_ids,base.p_tag_ids));
  check(await confirm('update',{id:base.p_id,requestId:updateRequestId,tagIds:submitted.p_tag_ids,expectedRevision:1}));setStage('本文とタグ一括更新');
  const saved=await rpc('memo_save',submitted),row=saved?.memo;
  check(row&&String(row.revision)==='2'&&micros(row.updated_at)>micros(m.updated_at)&&equal(saved.tagIds,[tagIds[1]])
    &&equal(row,{...m,body:submitted.p_body,revision:row.revision,updated_at:row.updated_at,last_request_id:updateRequestId}));
  expected.memos=expected.memos.map((memo)=>memo.id===base.p_id?row:memo);
  expected.memoTags=expected.memoTags.filter((rel)=>rel.memo_id!==base.p_id);
  expected.memoTags.push({user_id:userId,memo_id:base.p_id,tag_id:tagIds[1]});
  same(await snapshot(),expected);await progress('update',{revision:2,tagCount:1,oldTagRemoved:true,newTagLinked:true});
  for(const [payload,result] of [[base,initial],[submitted,saved]]){
    setStage('保存要求照合');const resolved=await rpc('memo_resolve_request',payload);
    check(resolved?.status==='saved'&&equal(resolved.result,result));
  }
  return {revision:2,tagsRetained:2,linkedTagCount:1,bodyAndTagUpdated:true,oldTagRemoved:true,
    saveRequestsResolved:true,atomicity:'final-consistency-verified-failure-rollback-not-tested-case16'};
}
export function memoTagsRpc(origin,headers,fetchImpl=fetch){
  return async(name,payload)=>{
    check(['memo_save_tag','memo_save','memo_load_snapshot','memo_resolve_request'].includes(name));
    const response=await fetchImpl(`${origin}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(15000)});
    if(response.status!==200){try{await response.body?.cancel();}catch{}throw new Error('unexpected HTTP');}
    return response.json();
  };
}
