import {isDeepStrictEqual as equal} from 'node:util';
import {compareTagDeleteSnapshots as same} from './tag-delete-contract.mjs';
import {UsageDiagnostic} from './tag-usage-diagnostics.mjs';
const check=(v,item)=>{if(!v)throw new UsageDiagnostic('検証',item);};
export function authTagName(runId){check(/^[0-9a-f-]{36}$/.test(runId),'runId');return `T22A-${runId.replaceAll('-','').slice(0,24)}`;}
export async function runUnauthenticatedCase({runId,memoId,tagId,requestId,userId,rpc,tableRead,anonymous,
  confirm,progress=async()=>{},setStage=()=>{}}){
  check(new Set([memoId,tagId,requestId]).size===3,'ids');
  const name=authTagName(runId),read=()=>{setStage('認証済みsnapshot');return rpc('memo_load_snapshot',{});};
  const before=await read();same(before,before);
  check(!before.memos.some((m)=>m.id===memoId)&&!before.tags.some((t)=>t.id===tagId||t.name.replace(/[A-Z]/g,(c)=>c.toLowerCase())===name.toLowerCase()),'collision');
  const expected=structuredClone(before);
  check(await confirm('tag',{id:tagId}),'confirmation');setStage('専用タグ作成');
  const tag=await rpc('memo_save_tag',{p_id:tagId,p_name:name,p_expected_revision:null});
  check(tag&&tag.id===tagId&&tag.name===name&&tag.user_id===userId&&String(tag.revision)==='1'
    &&typeof tag.created_at==='string'&&Number.isFinite(Date.parse(tag.created_at)),'tag.response');
  expected.tags.push(tag);same(await read(),expected);await progress('tag',{});
  const payload={p_id:memoId,p_request_id:requestId,p_expected_revision:null,p_title:`DBTEST-UNAUTH-${runId}`,p_body:`unauthenticated test ${runId}`,p_tag_ids:[tagId]};
  check(await confirm('create',{id:memoId,requestId,tagIds:[tagId]}),'confirmation');setStage('専用メモ作成');
  const saved=await rpc('memo_save',payload),m=saved?.memo;
  check(m&&m.id===memoId&&m.user_id===userId&&m.title===payload.p_title&&m.body===payload.p_body&&String(m.revision)==='1'
    &&m.last_request_id===requestId&&m.deleted_at===null&&m.pinned_at===null&&m.created_at===m.updated_at
    &&typeof m.created_at==='string'&&Number.isFinite(Date.parse(m.created_at))&&equal(saved.tagIds,[tagId]),'memo.response');
  expected.memos.push(m);expected.memoTags.push({user_id:userId,memo_id:memoId,tag_id:tagId});same(await read(),expected);
  await progress('create',{revision:1});
  const probes=['memos','tags','memo_tags','snapshot'];
  for(const target of probes){
    if(target!=='snapshot'){
      setStage(`${target}: 認証済み直接SELECT`);const rows=await tableRead(target);
      const wanted=target==='memos'?{id:memoId,user_id:userId}:target==='tags'?{id:tagId,user_id:userId}
        :{user_id:userId,memo_id:memoId,tag_id:tagId};
      check(Array.isArray(rows)&&rows.length===1&&equal(rows[0],wanted),`${target}.authenticatedRead`);
    }
    setStage(`${target}: Authorizationなし`);
    const response=await anonymous(target);
    if(response.status===200)throw new UsageDiagnostic('未認証応答検証',response.empty?'empty-response-not-proof-of-denial':'unexpected-success');
    check(response.status===401&&response.codeMatches===true&&response.messagePresent===true,`${target}.expected401And42501`);
    // No unverified equivalence between a function-internal guard and revoked EXECUTE.
    check(response.messageKind!=='function-unauthenticated',`${target}.unexpectedFunctionGuard`);
    same(await read(),expected);
    await progress(`anon-${target}`,{httpStatus:401,code:'42501',messageKind:response.messageKind,
      mechanism:response.messageKind==='privilege-denied'?'privilege-error':'42501-privilege-error-exact-layer-unconfirmed',allDataUnchanged:true});
  }
  return {anonymousTargets:4,denialsVerified:4,revision:1,authenticatedDirectReads:3,
    testedRpc:'memo_load_snapshot-only',rlsMechanism:'not-proven-by-privilege-denial',case23:'not-implemented'};
}
// Explicit route allowlist: no auth administration, logout, direct DML or anonymous write RPC.
export function unauthenticatedApi(origin,key,token,{memoId,tagId},fetchImpl=fetch){
  const paths={memos:`/rest/v1/memos?select=id,user_id&id=eq.${memoId}`,
    tags:`/rest/v1/tags?select=id,user_id&id=eq.${tagId}`,
    memo_tags:`/rest/v1/memo_tags?select=user_id,memo_id,tag_id&memo_id=eq.${memoId}&tag_id=eq.${tagId}`,
    snapshot:'/rest/v1/rpc/memo_load_snapshot'};
  const UUID=/^[0-9a-f-]{36}$/;
  return async(target,authenticated)=>{
    check(origin==='https://yohoppqflnhhvqypwhfv.supabase.co'&&UUID.test(memoId)&&UUID.test(tagId),'originOrIds');
    check(Object.hasOwn(paths,target)&&typeof authenticated==='boolean','route');
    check(!authenticated||(typeof token==='string'&&token.length>0),'token');
    const headers={apikey:key,...(target==='snapshot'?{'Content-Type':'application/json'}:{}),
      ...(authenticated?{Authorization:`Bearer ${token}`}:{})};
    let response;try{response=await fetchImpl(`${origin}${paths[target]}`,{method:target==='snapshot'?'POST':'GET',headers,
      ...(target==='snapshot'?{body:'{}'}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});}
    catch{throw new UsageDiagnostic('fetch通信',target);}
    const allowed=authenticated?[200]:[200,401];
    if(!allowed.includes(response.status)){try{await response.body?.cancel();}catch{}throw new UsageDiagnostic('HTTP応答',target,response.status);}
    let text;try{text=await response.text();}catch{throw new UsageDiagnostic('応答本文受信',target,response.status);}
    let data;try{data=JSON.parse(text);}catch{throw new UsageDiagnostic('JSON解析',target,response.status);}
    if(authenticated)return data;
    if(response.status===200)return {status:200,empty:data===null||(Array.isArray(data)&&data.length===0)};
    const messagePresent=typeof data?.message==='string'&&data.message.length>0;
    const messageKind=data?.message==='unauthenticated'?'function-unauthenticated'
      :messagePresent&&/^permission denied for (table|function|schema) /.test(data.message)?'privilege-denied':'unclassified';
    return {status:401,codeMatches:data?.code==='42501',messagePresent,messageKind};
  };
}
