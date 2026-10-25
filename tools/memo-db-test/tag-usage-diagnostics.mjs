import {diagnoseFetchError} from './conflict-response.mjs';

export class UsageDiagnostic extends Error {
  constructor(phase,item,status,diagnostics=[]) {
    super('tag usage diagnostic');this.phase=phase;this.item=item;this.status=status;this.diagnostics=diagnostics;
  }
}
// Fields originate from this fixed list, never from arbitrary database keys or values.
export const SAFE_ROW_FIELDS=['id','user_id','title','body','name','created_at','updated_at','revision',
  'last_request_id','pinned_at','deleted_at','memo_id','tag_id'];

export async function usageSnapshot(origin,headers,fetchImpl=fetch) {
  if(origin!=='https://yohoppqflnhhvqypwhfv.supabase.co')throw new UsageDiagnostic('接続先検証','origin');
  let response;
  try {
    response=await fetchImpl(`${origin}/rest/v1/rpc/memo_load_snapshot`,{
      method:'POST',headers,body:'{}',redirect:'error',signal:AbortSignal.timeout(15000),
    });
  } catch(e) {
    const safe=[];diagnoseFetchError(e,(line)=>safe.push(line));
    throw new UsageDiagnostic('fetch通信','memo_load_snapshot',undefined,safe);
  }
  if(response.status!==200) {
    try {await response.body?.cancel();}catch{}
    throw new UsageDiagnostic('HTTP応答','memo_load_snapshot',response.status);
  }
  let text;
  try {text=await response.text();}catch(e) {
    const safe=[];diagnoseFetchError(e,(line)=>safe.push(line));
    throw new UsageDiagnostic('応答本文受信','memo_load_snapshot',200,safe);
  }
  try {return JSON.parse(text);}catch {throw new UsageDiagnostic('JSON解析','memo_load_snapshot',200);}
}

export function safeUsageFailure(error) {
  if(!(error instanceof UsageDiagnostic))return {phase:'処理例外',item:'不明（詳細非表示）'};
  return {phase:error.phase,item:error.item,...(Number.isInteger(error.status)?{httpStatus:error.status}:{}),
    ...(error.diagnostics.length?{diagnostics:error.diagnostics}:{})};
}
