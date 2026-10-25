import {isDeepStrictEqual as equal} from 'node:util';
import {compareTagDeleteSnapshots as same} from './tag-delete-contract.mjs';
import {UsageDiagnostic} from './tag-usage-diagnostics.mjs';
const check=(v,item)=>{if(!v)throw new UsageDiagnostic('検証',item);};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function runIsolationCase({runId,users,rpc,select,confirm,progress=async()=>{}}){
  check(UUID.test(runId)&&users.length===2&&users[0].userId!==users[1].userId,'users');
  const ids=users.flatMap(u=>[u.memoId,u.tagId,u.createId,u.trashId,u.editId,u.stateId]);
  check(ids.every(id=>UUID.test(id))&&new Set(ids).size===ids.length,'ids');
  const expected=[];
  const read=async(i)=>{const s=await rpc(i,'memo_load_snapshot',{});same(s,s);
    for(const rows of [s.memos,s.tags,s.memoTags])check(rows.every(r=>r.user_id===users[i].userId),'snapshot.owner');return s;};
  for(let i=0;i<2;i++)expected.push(await read(i));
  const verify=async()=>{for(let i=0;i<2;i++)same(await read(i),expected[i]);};
  for(let i=0;i<2;i++){
    const u=users[i],name=`T23${i}-${runId.replaceAll('-','').slice(0,24)}`;
    check(expected.every(s=>!s.memos.some(m=>m.id===u.memoId)&&!s.tags.some(t=>t.id===u.tagId||t.name.replace(/[A-Z]/g,c=>c.toLowerCase())===name.toLowerCase())),'collision');
    const invoke=async(label,name,p)=>{check(await confirm(label,{actor:i,id:p.p_id,expectedRevision:p.p_expected_revision,requestId:p.p_request_id??null,impact:'dedicated-only'}),'confirmation');return rpc(i,name,p);};
    const tag=await invoke(`tag-${i}`,'memo_save_tag',{p_id:u.tagId,p_name:name,p_expected_revision:null});
    check(tag?.id===u.tagId&&tag.user_id===u.userId&&tag.name===name&&String(tag.revision)==='1'&&Number.isFinite(Date.parse(tag.created_at)),'tag.response');
    expected[i].tags.push(tag);await verify();await progress(`tag-${i}`,{});
    const p={p_id:u.memoId,p_request_id:u.createId,p_expected_revision:null,p_title:`DBTEST-ISOLATION-${i}-${runId}`,p_body:`isolation ${i} ${runId}`,p_tag_ids:[u.tagId]};
    const saved=await invoke(`create-${i}`,'memo_save',p),m=saved?.memo;
    check(m?.id===u.memoId&&m.user_id===u.userId&&m.title===p.p_title&&m.body===p.p_body&&String(m.revision)==='1'
      &&m.last_request_id===u.createId&&m.deleted_at===null&&m.pinned_at===null&&m.created_at===m.updated_at
      &&Number.isFinite(Date.parse(m.created_at))&&equal(saved.tagIds,[u.tagId]),'memo.response');
    expected[i].memos.push(m);expected[i].memoTags.push({user_id:u.userId,memo_id:u.memoId,tag_id:u.tagId});await verify();await progress(`create-${i}`,{});
    const trash=await invoke(`trash-${i}`,'memo_change_state',{p_id:u.memoId,p_expected_revision:1,p_request_id:u.trashId,p_action:'trash'});
    check(trash&&String(trash.revision)==='2'&&Number.isFinite(Date.parse(trash.updated_at))&&Date.parse(trash.updated_at)>=Date.parse(m.updated_at)
      &&equal(trash,{...m,revision:trash.revision,updated_at:trash.updated_at,deleted_at:trash.updated_at,last_request_id:u.trashId}),'trash.response');
    expected[i].memos=expected[i].memos.map(r=>r.id===u.memoId?trash:r);await verify();await progress(`trash-${i}`,{});
  }
  for(let i=0;i<2;i++){
    for(const target of ['memos','tags','memo_tags']){
      const u=users[i],wanted=target==='memos'?{id:u.memoId,user_id:u.userId}:target==='tags'?{id:u.tagId,user_id:u.userId}:{user_id:u.userId,memo_id:u.memoId,tag_id:u.tagId};
      check(equal(await select(i,target,u),[wanted]),`${target}.own`);
      check(equal(await select(i,target,users[1-i]),[]),`${target}.foreign`);
      await progress(`select-${i}-${target}`,{ownVisible:true,foreignHidden:true,mechanism:'RLS-row-filter'});
    }
    const other=users[1-i];
    const probes=[
      ['edit','memo_save',{p_id:other.memoId,p_request_id:users[i].editId,p_expected_revision:2,p_title:'DBTEST denied edit',p_body:'denied edit',p_tag_ids:[]},500,'P0002','memo not found'],
      ['state','memo_change_state',{p_id:other.memoId,p_request_id:users[i].stateId,p_expected_revision:2,p_action:'restore'},500,'P0002','memo not found'],
      ['delete-memo','memo_delete_permanently',{p_id:other.memoId,p_expected_revision:2},409,'PT409','not found or revision conflict'],
      ['rename-tag','memo_save_tag',{p_id:other.tagId,p_name:`T23R-${runId.replaceAll('-','').slice(0,24)}`,p_expected_revision:1},409,'PT409','tag revision conflict'],
      ['delete-tag','memo_delete_tag',{p_id:other.tagId,p_expected_revision:1},409,'PT409','tag revision conflict']
    ];
    for(const [label,name,p,status,code,message] of probes){
      check(await confirm(`${label}-${i}`,{actor:i,targetOwner:1-i,id:p.p_id,expectedRevision:p.p_expected_revision,requestId:p.p_request_id??null,action:p.p_action??label,impact:'other-dedicated-fixture-only'}),'confirmation');
      const r=await rpc(i,name,p,{status,code,message});
      check(r?.rejected===true,'denial.receipt');await verify();
      await progress(`${label}-${i}`,{httpStatus:status,code,expectedMessageMatched:true,bothSnapshotsUnchanged:true,mechanism:'RPC-owner-filter'});
    }
  }
  return {denials:10,directSelects:12,rpcMaximum:50,confirmations:16,memosRetained:2,tagsRetained:2,relationsRetained:2,revision:2};
}

// Only GET table reads and the six explicit RPCs; no arbitrary URL/DML/admin route.
export function isolationApi(origin,key,token,fetchImpl=fetch){
  return async(name,p={},denial)=>{
    check(origin==='https://yohoppqflnhhvqypwhfv.supabase.co'&&/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)&&typeof token==='string'&&token.length>0,'connection');
    const table=['memos','tags','memo_tags'].includes(name);
    check(table||['memo_load_snapshot','memo_save_tag','memo_save','memo_change_state','memo_delete_tag','memo_delete_permanently'].includes(name),'route');
    let path=`/rest/v1/rpc/${name}`;
    if(table){check(UUID.test(p.memoId)&&UUID.test(p.tagId),'select.ids');path=name==='memo_tags'
      ?`/rest/v1/memo_tags?select=user_id,memo_id,tag_id&memo_id=eq.${p.memoId}&tag_id=eq.${p.tagId}`
      :`/rest/v1/${name}?select=id,user_id&id=eq.${name==='memos'?p.memoId:p.tagId}`;}
    const headers={apikey:key,Authorization:`Bearer ${token}`,...(!table?{'Content-Type':'application/json'}:{})};
    let response;try{response=await fetchImpl(`${origin}${path}`,{method:table?'GET':'POST',headers,...(!table?{body:JSON.stringify(p)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});}
    catch{throw new UsageDiagnostic('fetch通信',name);}
    const status=denial?.status??200;
    if(response.status!==status){try{await response.body?.cancel();}catch{}throw new UsageDiagnostic('HTTP応答',name,response.status);}
    let text;try{text=await response.text();}catch{throw new UsageDiagnostic('応答本文受信',name,response.status);}
    let data;try{data=JSON.parse(text);}catch{throw new UsageDiagnostic('JSON解析',name,response.status);}
    if(denial){check(data?.code===denial.code&&data?.message===denial.message,'denial.contract');return {rejected:true};}
    return data;
  };
}
