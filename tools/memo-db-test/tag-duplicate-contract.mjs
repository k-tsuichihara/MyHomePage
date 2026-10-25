import {isDeepStrictEqual as equal} from 'node:util';
const check=(v)=>{if(!v)throw new Error('verification failed');};
export const asciiKey=(s)=>s.replace(/[A-Z]/g,(c)=>String.fromCharCode(c.charCodeAt(0)+32));
export const DUPLICATE_MESSAGE='duplicate key value violates unique constraint "tags_name_per_user"';
export function duplicateNames(runId) {
  check(/^[0-9a-f-]{36}$/.test(runId));const suffix=runId.replaceAll('-','').slice(0,24);
  return {ascii:`T14A-${suffix}`,upper:`T14\u00c4-${suffix}`,lower:`T14\u00e4-${suffix}`};
}
function ordered(rows){return [...rows].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));}
function same(a,b){check(a&&['memos','tags','memoTags'].every((k)=>Array.isArray(a[k])&&equal(ordered(a[k]),ordered(b[k]))));}
export async function runTagDuplicateCase({ids,names,userId,rpc,confirm,progress=async()=>{},setStage=()=>{}}){
  check(ids.length===5&&new Set(ids).size===5&&ids.every((id)=>typeof id==='string'&&id.length>0));
  check(names.upper.includes('\u00c4')&&names.lower===names.upper.replace('\u00c4','\u00e4')
    &&new Set(Object.values(names).map(asciiKey)).size===3&&Object.values(names).every((n)=>Array.from(n).length<=30));
  const snapshot=()=>{setStage('スナップショット取得');return rpc('memo_load_snapshot',{});};
  const before=await snapshot();same(before,before);
  check(!before.tags.some((t)=>ids.includes(t.id)||Object.values(names).some((n)=>asciiKey(n)===asciiKey(t.name))));
  let expected=structuredClone(before);
  const create=async(label,id,name)=>{
    const payload={p_id:id,p_name:name,p_expected_revision:null};check(await confirm(label,payload));setStage(label);
    const row=await rpc('memo_save_tag',payload);
    check(row&&row.id===id&&row.user_id===userId&&row.name===name&&String(row.revision)==='1'
      &&typeof row.created_at==='string'&&Number.isFinite(Date.parse(row.created_at)));
    expected.tags.push(row);same(await snapshot(),expected);await progress(label,{revision:1});
  };
  const reject=async(label,payload)=>{
    check(await confirm(label,payload));setStage(label);const response=await rpc('memo_save_tag',payload,true);
    check(response.status===409&&response.codeMatches===true&&response.messageMatches===true);
    same(await snapshot(),expected);await progress(label,{httpStatus:409,code:'23505',constraintMessageMatched:true});
  };
  await create('create-ascii',ids[0],names.ascii);
  await reject('duplicate-exact',{p_id:ids[1],p_name:names.ascii,p_expected_revision:null});
  await reject('duplicate-ascii',{p_id:ids[2],p_name:asciiKey(names.ascii),p_expected_revision:null});
  await create('create-nonascii-upper',ids[3],names.upper);
  await create('create-nonascii-lower',ids[4],names.lower);
  await reject('rename-duplicate',{p_id:ids[4],p_name:names.upper,p_expected_revision:1});
  return {tagsRetained:3,revision:1,duplicateRejections:3,nonAsciiPair:'U+00C4-vs-U+00E4-distinct',
    messagePolicy:'strict-English-constraint-message-environment-dependent',normalizationEquivalence:'not-tested'};
}
export function duplicateRpc(origin,headers,fetchImpl=fetch){
  return async(name,payload,rejection=false)=>{
    check(['memo_save_tag','memo_load_snapshot'].includes(name)&&(!rejection||name==='memo_save_tag'));
    const response=await fetchImpl(`${origin}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(payload),
      redirect:'error',signal:AbortSignal.timeout(15000)});
    if(response.status!==(rejection?409:200)){
      try{await response.body?.cancel();}catch{}throw new Error('unexpected HTTP');
    }
    const data=await response.json();
    return rejection?{status:409,codeMatches:data?.code==='23505',messageMatches:data?.message===DUPLICATE_MESSAGE}:data;
  };
}
