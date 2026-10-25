import { isDeepStrictEqual as equal } from 'node:util';
function check(v) { if (!v) throw new Error('verification failed'); }
function ordered(rows) { return [...rows].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))); }
function same(a,b) { check(a && ['memos','tags','memoTags'].every((k)=>Array.isArray(a[k])&&equal(ordered(a[k]),ordered(b[k])))); }
const key=(s)=>s.replace(/[A-Z]/g,(c)=>c.toLowerCase());
export function tagNames(runId) {
  check(/^[0-9a-f-]{36}$/.test(runId));
  const suffix=runId.replaceAll('-','').slice(0,24);
  return ['A','B','C'].map((v)=>`T13${v}-${suffix}`);
}
export async function runTagEditCase({tagId,names,userId,rpc,confirm,progress=async()=>{},setStage=()=>{}}) {
  check(typeof tagId==='string' && names?.length===3 && new Set(names.map(key)).size===3
    && names.every((n)=>/^[A-Za-z0-9-]{1,30}$/.test(n)));
  const snapshot=()=>{setStage('スナップショット取得');return rpc('memo_load_snapshot',{});};
  const before=await snapshot();same(before,before);
  check(!before.tags.some((t)=>t.id===tagId||names.some((n)=>key(n)===key(t.name))));
  const expectedSnapshot=(tag)=>({...before,tags:[...before.tags,tag]});
  const create={p_id:tagId,p_name:names[0],p_expected_revision:null};
  check(await confirm('create',create));setStage('タグ作成');
  const initial=await rpc('memo_save_tag',create);
  check(initial && initial.id===tagId && initial.user_id===userId && initial.name===names[0]
    && String(initial.revision)==='1' && typeof initial.created_at==='string' && Number.isFinite(Date.parse(initial.created_at)));
  same(await snapshot(),expectedSnapshot(initial));await progress('create',{revision:1});
  const rename={p_id:tagId,p_name:names[1],p_expected_revision:1};
  check(await confirm('rename',rename));setStage('タグ名前変更');
  const changed=await rpc('memo_save_tag',rename);
  check(changed && String(changed.revision)==='2' && equal(changed,{...initial,name:names[1],revision:changed.revision}));
  const baseline=await snapshot();same(baseline,expectedSnapshot(changed));await progress('rename',{revision:2});
  const conflict={p_id:tagId,p_name:names[2],p_expected_revision:1};
  check(await confirm('conflict',conflict));setStage('タグrevision競合');
  const rejected=await rpc('memo_save_tag',conflict,true);
  check(rejected.status===409 && rejected.codeMatches===true && rejected.messageMatches===true);
  same(await snapshot(),baseline);await progress('conflict',{revision:2,httpStatus:409,code:'PT409',expectedMessageMatched:true});
  return {revision:2,conflictVerified:true,requestResolution:'not-supported-no-request-id-or-ledger',
    nameDuplicate:'not-tested-case14',linkedMemoEffect:'not-tested-unlinked-tag'};
}
export function tagRpc(origin,headers,fetchImpl=fetch) {
  return async(name,payload,rejection=false)=>{
    check(['memo_save_tag','memo_load_snapshot'].includes(name));
    check(!rejection||name==='memo_save_tag');
    const response=await fetchImpl(`${origin}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(payload),
      redirect:'error',signal:AbortSignal.timeout(15000)});
    if(response.status!==(rejection?409:200)) {
      try{await response.body?.cancel();}catch{}
      throw new Error('unexpected HTTP');
    }
    const data=await response.json();
    return rejection?{status:409,codeMatches:data?.code==='PT409',messageMatches:data?.message==='tag revision conflict'}:data;
  };
}
