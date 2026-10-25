import {isDeepStrictEqual as equal} from 'node:util';
import {usageNames,tagUsage} from './tag-usage-contract.mjs';
import {diagnoseFetchError} from './conflict-response.mjs';

export const TARGET_RUN='5efbc55f-5c15-400e-8f99-fc2682f1ad61';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ORIGIN='https://yohoppqflnhhvqypwhfv.supabase.co';
export class InspectionError extends Error{
  constructor(phase,status,diagnostics=[]){super('inspection failed');this.phase=phase;this.status=status;this.diagnostics=diagnostics;}
}
function check(v){if(!v)throw new InspectionError('取得後検証');}
export function validateUsageRecords({identity:r,used,unused,failure},host){
  check(r?.version===1&&r.test==='tag-usage-read'&&r.runId===TARGET_RUN&&r.status==='prepared'
    &&r.projectHost===host&&UUID.test(r.userId)&&Array.isArray(r.tagIds)&&r.tagIds.length===2
    &&Array.isArray(r.memoIds)&&r.memoIds.length===2&&Array.isArray(r.requestIds)&&r.requestIds.length===4);
  const ids=[...r.tagIds,...r.memoIds,...r.requestIds];
  check(ids.every((id)=>UUID.test(id))&&new Set(ids).size===8);
  check(r.memoIds[0]==='a7d08104-f2ef-48e0-9cd2-7378b9ec8363'&&r.requestIds[0]==='241be954-fceb-462e-920f-82c189639910');
  for(const [record,action] of [[used,'tag-used'],[unused,'tag-unused']]){
    check(record?.runId===r.runId&&record.action===action&&record.status==='passed'
      &&equal(record.tagIds,r.tagIds)&&equal(record.memoIds,r.memoIds)&&record.usedTagCount===0
      &&record.unusedTagCount===(action==='tag-used'?null:0));
  }
  check(failure?.runId===r.runId&&failure.status==='failed'&&failure.stage==='スナップショット取得'
    &&equal(failure.tagIds,r.tagIds)&&equal(failure.memoIds,r.memoIds));
  check([r.startedAt,used.completedAt,unused.completedAt,failure.completedAt].every((v)=>typeof v==='string'&&Number.isFinite(Date.parse(v))));
  check(Date.parse(r.startedAt)<=Date.parse(used.completedAt)&&Date.parse(used.completedAt)<=Date.parse(unused.completedAt)
    &&Date.parse(unused.completedAt)<=Date.parse(failure.completedAt));
  return r;
}

// No arbitrary RPC or payload for snapshot. Authentication is the only other endpoint.
export async function inspectionRequest(origin,key,kind,{email,password,token}={},fetchImpl=fetch){
  if(origin!==ORIGIN||!['login','snapshot'].includes(kind))throw new InspectionError('接続先・呼出種別検証');
  if(kind==='snapshot'&&(typeof token!=='string'||!token))throw new InspectionError('認証結果検証');
  const path=kind==='login'?'/auth/v1/token?grant_type=password':'/rest/v1/rpc/memo_load_snapshot';
  const body=kind==='login'?JSON.stringify({email,password}):'{}';
  let response;
  try{
    response=await fetchImpl(`${origin}${path}`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json',
      ...(kind==='snapshot'?{Authorization:`Bearer ${token}`}:{})},body,redirect:'error',signal:AbortSignal.timeout(15000)});
  }catch(e){const safe=[];diagnoseFetchError(e,(line)=>safe.push(line));throw new InspectionError('fetch通信',undefined,safe);}
  if(response.status!==200){try{await response.body?.cancel();}catch{}throw new InspectionError('HTTP応答',response.status);}
  let text;
  try{text=await response.text();}catch(e){const safe=[];diagnoseFetchError(e,(line)=>safe.push(line));throw new InspectionError('応答本文受信',200,safe);}
  try{return JSON.parse(text);}catch{throw new InspectionError('JSON解析',200);}
}

export function inspectUsageSnapshot(r,s){
  check(s&&['memos','tags','memoTags'].every((key)=>Array.isArray(s[key])));
  check(s.memos.every((m)=>m&&typeof m.id==='string')&&s.tags.every((t)=>t&&typeof t.id==='string')
    &&s.memoTags.every((rel)=>rel&&typeof rel.memo_id==='string'&&typeof rel.tag_id==='string'));
  const checks=[];
  const report=(field,passed,summary)=>checks.push({field,passed:Boolean(passed),...(summary?{summary}:{})});
  const names=usageNames(r.runId);
  for(let i=0;i<2;i++){
    const tags=s.tags.filter((t)=>t.id===r.tagIds[i]),t=tags[0],prefix=`tag-${i===0?'used':'unused'}`;
    report(`${prefix}.existsOnce`,tags.length===1);
    report(`${prefix}.owner`,t?.user_id===r.userId);
    report(`${prefix}.nameMatches`,t?.name===names[i]);
    report(`${prefix}.revision`,String(t?.revision)==='1');
  }
  const rows=s.memos.filter((m)=>m.id===r.memoIds[0]),m=rows[0];
  report('memo-1.existsOnce',rows.length===1);
  report('memo-1.owner',m?.user_id===r.userId);
  report('memo-1.revision',String(m?.revision)==='1',`期待=1、現在=${/^[0-9]{1,16}$/.test(String(m?.revision))?String(m.revision):'不明・不正'}`);
  report('memo-1.last_request_id',m?.last_request_id===r.requestIds[0]);
  report('memo-1.deleted_at',m?.deleted_at===null,m?.deleted_at===null?'通常メモ':typeof m?.deleted_at==='string'?'ゴミ箱状態（日時の実値は非表示）':'不明');
  report('memo-1.pinned_at',m?.pinned_at===null);
  report('memo-1.titleMatches',m?.title===`DBTEST-USAGE-1-${r.runId}`);
  report('memo-1.bodyMatches',m?.body===`tag usage test 1 ${r.runId}`);
  report('memo-1.initialDatesConsistent',typeof m?.created_at==='string'&&Number.isFinite(Date.parse(m.created_at))&&m.created_at===m.updated_at);
  const links=s.memoTags.filter((rel)=>rel.memo_id===r.memoIds[0]);
  report('memo-1.tagRelations',links.length===1&&links[0].tag_id===r.tagIds[0]&&links[0].user_id===r.userId,`期待=1件、現在=${links.length}件`);
  report('memo-2.absent',!s.memos.some((row)=>row.id===r.memoIds[1]));
  report('memo-2.noRelations',!s.memoTags.some((rel)=>rel.memo_id===r.memoIds[1]));
  report('tag-used.onlyMemo1Linked',s.memoTags.filter((rel)=>rel.tag_id===r.tagIds[0]).every((rel)=>rel.memo_id===r.memoIds[0]));
  report('tag-unused.noRelations',!s.memoTags.some((rel)=>rel.tag_id===r.tagIds[1]));
  // Compute only after detailed checks, retaining them if global referential validation fails.
  try{
    const counts=tagUsage(s,r.userId);
    report('tag-used.normalMemoCount',counts.get(r.tagIds[0])===1,`期待=1、現在=${counts.get(r.tagIds[0])??'タグ不在'}`);
    report('tag-unused.normalMemoCount',counts.get(r.tagIds[1])===0,`期待=0、現在=${counts.get(r.tagIds[1])??'タグ不在'}`);
    report('snapshot.referentialIntegrity',true);
  }catch{report('snapshot.referentialIntegrity',false);}
  return checks;
}
