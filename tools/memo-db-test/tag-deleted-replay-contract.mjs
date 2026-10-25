import {isDeepStrictEqual as equal} from 'node:util';
import {compareTagDeleteSnapshots} from './tag-delete-contract.mjs';
import {UsageDiagnostic} from './tag-usage-diagnostics.mjs';
const check=(v,item)=>{if(!v)throw new UsageDiagnostic('取得後検証',item);};
function micros(v){
  check(typeof v==='string'&&Number.isFinite(Date.parse(v)),'timestamp');
  const m=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  check(m,'timestamp.format');return BigInt(Date.parse(`${m[1]}${m[3]}`))*1000n+BigInt((m[2]??'').padEnd(6,'0'));
}
export function replayTagName(runId){check(/^[0-9a-f-]{36}$/.test(runId),'runId');return `T19A-${runId.replaceAll('-','').slice(0,24)}`;}
export async function runTagDeletedReplayCase({base,tagId,tagName,userId,rpc,confirm,progress=async()=>{},setStage=()=>{}}){
  check(new Set([base.p_id,base.p_request_id,tagId]).size===3&&base.p_expected_revision===null
    &&equal(base.p_tag_ids,[tagId])&&/^[A-Za-z0-9-]{1,30}$/.test(tagName),'input');
  const read=(label)=>{setStage(`${label}: スナップショット取得`);return rpc('memo_load_snapshot',{});};
  const before=await read('initial');compareTagDeleteSnapshots(before,before);
  check(!before.memos.some((m)=>m.id===base.p_id)&&!before.tags.some((t)=>t.id===tagId
    ||t.name.replace(/[A-Z]/g,(c)=>c.toLowerCase())===tagName.toLowerCase()),'input.collision');
  const expected=structuredClone(before);
  check(await confirm('tag',{id:tagId,expectedRevision:null}),'confirmation');setStage('タグ作成');
  const tag=await rpc('memo_save_tag',{p_id:tagId,p_name:tagName,p_expected_revision:null});
  check(tag&&tag.id===tagId&&tag.name===tagName&&tag.user_id===userId&&String(tag.revision)==='1','tag.response');micros(tag.created_at);
  expected.tags.push(tag);compareTagDeleteSnapshots(await read('tag'),expected);await progress('tag',{});
  // One serialized immutable request for both initial save and intentional replay.
  const frozen=JSON.stringify(base);
  check(await confirm('create',{id:base.p_id,requestId:base.p_request_id,expectedRevision:null,tagIds:[tagId]}),'confirmation');setStage('メモ作成');
  const saved=await rpc('memo_save',JSON.parse(frozen)),initial=saved?.memo;
  check(initial&&initial.id===base.p_id&&initial.user_id===userId&&initial.title===base.p_title&&initial.body===base.p_body
    &&String(initial.revision)==='1'&&initial.last_request_id===base.p_request_id&&initial.pinned_at===null&&initial.deleted_at===null
    &&initial.created_at===initial.updated_at&&equal(saved.tagIds,[tagId]),'save.response');micros(initial.created_at);
  expected.memos.push(initial);expected.memoTags.push({user_id:userId,memo_id:base.p_id,tag_id:tagId});
  compareTagDeleteSnapshots(await read('create'),expected);await progress('create',{revision:1,linkedTagCount:1});
  check(await confirm('delete-tag',{id:tagId,expectedRevision:1,affectedMemoId:base.p_id}),'confirmation');setStage('専用タグ削除');
  check(await rpc('memo_delete_tag',{p_id:tagId,p_expected_revision:1})===null,'delete.voidResponse');
  const baseline=await read('delete-tag');setStage('delete-tag: 取得後検証');
  check(baseline&&Array.isArray(baseline.memos),'snapshot.memos.array');
  const matches=baseline.memos.filter((m)=>m?.id===base.p_id),current=matches[0];
  check(matches.length===1&&String(current.revision)==='2'&&micros(current.updated_at)>micros(initial.updated_at),'delete.memoRevisionAndTime');
  const wanted={...initial,revision:current.revision,updated_at:current.updated_at,last_request_id:null};
  check(equal(current,wanted),'delete.memoAllFields');
  expected.tags=expected.tags.filter((t)=>t.id!==tagId);expected.memoTags=expected.memoTags.filter((r)=>r.tag_id!==tagId);
  expected.memos=expected.memos.map((m)=>m.id===base.p_id?wanted:m);
  compareTagDeleteSnapshots(baseline,expected);await progress('delete-tag',{revision:2,linkedTagCount:0,lastRequestIdCleared:true});
  check(await confirm('replay',{id:base.p_id,requestId:base.p_request_id,expectedRevision:null,deletedTagId:tagId}),'confirmation');setStage('意図的な同一保存要求リプレイ');
  const replayed=await rpc('memo_save',JSON.parse(frozen));
  check(equal(replayed,saved),'replay.historicalResponse');
  compareTagDeleteSnapshots(await read('replay'),baseline);
  setStage('保存履歴の読み取り専用照合');
  const resolved=await rpc('memo_resolve_request',JSON.parse(frozen));
  check(resolved?.status==='saved'&&equal(resolved.result,saved),'resolve.historicalResponse');
  await progress('replay',{historicalRevision:1,currentRevision:2,allDataUnchanged:true});
  return {currentRevision:2,historicalRevision:1,tagsRetained:0,linkedTagCount:0,lastRequestId:null,
    replayVerified:true,historyResolved:true,trashReplay:'not-tested-normal-memo-only',ledger:'not-directly-readable'};
}
