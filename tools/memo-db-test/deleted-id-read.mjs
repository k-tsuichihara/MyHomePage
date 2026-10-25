import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {pathToFileURL} from 'node:url';
import {loadConfig,readPassword,requestJson} from './cli.mjs';
import {collectRecordedIds,freshId} from './resolve-missing-contract.mjs';
import {safeUsageFailure} from './tag-usage-diagnostics.mjs';
import {UsageDiagnostic} from './tag-usage-diagnostics.mjs';
import {permanentDeleteRpc} from './permanent-delete-contract.mjs';
import {frozenSaveRpc,case26Source} from './deleted-replay-contract.mjs';
import {runDeletedIdCase,case27Source,deletedIdRejection} from './deleted-id-contract.mjs';
async function question(text){const r=createInterface({input:process.stdin,output:process.stdout});try{return await r.question(text);}finally{r.close();}}
async function main(){
  let password='',token,identity,writeNew,recorded=false,stage='設定';
  try{
    const {origin,key}=await loadConfig();if(!process.stdin.isTTY||!process.stdout.isTTY||process.argv.length!==2)throw new Error('invocation');
    console.log('ケース28 / dev-sandbox専用 / 最大12 RPC + 認証1回 / 書き込み確認5回');
    console.log('新規専用タグ・メモを作成し完全削除後、別の新規requestIdで1回だけ再作成試行します。誤成功時は復活の可能性あり。専用タグは残します。');
    stage='ケース26記録照合';const sourceRunId='27027609-0196-4590-8b96-4183a948a23e';
    const protectedRun=case26Source(JSON.parse(await readFile(new URL(`runs/${sourceRunId}.empty-trash-conflict.json`,import.meta.url),'utf8')),
      JSON.parse(await readFile(new URL(`runs/${sourceRunId}.empty-trash-conflict.result.json`,import.meta.url),'utf8')));
    const source27RunId='3f13bccc-a95c-4a7a-b7ea-978286bf5110';stage='ケース27記録照合';
    const protected27=case27Source(JSON.parse(await readFile(new URL(`runs/${source27RunId}.deleted-replay.json`,import.meta.url),'utf8')),
      JSON.parse(await readFile(new URL(`runs/${source27RunId}.deleted-replay.result.json`,import.meta.url),'utf8')),protectedRun);
    stage='認証';let email=(await question('dev-sandboxの専用テストユーザーのメールアドレス: ')).trim();if(!email)throw new Error('email');password=await readPassword();
    const auth=await requestJson(`${origin}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    email='';password='';if(typeof auth?.access_token!=='string'||!auth.access_token||typeof auth?.user?.id!=='string'||!auth.user.id)throw new Error('auth');token=auth.access_token;
    if(auth.user.id!==protectedRun.userId)throw new UsageDiagnostic('認証確認','case26.userMismatch');
    stage='識別記録';const directory=new URL('runs/',import.meta.url);await mkdir(directory,{recursive:true});const records=[];
    for(const e of await readdir(directory,{withFileTypes:true})){if(!e.name.endsWith('.json'))continue;if(!e.isFile())throw new Error('record');records.push(JSON.parse(await readFile(new URL(e.name,directory),'utf8')));}
    const ids=collectRecordedIds(records),runId=freshId(ids),memoId=freshId(ids),tagId=freshId(ids),requestId=freshId(ids),trashRequestId=freshId(ids),recreateRequestId=freshId(ids);
    identity={version:1,test:'deleted-id-read',runId,memoId,tagId,requestId,trashRequestId,recreateRequestId,userId:auth.user.id,
      sourceRunId,source27RunId,projectHost:new URL(origin).hostname,status:'prepared',startedAt:new Date().toISOString()};
    writeNew=(suffix,value)=>writeFile(new URL(`${runId}.deleted-id${suffix}.json`,directory),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
    await writeNew('',identity);recorded=true;console.log(`識別記録: tools/memo-db-test/runs/${runId}.deleted-id.json`);
    const normal=permanentDeleteRpc(origin,key,token);
    const result=await runDeletedIdCase({...identity,protectedRun,protected27,rejectCreate:deletedIdRejection(origin,key,token),saveFrozen:frozenSaveRpc(origin,key,token),rpc:(name,p)=>{if(!['memo_load_snapshot','memo_save_tag','memo_change_state','memo_delete_permanently'].includes(name))throw new Error('rpc');return normal(name,p);},setStage:s=>{stage=s;},
      confirm:async(action,summary)=>{stage=`${action}確認`;console.log(`操作: ${action} / ${JSON.stringify(summary)}`);
        console.log(action==='recreate'?'誤成功すると専用メモと関連が復活する可能性があります。別requestIdでの再作成試行は1回だけ。自動再送・復旧なし。':action==='delete'?'今回の専用メモと関連1件を完全削除します。タグ・対象外データは保持。削除は取り消しません。':'今回の新規専用データだけが対象です。');
        return await question(`続行するには ${action.toUpperCase()} と入力: `)===action.toUpperCase();},
      progress:async(action,detail)=>{stage=`${action}記録`;await writeNew(`.${action}.result`,{runId,memoId,tagId,action,...detail,status:'passed',completedAt:new Date().toISOString()});console.log(`PASS: ${action}`);}});
    await writeNew('.result',{...identity,...result,status:'passed',completedAt:new Date().toISOString()});
    console.log('PASS: 専用メモ・関連は削除、タグ・対象外データは不変、HTTP409/PT409/previously used memo idで再作成拒否、復活なし。内部registry・要求台帳は直接未確認。');
  }catch(error){
    const diagnostic=safeUsageFailure(error);
    if(recorded){try{await writeNew('.failure',{runId:identity.runId,memoId:identity.memoId,tagId:identity.tagId,stage,diagnostic,status:'failed',completedAt:new Date().toISOString()});}catch{console.log('FAIL: 失敗結果の保存失敗。元の識別記録は保持。');}}
    console.log(`FAIL: ${stage} / ${diagnostic.phase} / 項目=${diagnostic.item}${diagnostic.httpStatus!==undefined?` / HTTP ${diagnostic.httpStatus}`:''}。自動再送・削除・復旧なし。`);
    if(recorded)console.log('識別記録を保持しています。次の操作前に読み取り専用で確認してください。');process.exitCode=1;
  }finally{password='';token=undefined;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.log('FAIL: ケース28終了');process.exitCode=1;});
