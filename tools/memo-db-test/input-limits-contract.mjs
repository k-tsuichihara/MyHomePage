import {isDeepStrictEqual as equal} from 'node:util';
import {compareTagDeleteSnapshots as same} from './tag-delete-contract.mjs';
import {UsageDiagnostic} from './tag-usage-diagnostics.mjs';
const check=(v,item)=>{if(!v)throw new UsageDiagnostic('取得後検証',item);};
export const codePoints=(s)=>Array.from(s).length;
export function limitInputs(runId){
  check(/^[0-9a-f-]{36}$/.test(runId),'runId');
  const tag=`T20A-${runId.replaceAll('-','').slice(0,24)}😀`;
  const title='題'.repeat(99)+'😀',body='文'.repeat(9999)+'😀';
  return {tag,title,body,tagOver:tag+'x',titleOver:title+'x',bodyOver:body+'x'};
}
function micros(v){
  check(typeof v==='string'&&Number.isFinite(Date.parse(v)),'timestamp');
  const m=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  check(m,'timestamp.format');return BigInt(Date.parse(`${m[1]}${m[3]}`))*1000n+BigInt((m[2]??'').padEnd(6,'0'));
}
export async function runInputLimitsCase({runId,tagId,memoId,requestIds,userId,rpc,reject,confirm,progress=async()=>{},setStage=()=>{}}){
  check(requestIds.length===4&&new Set([tagId,memoId,...requestIds]).size===6,'input.ids');
  const v=limitInputs(runId);
  check([codePoints(v.tag),codePoints(v.tagOver),codePoints(v.title),codePoints(v.titleOver),codePoints(v.body),codePoints(v.bodyOver)].join(',')==='30,31,100,101,10000,10001','input.codePointLengths');
  const read=(label)=>{setStage(`${label}: スナップショット取得`);return rpc('memo_load_snapshot',{});};
  const before=await read('initial');same(before,before);
  const key=(s)=>s.replace(/[A-Z]/g,(c)=>c.toLowerCase());
  check(!before.memos.some((m)=>m.id===memoId)&&!before.tags.some((t)=>t.id===tagId||[v.tag,v.tagOver].some((n)=>key(n)===key(t.name))),'input.collision');
  const expected=structuredClone(before);
  const verify=async(label)=>{const snapshot=await read(label);setStage(`${label}: 取得後検証`);same(snapshot,expected);};
  const attemptReject=async(label,name,payload,message,summary)=>{
    check(await confirm(label,summary),'confirmation');setStage(`${label}: 拒否応答`);
    const response=await reject(name,payload);
    check(response.status===400&&response.codeMatches===true&&response.message===message,'rejection.contract');
    await verify(label);
    if(name==='memo_save'){
      setStage(`${label}: 拒否保存要求照合`);check(await rpc('memo_resolve_request',payload)===null,'resolve.expectedNull');
    }
    await progress(label,{httpStatus:400,code:'22023',messageMatched:true,allDataUnchanged:true});
  };
  check(await confirm('tag-30',{id:tagId,codePoints:30,expectedRevision:null}),'confirmation');setStage('tag-30');
  const tag=await rpc('memo_save_tag',{p_id:tagId,p_name:v.tag,p_expected_revision:null});
  check(tag&&tag.id===tagId&&tag.user_id===userId&&tag.name===v.tag&&String(tag.revision)==='1','tag.response');micros(tag.created_at);
  expected.tags.push(tag);await verify('tag-30');await progress('tag-30',{codePoints:30,revision:1});
  await attemptReject('tag-31','memo_save_tag',{p_id:tagId,p_name:v.tagOver,p_expected_revision:1},'invalid tag input',{id:tagId,codePoints:31,expectedRevision:1});
  const create={p_id:memoId,p_request_id:requestIds[0],p_expected_revision:null,p_title:v.title,p_body:`input limit test ${runId}`,p_tag_ids:[tagId]};
  check(await confirm('title-100',{id:memoId,requestId:create.p_request_id,codePoints:100,expectedRevision:null}),'confirmation');setStage('title-100');
  const saved=await rpc('memo_save',create),m=saved?.memo;
  check(m&&m.id===memoId&&m.user_id===userId&&m.title===v.title&&m.body===create.p_body&&String(m.revision)==='1'
    &&m.last_request_id===create.p_request_id&&m.pinned_at===null&&m.deleted_at===null&&m.created_at===m.updated_at&&equal(saved.tagIds,[tagId]),'create.response');micros(m.created_at);
  expected.memos.push(m);expected.memoTags.push({user_id:userId,memo_id:memoId,tag_id:tagId});await verify('title-100');await progress('title-100',{codePoints:100,revision:1});
  await attemptReject('title-101','memo_save',{...create,p_request_id:requestIds[1],p_expected_revision:1,p_title:v.titleOver},'invalid memo content',
    {id:memoId,requestId:requestIds[1],codePoints:101,expectedRevision:1});
  const update={...create,p_request_id:requestIds[2],p_expected_revision:1,p_body:v.body};
  check(await confirm('body-10000',{id:memoId,requestId:update.p_request_id,codePoints:10000,expectedRevision:1}),'confirmation');setStage('body-10000');
  const updated=await rpc('memo_save',update),row=updated?.memo;
  check(row&&String(row.revision)==='2'&&micros(row.updated_at)>micros(m.updated_at)&&equal(updated.tagIds,[tagId])
    &&equal(row,{...m,body:v.body,revision:row.revision,updated_at:row.updated_at,last_request_id:update.p_request_id}),'update.response');
  expected.memos=expected.memos.map((r)=>r.id===memoId?row:r);await verify('body-10000');await progress('body-10000',{codePoints:10000,revision:2});
  await attemptReject('body-10001','memo_save',{...update,p_request_id:requestIds[3],p_expected_revision:2,p_body:v.bodyOver},'invalid memo content',
    {id:memoId,requestId:requestIds[3],codePoints:10001,expectedRevision:2});
  return {boundariesVerified:6,revision:2,tagsRetained:1,linkedTagCount:1,internalLedger:'not-directly-readable',
    rejectedSaveResolution:'null-not-proof-of-non-execution',case21:'not-implemented'};
}
export async function limitRejection(origin,headers,name,payload,fetchImpl=fetch){
  check(origin==='https://yohoppqflnhhvqypwhfv.supabase.co'&&['memo_save','memo_save_tag'].includes(name),'rejection.endpoint');
  let response;try{response=await fetchImpl(`${origin}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(15000)});}
  catch{throw new UsageDiagnostic('fetch通信',name);}
  if(response.status!==400){try{await response.body?.cancel();}catch{}throw new UsageDiagnostic('HTTP応答',name,response.status);}
  let text;try{text=await response.text();}catch{throw new UsageDiagnostic('応答本文受信',name,400);}
  let data;try{data=JSON.parse(text);}catch{throw new UsageDiagnostic('JSON解析',name,400);}
  return {status:400,codeMatches:data?.code==='22023',message:['invalid tag input','invalid memo content'].includes(data?.message)?data.message:null};
}
