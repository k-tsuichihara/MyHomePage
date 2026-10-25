import {isDeepStrictEqual as equal} from 'node:util';
import {compareTagDeleteSnapshots as same} from './tag-delete-contract.mjs';
import {UsageDiagnostic} from './tag-usage-diagnostics.mjs';
const check=(v,item)=>{if(!v)throw new UsageDiagnostic('取得後検証',item);};
export function contentPlan(runId){
  check(/^[0-9a-f-]{36}$/.test(runId),'runId');const suffix=runId.replaceAll('-','').slice(0,20);
  const title=`Cafe\u0301-${suffix}`,tag=`T21-${suffix}-e\u0301`;
  return {title,tag,whitespace:' \t\n\u00a0 ',preserved:' \t\nCafe\u0301\n\t\u00a0 ',rejects:[
    {label:'title-empty',target:'memo',field:'p_title',value:'',message:'invalid memo content'},
    {label:'title-null',target:'memo',field:'p_title',value:null,message:'invalid argument'},
    {label:'title-spaces',target:'memo',field:'p_title',value:' \u00a0 ',message:'invalid memo content'},
    {label:'title-edge',target:'memo',field:'p_title',value:`\u00a0${title}`,message:'invalid memo content'},
    {label:'title-lf',target:'memo',field:'p_title',value:'a\nb',message:'invalid memo content'},
    {label:'body-null',target:'memo',field:'p_body',value:null,message:'invalid argument'},
    {label:'body-cr',target:'memo',field:'p_body',value:'a\r\nb',message:'invalid memo content'},
    {label:'body-c1',target:'memo',field:'p_body',value:'a\u0085b',message:'invalid memo content'},
    {label:'tag-empty',target:'tag',field:'p_name',value:'',message:'invalid tag input'},
    {label:'tag-null',target:'tag',field:'p_name',value:null,message:'invalid tag input'},
    {label:'tag-edge',target:'tag',field:'p_name',value:`${tag} `,message:'invalid tag input'},
    {label:'tag-tab',target:'tag',field:'p_name',value:'a\tb',message:'invalid tag input'},
    {label:'tag-line-separator',target:'tag',field:'p_name',value:'a\u2028b',message:'invalid tag input'},
  ]};
}
function micros(v){
  check(typeof v==='string'&&Number.isFinite(Date.parse(v)),'timestamp');
  const m=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  check(m,'timestamp.format');return BigInt(Date.parse(`${m[1]}${m[3]}`))*1000n+BigInt((m[2]??'').padEnd(6,'0'));
}
export async function runInputContentCase({runId,tagId,memoId,requestIds,userId,rpc,reject,confirm,progress=async()=>{},setStage=()=>{}}){
  check(requestIds.length===11&&new Set([tagId,memoId,...requestIds]).size===13,'input.ids');
  const plan=contentPlan(runId),read=(label)=>{setStage(`${label}: スナップショット取得`);return rpc('memo_load_snapshot',{});};
  const before=await read('initial');same(before,before);const key=(s)=>s.replace(/[A-Z]/g,(c)=>c.toLowerCase());
  check(!before.memos.some((m)=>m.id===memoId)&&!before.tags.some((t)=>t.id===tagId||key(t.name)===key(plan.tag)),'input.collision');
  const expected=structuredClone(before);
  const verify=async(label)=>{const s=await read(label);setStage(`${label}: 取得後検証`);same(s,expected);};
  check(await confirm('tag-preserved',{id:tagId,expectedRevision:null}),'confirmation');setStage('tag-preserved');
  const tag=await rpc('memo_save_tag',{p_id:tagId,p_name:plan.tag,p_expected_revision:null});
  check(tag&&tag.id===tagId&&tag.name===plan.tag&&tag.user_id===userId&&String(tag.revision)==='1','tag.response');micros(tag.created_at);
  expected.tags.push(tag);await verify('tag-preserved');await progress('tag-preserved',{revision:1,exactStringMatched:true});
  let memo,index=0;
  for(const [label,body] of [['body-empty',''],['body-whitespace',plan.whitespace],['body-preserved',plan.preserved]]){
    const previous=memo,p={p_id:memoId,p_request_id:requestIds[index++],p_expected_revision:previous?Number(previous.revision):null,
      p_title:plan.title,p_body:body,p_tag_ids:[tagId]};
    check(await confirm(label,{id:memoId,requestId:p.p_request_id,expectedRevision:p.p_expected_revision}),'confirmation');setStage(label);
    const saved=await rpc('memo_save',p),row=saved?.memo;
    check(row&&row.id===memoId&&row.user_id===userId&&row.title===plan.title&&row.body===body&&String(row.revision)===String(index)
      &&row.last_request_id===p.p_request_id&&row.pinned_at===null&&row.deleted_at===null&&equal(saved.tagIds,[tagId]),'memo.response');
    micros(row.created_at);
    if(previous)check(micros(row.updated_at)>micros(previous.updated_at)&&equal(row,{...previous,body,revision:row.revision,updated_at:row.updated_at,last_request_id:p.p_request_id}),'memo.updateAllFields');
    else check(row.created_at===row.updated_at,'memo.initialDates');
    memo=row;
    if(previous)expected.memos=expected.memos.map((m)=>m.id===memoId?row:m);
    else{expected.memos.push(row);expected.memoTags.push({user_id:userId,memo_id:memoId,tag_id:tagId});}
    await verify(label);await progress(label,{revision:index,exactStringMatched:true});
  }
  for(const c of plan.rejects){
    const name=c.target==='tag'?'memo_save_tag':'memo_save';
    const p=c.target==='tag'?{p_id:tagId,p_name:plan.tag,p_expected_revision:1}
      :{p_id:memoId,p_title:plan.title,p_body:plan.preserved,p_tag_ids:[tagId],p_expected_revision:3,p_request_id:requestIds[index++]};
    p[c.field]=c.value;
    check(await confirm(c.label,{id:p.p_id,...(p.p_request_id?{requestId:p.p_request_id}:{}),expectedRevision:p.p_expected_revision,field:c.field}),'confirmation');
    setStage(`${c.label}: 拒否応答`);const response=await reject(name,p);
    check(response.status===400&&response.codeMatches===true&&response.message===c.message,'rejection.contract');
    await verify(c.label);await progress(c.label,{httpStatus:400,code:'22023',expectedMessageMatched:true,allDataUnchanged:true});
  }
  check(index===11,'requestIds.consumed');
  return {acceptedCases:4,rejectedCases:13,revision:3,tagsRetained:1,linkedTagCount:1,
    exactStringsPreserved:true,internalLedger:'not-directly-readable-not-verified',apiLayerInvalidUnicode:'not-tested'};
}
export async function contentRejection(origin,headers,name,payload,fetchImpl=fetch){
  check(origin==='https://yohoppqflnhhvqypwhfv.supabase.co'&&['memo_save','memo_save_tag'].includes(name),'rejection.endpoint');
  let response;try{response=await fetchImpl(`${origin}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(15000)});}
  catch{throw new UsageDiagnostic('fetch通信',name);}
  if(response.status!==400){try{await response.body?.cancel();}catch{}throw new UsageDiagnostic('HTTP応答',name,response.status);}
  let text;try{text=await response.text();}catch{throw new UsageDiagnostic('応答本文受信',name,400);}
  let data;try{data=JSON.parse(text);}catch{throw new UsageDiagnostic('JSON解析',name,400);}
  return {status:400,codeMatches:data?.code==='22023',message:['invalid argument','invalid memo content','invalid tag input'].includes(data?.message)?data.message:null};
}
