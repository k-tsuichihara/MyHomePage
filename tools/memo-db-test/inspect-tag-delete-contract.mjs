import {isDeepStrictEqual as equal} from 'node:util';
import {tagUsage} from './tag-usage-contract.mjs';
import {InspectionError} from './inspect-tag-usage-contract.mjs';
export {InspectionError,inspectionRequest} from './inspect-tag-usage-contract.mjs';
export const TARGET_RUN='9fec4de4-3fc6-493e-856f-ad8a469ae86b';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function check(v){if(!v)throw new InspectionError('取得後検証');}
export function validateDeleteRecords({identity:r,deleted,kept,failure},host){
  check(r?.version===1&&r.test==='tag-delete-read'&&r.runId===TARGET_RUN&&r.status==='prepared'
    &&r.projectHost===host&&UUID.test(r.userId)&&Array.isArray(r.tagIds)&&r.tagIds.length===2
    &&Array.isArray(r.memoIds)&&r.memoIds.length===2&&Array.isArray(r.requestIds)&&r.requestIds.length===3);
  const ids=[...r.tagIds,...r.memoIds,...r.requestIds];check(ids.every((id)=>UUID.test(id))&&new Set(ids).size===7);
  check(r.memoIds[0]==='ffa12df4-197e-4045-ae11-23a296a735f7'&&r.requestIds[0]==='fe9314ca-9a51-4ab8-9b78-1baa184dcd29');
  for(const [record,action] of [[deleted,'tag-delete'],[kept,'tag-keep']]){
    check(record?.runId===r.runId&&record.action===action&&record.status==='passed'
      &&equal(record.tagIds,r.tagIds)&&equal(record.memoIds,r.memoIds));
  }
  check(failure?.runId===r.runId&&failure.status==='failed'&&failure.stage==='memo-1: 取得後検証'
    &&failure.diagnostic?.phase==='取得後検証'&&failure.diagnostic?.item==='snapshot.memoTags.allFields'
    &&equal(failure.tagIds,r.tagIds)&&equal(failure.memoIds,r.memoIds));
  const times=[r.startedAt,deleted.completedAt,kept.completedAt,failure.completedAt];
  check(times.every((v)=>typeof v==='string'&&Number.isFinite(Date.parse(v))));
  check(times.every((v,i)=>i===0||Date.parse(times[i-1])<=Date.parse(v)));return r;
}
export function inspectDeleteSnapshot(r,s){
  check(s&&['memos','tags','memoTags'].every((k)=>Array.isArray(s[k])));
  check(s.memos.every((m)=>m&&typeof m.id==='string')&&s.tags.every((t)=>t&&typeof t.id==='string')
    &&s.memoTags.every((rel)=>rel&&typeof rel.memo_id==='string'&&typeof rel.tag_id==='string'));
  const checks=[],report=(field,passed,summary)=>checks.push({field,passed:Boolean(passed),...(summary?{summary}:{})});
  const suffix=r.runId.replaceAll('-','').slice(0,24);
  for(let i=0;i<2;i++){
    const rows=s.tags.filter((t)=>t.id===r.tagIds[i]),t=rows[0],label=i===0?'tag-delete-planned':'tag-keep';
    report(`${label}.existsOnce`,rows.length===1);report(`${label}.owner`,t?.user_id===r.userId);
    report(`${label}.nameMatches`,t?.name===`T18${i===0?'D':'K'}-${suffix}`);report(`${label}.revision`,String(t?.revision)==='1');
  }
  const rows=s.memos.filter((m)=>m.id===r.memoIds[0]),m=rows[0];
  report('memo-1.existsOnce',rows.length===1);report('memo-1.owner',m?.user_id===r.userId);
  report('memo-1.revision',String(m?.revision)==='1',`期待=1、現在=${/^[0-9]{1,16}$/.test(String(m?.revision))?String(m.revision):'不明・不正'}`);
  report('memo-1.last_request_id',m?.last_request_id===r.requestIds[0]);
  report('memo-1.titleMatches',m?.title===`DBTEST-TAG-DELETE-1-${r.runId}`);
  report('memo-1.bodyMatches',m?.body===`tag delete test 1 ${r.runId}`);
  report('memo-1.deleted_at',m?.deleted_at===null);report('memo-1.pinned_at',m?.pinned_at===null);
  report('memo-1.initialDatesConsistent',typeof m?.created_at==='string'&&Number.isFinite(Date.parse(m.created_at))&&m.created_at===m.updated_at);
  const links=s.memoTags.filter((rel)=>rel.memo_id===r.memoIds[0]);
  report('memo-1.totalTagRelations',links.length===2,`期待=2件、現在=${links.length}件`);
  for(let i=0;i<2;i++){
    const matches=links.filter((rel)=>rel.tag_id===r.tagIds[i]);
    report(`memo-1.${i===0?'deleteTag':'keepTag'}.relatedOnce`,matches.length===1);
    report(`memo-1.${i===0?'deleteTag':'keepTag'}.relationOwner`,matches.length===1&&matches[0].user_id===r.userId);
    report(`${i===0?'deleteTag':'keepTag'}.onlyMemo1Linked`,s.memoTags.filter((rel)=>rel.tag_id===r.tagIds[i]).every((rel)=>rel.memo_id===r.memoIds[0]));
  }
  report('memo-2.absent',!s.memos.some((row)=>row.id===r.memoIds[1]));
  report('memo-2.noRelations',!s.memoTags.some((rel)=>rel.memo_id===r.memoIds[1]));
  try{tagUsage(s,r.userId);report('snapshot.referentialIntegrity',true);}catch{report('snapshot.referentialIntegrity',false);}
  return checks;
}
