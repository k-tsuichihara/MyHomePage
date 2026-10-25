import {isDeepStrictEqual as equal} from 'node:util';
import {UsageDiagnostic,SAFE_ROW_FIELDS} from './tag-usage-diagnostics.mjs';
const check=(v,item)=>{if(!v)throw new UsageDiagnostic('取得後検証',item);};
export function compareTagDeleteSnapshots(a,b){
  check(a&&b,'snapshot');
  for(const collection of ['memos','tags','memoTags']){
    const index=(rows,side)=>{
      check(Array.isArray(rows),`snapshot.${collection}.${side}.array`);
      const result=new Map();
      for(const row of rows){
        check(row&&typeof row==='object'&&!Array.isArray(row),`snapshot.${collection}.${side}.row`);
        const fields=collection==='memoTags'?['memo_id','tag_id']:['id'];
        check(fields.every((field)=>typeof row[field]==='string'&&row[field].length>0),`snapshot.${collection}.${side}.identity`);
        // Encode components, rather than concatenating with an ambiguous separator.
        const key=JSON.stringify(fields.map((field)=>row[field]));
        check(!result.has(key),`snapshot.${collection}.${side}.duplicate`);
        result.set(key,row);
      }
      return result;
    };
    const actual=index(a[collection],'actual'),expected=index(b[collection],'expected');
    for(const key of expected.keys())check(actual.has(key),`snapshot.${collection}.missing`);
    for(const key of actual.keys())check(expected.has(key),`snapshot.${collection}.extra`);
    for(const [key,wanted] of expected){
      const row=actual.get(key);
      for(const field of SAFE_ROW_FIELDS){
        check(Object.hasOwn(row,field)===Object.hasOwn(wanted,field)&&equal(row[field],wanted[field]),`snapshot.${collection}.${field}`);
      }
      // Compare complete rows, including unknown columns and added/missing fields.
      // isDeepStrictEqual ignores object key insertion order, but retains types and values.
      check(equal(row,wanted),`snapshot.${collection}.allFields`);
    }
  }
}
const same=compareTagDeleteSnapshots;
function micros(v){
  check(typeof v==='string'&&Number.isFinite(Date.parse(v)),'timestamp');
  const m=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  check(m,'timestamp.format');return BigInt(Date.parse(`${m[1]}${m[3]}`))*1000n+BigInt((m[2]??'').padEnd(6,'0'));
}
export async function runTagDeleteCase({runId,tagIds,memoIds,requestIds,userId,rpc,confirm,progress=async()=>{},setStage=()=>{}}){
  check(/^[0-9a-f-]{36}$/.test(runId)&&tagIds.length===2&&memoIds.length===2&&requestIds.length===3
    &&new Set([...tagIds,...memoIds,...requestIds]).size===7,'input.ids');
  const names=['D','K'].map((s)=>`T18${s}-${runId.replaceAll('-','').slice(0,24)}`);
  const read=(label)=>{setStage(`${label}: スナップショット取得`);return rpc('memo_load_snapshot',{});};
  const before=await read('initial');same(before,before);
  check(!before.memos.some((m)=>memoIds.includes(m.id))&&!before.tags.some((t)=>tagIds.includes(t.id)
    ||names.some((n)=>n.toLowerCase()===t.name.replace(/[A-Z]/g,(c)=>c.toLowerCase()))),'input.collision');
  const expected=structuredClone(before);
  const verify=async(label)=>{const s=await read(label);setStage(`${label}: 取得後検証`);same(s,expected);await progress(label,{});};
  for(let i=0;i<2;i++){
    const label=i===0?'tag-delete':'tag-keep',p={p_id:tagIds[i],p_name:names[i],p_expected_revision:null};
    check(await confirm(label,{id:p.p_id,expectedRevision:null}),'confirmation');setStage(label);
    const row=await rpc('memo_save_tag',p);check(row&&row.id===p.p_id&&row.name===p.p_name&&row.user_id===userId&&String(row.revision)==='1','tag.response');micros(row.created_at);
    expected.tags.push(row);await verify(label);
  }
  for(let i=0;i<2;i++){
    const label=`memo-${i+1}`,links=i===0?[...tagIds].sort():[tagIds[0]];
    const p={p_id:memoIds[i],p_request_id:requestIds[i],p_expected_revision:null,p_title:`DBTEST-TAG-DELETE-${i+1}-${runId}`,
      p_body:`tag delete test ${i+1} ${runId}`,p_tag_ids:links};
    check(await confirm(label,{id:p.p_id,requestId:p.p_request_id,tagIds:links,expectedRevision:null}),'confirmation');setStage(label);
    const saved=await rpc('memo_save',p),m=saved?.memo;
    check(m&&m.id===p.p_id&&m.user_id===userId&&m.title===p.p_title&&m.body===p.p_body&&String(m.revision)==='1'
      &&m.last_request_id===p.p_request_id&&m.pinned_at===null&&m.deleted_at===null&&m.created_at===m.updated_at&&equal(saved.tagIds,links),'memo.response');micros(m.created_at);
    expected.memos.push(m);expected.memoTags.push(...links.map((id)=>({user_id:userId,memo_id:p.p_id,tag_id:id})));await verify(label);
  }
  const previous=expected.memos.find((m)=>m.id===memoIds[1]);
  const trash={p_id:memoIds[1],p_expected_revision:1,p_request_id:requestIds[2],p_action:'trash'};
  check(await confirm('trash',{id:trash.p_id,requestId:trash.p_request_id,expectedRevision:1}),'confirmation');setStage('trash');
  const trashed=await rpc('memo_change_state',trash);
  check(trashed&&String(trashed.revision)==='2'&&micros(trashed.updated_at)>micros(previous.updated_at)
    &&trashed.deleted_at===trashed.updated_at&&equal(trashed,{...previous,revision:trashed.revision,updated_at:trashed.updated_at,deleted_at:trashed.updated_at,last_request_id:trash.p_request_id}),'trash.response');
  expected.memos=expected.memos.map((m)=>m.id===trashed.id?trashed:m);await verify('trash');
  const baseline=structuredClone(expected);
  check(await confirm('delete-tag',{id:tagIds[0],expectedRevision:1,affectedMemoIds:memoIds}),'confirmation');setStage('タグ削除');
  const receipt=await rpc('memo_delete_tag',{p_id:tagIds[0],p_expected_revision:1});check(receipt===null,'delete.voidReceipt');
  const after=await read('delete-tag');setStage('delete-tag: 取得後検証');
  check(after&&Array.isArray(after.memos),'snapshot.memos.array');
  let updateTime;
  for(const id of memoIds){
    const old=baseline.memos.find((m)=>m.id===id),rows=after.memos.filter((m)=>m?.id===id),row=rows[0];
    check(rows.length===1,'delete.relatedMemo.existsOnce');
    check(String(row.revision)===String(Number(old.revision)+1),'delete.relatedMemo.revision');
    check(micros(row.updated_at)>micros(old.updated_at),'delete.relatedMemo.updated_at');
    if(updateTime===undefined)updateTime=row.updated_at;else check(updateTime===row.updated_at,'delete.relatedMemos.sameTransactionTime');
    const wanted={...old,revision:row.revision,updated_at:row.updated_at,last_request_id:null};
    for(const field of SAFE_ROW_FIELDS)check(equal(row[field],wanted[field]),`delete.relatedMemo.${field}`);
    check(equal(row,wanted),'delete.relatedMemo.allFields');
    expected.memos=expected.memos.map((m)=>m.id===id?wanted:m);
  }
  expected.tags=expected.tags.filter((t)=>t.id!==tagIds[0]);expected.memoTags=expected.memoTags.filter((r)=>r.tag_id!==tagIds[0]);same(after,expected);
  await progress('delete-tag',{deletedTagAbsent:true,deletedTagLinksAbsent:true,normalMemoRevision:2,trashMemoRevision:3,relatedLastRequestIdsCleared:true});
  return {memosRetained:2,tagsRetained:1,relationsRetained:1,normalMemoRevision:2,trashMemoRevision:3,
    requestResolution:'not-supported-no-delete-request-id',failureAtomicity:'not-tested-success-case-only'};
}
export function tagDeleteRpc(origin,headers,fetchImpl=fetch){
  return async(name,payload)=>{
    check(origin==='https://yohoppqflnhhvqypwhfv.supabase.co','origin');
    check(['memo_save_tag','memo_save','memo_change_state','memo_load_snapshot','memo_delete_tag'].includes(name),'rpc.allowlist');
    let response;try{response=await fetchImpl(`${origin}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(15000)});}
    catch{throw new UsageDiagnostic('fetch通信',name);}
    if(response.status!==(name==='memo_delete_tag'?204:200)){try{await response.body?.cancel();}catch{}throw new UsageDiagnostic('HTTP応答',name,response.status);}
    let text;try{text=await response.text();}catch{throw new UsageDiagnostic('応答本文受信',name,response.status);}
    if(name==='memo_delete_tag'){check(text==='','delete.emptyVoidResponse');return null;}
    try{return JSON.parse(text);}catch{throw new UsageDiagnostic('JSON解析',name,response.status);}
  };
}
