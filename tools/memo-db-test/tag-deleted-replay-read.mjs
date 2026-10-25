import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {pathToFileURL} from 'node:url';
import {loadConfig,readPassword,requestJson} from './cli.mjs';
import {collectRecordedIds,freshId} from './resolve-missing-contract.mjs';
import {tagDeleteRpc} from './tag-delete-contract.mjs';
import {memoTagsRpc} from './memo-tags-contract.mjs';
import {safeUsageFailure} from './tag-usage-diagnostics.mjs';
import {runTagDeletedReplayCase,replayTagName} from './tag-deleted-replay-contract.mjs';
async function question(text){const p=createInterface({input:process.stdin,output:process.stdout});try{return await p.question(text);}finally{p.close();}}
async function main(){
  let password='',token,identity,writeNew,recorded=false,stage='設定';
  try{
    const {origin,key}=await loadConfig();if(!process.stdin.isTTY||!process.stdout.isTTY||process.argv.length!==2)throw new Error('invocation');
    console.log('ケース19・dev-sandbox専用。最大10 RPC（save_tag1・save2・delete_tag1・snapshot5・resolve1）、確認4回、別途認証1回。');
    console.log('削除前の保存要求を意図的に1回だけ完全同一で再送。履歴revision1を期待し、現行メモrevision2は変更させません。');
    stage='認証';let email=(await question('テストユーザーのメールアドレス: ')).trim();if(!email)throw new Error('email');password=await readPassword();
    const auth=await requestJson(`${origin}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    email='';password='';if(typeof auth?.access_token!=='string'||!auth.access_token||typeof auth?.user?.id!=='string'||!auth.user.id)throw new Error('auth');token=auth.access_token;
    stage='識別記録';const directory=new URL('runs/',import.meta.url);await mkdir(directory,{recursive:true});const records=[];
    for(const e of await readdir(directory,{withFileTypes:true})){if(!e.name.endsWith('.json'))continue;if(!e.isFile())throw new Error('record');records.push(JSON.parse(await readFile(new URL(e.name,directory),'utf8')));}
    const ids=collectRecordedIds(records),runId=freshId(ids),tagId=freshId(ids),memoId=freshId(ids),requestId=freshId(ids);
    identity={version:1,test:'tag-deleted-replay-read',runId,tagId,memoId,requestId,userId:auth.user.id,projectHost:new URL(origin).hostname,status:'prepared',startedAt:new Date().toISOString()};
    writeNew=(suffix,value)=>writeFile(new URL(`${runId}.tag-deleted-replay${suffix}.json`,directory),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
    await writeNew('',identity);recorded=true;console.log(`識別記録: tools/memo-db-test/runs/${runId}.tag-deleted-replay.json`);
    const headers={apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},normal=tagDeleteRpc(origin,headers),query=memoTagsRpc(origin,headers);
    const result=await runTagDeletedReplayCase({base:{p_id:memoId,p_request_id:requestId,p_expected_revision:null,
      p_title:`DBTEST-TAG-REPLAY-${runId}`,p_body:`tag deleted replay ${runId}`,p_tag_ids:[tagId]},tagId,tagName:replayTagName(runId),userId:auth.user.id,
      rpc:(name,payload)=>name==='memo_resolve_request'?query(name,payload):normal(name,payload),setStage:(s)=>{stage=s;},
      confirm:async(action,summary)=>{
        stage=`${action}確認`;console.log(`操作: ${action} / 対象: ${JSON.stringify(summary)}`);
        console.log('tag/createは専用データ作成、delete-tagは専用タグ削除、replayは凍結した作成要求の意図的再送1回です。自動再送・削除・復旧なし。');
        return await question(`続行は ${action.toUpperCase()} と入力: `)===action.toUpperCase();
      },progress:async(action,detail)=>{
        stage=`${action}記録`;await writeNew(`.${action}.result`,{runId,tagId,memoId,action,...detail,status:'passed',completedAt:new Date().toISOString()});console.log(`PASS: ${action}`);
      }});
    await writeNew('.result',{...identity,...result,status:'passed',completedAt:new Date().toISOString()});
    console.log('PASS: 削除済みタグを含む履歴結果revision1を返却、現行revision2・関連なし・last_request_id=null・全データ不変。専用通常メモ1件を保持。');
  }catch(error){
    const diagnostic=safeUsageFailure(error);
    if(recorded){try{await writeNew('.failure',{runId:identity.runId,tagId:identity.tagId,memoId:identity.memoId,stage,diagnostic,status:'failed',completedAt:new Date().toISOString()});}catch{console.log('FAIL: 失敗記録の新規保存失敗。元の識別記録は保持。');}}
    console.log(`FAIL: ${stage} / ${diagnostic.phase} / 項目=${diagnostic.item}${diagnostic.httpStatus!==undefined?` / HTTP ${diagnostic.httpStatus}`:''}。自動再送・削除・復旧なし。`);
    for(const line of diagnostic.diagnostics??[])console.log(line);
    if(recorded)console.log('識別記録を保持しています。次の操作前に読み取り専用で確認してください。');process.exitCode=1;
  }finally{password='';token=undefined;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.log('FAIL: タグ削除後リプレイテスト終了。');process.exitCode=1;});
