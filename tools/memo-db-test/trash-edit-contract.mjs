import { isDeepStrictEqual as equal } from 'node:util';
import { runTrashCase } from './trash-contract.mjs';

function check(v) { if (!v) throw new Error('verification failed'); }
function ordered(rows) { return [...rows].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); }
function same(a,b) {
  check(a && ['memos','tags','memoTags'].every((k) => Array.isArray(a[k]) && equal(ordered(a[k]),ordered(b[k]))));
}
export async function runTrashEditCase({ base, trashRequestId, editRequestId, userId, rpc, rejectEdit,
  confirm, progress = async () => {}, setStage = () => {} }) {
  check(typeof editRequestId === 'string' && editRequestId.length > 0
    && ![base.p_request_id,trashRequestId].includes(editRequestId));
  let baseline;
  // Case8 establishes creation, trash state, all non-target data, and the historical creation receipt.
  await runTrashCase({ base, trashRequestId, userId, confirm, progress, setStage,
    rpc: async (name,payload) => {
      const result=await rpc(name,payload);
      if(name==='memo_load_snapshot') baseline=structuredClone(result);
      return result;
    },
  });
  const targets=baseline.memos.filter((m)=>m.id===base.p_id);
  check(targets.length===1 && String(targets[0].revision)==='2' && targets[0].deleted_at!==null
    && targets[0].last_request_id===trashRequestId);
  const submitted={...base,p_request_id:editRequestId,p_expected_revision:2,
    p_title:`${base.p_title} edited`,p_body:`${base.p_body}\nedit attempt ${editRequestId}`,p_tag_ids:[]};
  check(submitted.p_title!==targets[0].title && submitted.p_body!==targets[0].body);
  // Retain this exact request for the later read-only hash comparison; never resend memo_save.
  const frozen=JSON.stringify(submitted);
  check(await confirm('edit',base.p_id)); setStage('ゴミ箱内編集拒否');
  const rejection=await rejectEdit(JSON.parse(frozen));
  check(rejection.status===409 && rejection.codeMatches===true && rejection.messageMatches===true);
  setStage('拒否後スナップショット');
  same(await rpc('memo_load_snapshot',{}),baseline);
  setStage('拒否された保存要求の読み取り専用照合');
  const resolved=await rpc('memo_resolve_request',JSON.parse(frozen));
  check(resolved===null);
  await progress('edit',{revision:2,httpStatus:409,code:'PT409',expectedMessageMatched:true,rejectedSaveResolution:'null-not-proof-of-non-execution'});
  return {revision:2,deleted:true,creationRequestResolved:true,rejectedSaveResolution:'null-not-proof-of-non-execution',
    internalLedger:'not-directly-readable',stateRequestResolution:'not-verified-no-readonly-api',
    tagChange:'not-tested-empty-tags',rejectionReason:'combined-sql-guard-latest-revision-observed-not-server-discriminated'};
}

export async function trashEditResponse(url,headers,payload,fetchImpl=fetch) {
  const response=await fetchImpl(url,{method:'POST',headers,body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(response.status!==409) {
    try {await response.body?.cancel();}catch{}
    throw new Error('unexpected HTTP');
  }
  const data=await response.json();
  return {status:409,codeMatches:data?.code==='PT409',messageMatches:data?.message==='memo revision conflict'};
}
