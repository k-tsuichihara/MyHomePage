import { isDeepStrictEqual as equal } from 'node:util';

function check(v) { if (!v) throw new Error('verification failed'); }
function micros(v) {
  check(typeof v === 'string' && Number.isFinite(Date.parse(v)));
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  check(m); return BigInt(Date.parse(`${m[1]}${m[3]}`))*1000n + BigInt((m[2] ?? '').padEnd(6,'0'));
}
function ordered(rows) { return [...rows].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); }
function same(a,b) {
  check(a && ['memos','tags','memoTags'].every((k) => Array.isArray(a[k]) && equal(ordered(a[k]),ordered(b[k]))));
}
export const INVALID_CASES = Object.freeze([
  ['action-null', { p_action: null }], ['action-empty', { p_action: '' }], ['action-unknown', { p_action: 'invalid-test-action' }],
  ['id-null', { p_id: null }], ['revision-null', { p_expected_revision: null }], ['request-null', { p_request_id: null }],
  ['revision-zero', { p_expected_revision: 0 }], ['revision-negative', { p_expected_revision: -1 }],
  ['revision-over-limit', { p_expected_revision: '9007199254740992' }],
].map(([name, overrides]) => Object.freeze({ name, overrides: Object.freeze(overrides), message: 'invalid argument' })));
export const REJECTION_NAMES = Object.freeze([...INVALID_CASES.map((c) => c.name), 'restore-normal', 'pin-trash', 'unpin-trash', 'trash-trash']);

export async function runInvalidStateCase({ base, trashRequestId, rejectionIds, userId, rpc, reject,
  confirm, progress = async () => {}, setStage = () => {} }) {
  const ids = [base.p_request_id, trashRequestId, ...REJECTION_NAMES.map((name) => rejectionIds[name])];
  check(base.p_expected_revision === null && Array.isArray(base.p_tag_ids) && base.p_tag_ids.length === 0
    && ids.every((id) => typeof id === 'string' && id.length > 0) && new Set(ids).size === ids.length);
  const snapshot = () => { setStage('スナップショット取得'); return rpc('memo_load_snapshot', {}); };
  const before = await snapshot(); same(before,before);
  check(!before.memos.some((m) => m.id === base.p_id));
  check(await confirm('create',base.p_id,{ p_id:base.p_id, p_request_id:base.p_request_id, p_expected_revision:null }));
  setStage('作成');
  const saved = await rpc('memo_save',base), initial = saved?.memo;
  check(initial && initial.id === base.p_id && initial.user_id === userId && initial.title === base.p_title
    && initial.body === base.p_body && String(initial.revision) === '1' && initial.last_request_id === base.p_request_id
    && initial.pinned_at === null && initial.deleted_at === null && initial.created_at === initial.updated_at
    && Array.isArray(saved.tagIds) && saved.tagIds.length === 0);
  micros(initial.created_at);
  let baseline = await snapshot(); same(baseline,{...before,memos:[...before.memos,initial]});
  await progress('create',{revision:1});
  const attempt = async (name, overrides, message, revision) => {
    const payload = {p_id:base.p_id,p_expected_revision:revision,p_request_id:rejectionIds[name],p_action:'pin',...overrides};
    check(await confirm(name,base.p_id,payload)); setStage(name);
    const response = await reject(payload);
    check(response.status === 400 && response.code === '22023' && response.message === message);
    same(await snapshot(),baseline);
    await progress(name,{revision,httpStatus:400,code:'22023',expectedMessageMatched:true});
  };
  for (const c of INVALID_CASES) await attempt(c.name,c.overrides,c.message,1);
  await attempt('restore-normal',{p_action:'restore'},'invalid memo state',1);
  const trash = {p_id:base.p_id,p_expected_revision:1,p_request_id:trashRequestId,p_action:'trash'};
  check(await confirm('prepare-trash',base.p_id,trash)); setStage('準備用ゴミ箱移動');
  const row = await rpc('memo_change_state',trash);
  check(row && String(row.revision) === '2' && micros(row.updated_at)>micros(initial.updated_at) && row.deleted_at===row.updated_at);
  const expected = {...initial,revision:row.revision,updated_at:row.updated_at,deleted_at:row.updated_at,last_request_id:trashRequestId};
  check(equal(row,expected)); baseline=await snapshot(); same(baseline,{...before,memos:[...before.memos,expected]});
  await progress('prepare-trash',{revision:2});
  for (const action of ['pin','unpin','trash']) await attempt(`${action}-trash`,{p_action:action},'invalid memo state',2);
  setStage('作成要求照合');
  const resolved=await rpc('memo_resolve_request',base);
  check(resolved?.status==='saved' && equal(resolved.result,saved));
  return {revision:2,deleted:true,rejectionsVerified:13,creationRequestResolved:true,
    stateRequestResolution:'not-verified-no-readonly-api',internalLedger:'not-directly-readable'};
}

export async function invalidStateResponse(url,headers,payload,fetchImpl=fetch) {
  const response=await fetchImpl(url,{method:'POST',headers,body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(response.status!==400) {
    try {await response.body?.cancel();}catch{}
    throw new Error('unexpected HTTP');
  }
  const data=await response.json();
  // Return only known values; never retain arbitrary server strings in diagnostics.
  return {status:400,code:data?.code==='22023'?'22023':null,
    message:['invalid argument','invalid memo state'].includes(data?.message)?data.message:null};
}
