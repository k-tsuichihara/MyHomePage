import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {pathToFileURL} from 'node:url';
import {loadConfig,readPassword,requestJson} from './cli.mjs';
import {collectRecordedIds,freshId} from './resolve-missing-contract.mjs';
import {safeUsageFailure} from './tag-usage-diagnostics.mjs';
import {verifyDedicatedUser,runEmptyTrashConflictCase,emptyTrashCaseRpc,emptyTrashConflictResponse} from './empty-trash-conflict-contract.mjs';
async function question(text){const r=createInterface({input:process.stdin,output:process.stdout});try{return await r.question(text);}finally{r.close();}}
async function main(){
  let password='',token,identity,writeNew,recorded=false,stage='設定';
  try{
    const {origin,key}=await loadConfig();if(!process.stdin.isTTY||!process.stdout.isTTY||process.argv.length!==2)throw new Error('invocation');
    console.log('ケース26 / dev-sandboxの新規専用ユーザー限定 / 最大14 RPC + 認証1回 / 書き込み確認6回');
    console.log('既存ユーザー禁止。初期データが空でなければ停止。誤成功するとこのユーザーのゴミ箱全件が完全削除されます。');
    stage='過去ユーザー照合';const directory=new URL('runs/',import.meta.url);await mkdir(directory,{recursive:true});const records=[];
    for(const e of await readdir(directory,{withFileTypes:true})){if(!e.name.endsWith('.json'))continue;if(!e.isFile())throw new Error('record');records.push(JSON.parse(await readFile(new URL(e.name,directory),'utf8')));}
    const recordedIds=collectRecordedIds(records);
    const expectedUserId=(await question('Dashboardで確認したケース26専用の新規AuthユーザーID（UUID）: ')).trim().toLowerCase();
    verifyDedicatedUser(expectedUserId,expectedUserId,recordedIds);
    stage='認証';let email=(await question('その専用ユーザーのメールアドレス: ')).trim();if(!email)throw new Error('email');password=await readPassword();
    const auth=await requestJson(`${origin}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    email='';password='';if(typeof auth?.access_token!=='string'||!auth.access_token)throw new Error('auth');
    verifyDedicatedUser(expectedUserId,auth?.user?.id,recordedIds);token=auth.access_token;
    stage='識別記録';const ids=new Set([...recordedIds,auth.user.id.toLowerCase()]),runId=freshId(ids),tagId=freshId(ids),memoIds=[freshId(ids),freshId(ids)],requestIds=[freshId(ids),freshId(ids)],trashRequestIds=[freshId(ids),freshId(ids)];
    identity={version:1,test:'empty-trash-conflict-read',runId,tagId,memoIds,requestIds,trashRequestIds,userId:auth.user.id,projectHost:new URL(origin).hostname,status:'prepared',startedAt:new Date().toISOString()};
    writeNew=(suffix,value)=>writeFile(new URL(`${runId}.empty-trash-conflict${suffix}.json`,directory),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
    await writeNew('',identity);recorded=true;console.log(`識別記録: tools/memo-db-test/runs/${runId}.empty-trash-conflict.json`);
    const result=await runEmptyTrashConflictCase({...identity,expectedUserId,recordedIds,rpc:emptyTrashCaseRpc(origin,key,token),rejectEmpty:emptyTrashConflictResponse(origin,key,token),setStage:s=>{stage=s;},
      confirm:async(action,summary)=>{stage=`${action}確認`;console.log(`操作: ${action} / ${JSON.stringify(summary)}`);
        console.log(action==='empty-conflict'?'誤成功するとこのユーザーのゴミ箱全件が完全削除されます。確認入力後に全ID集合を再取得・照合します。正しいrevisionでの再削除・復旧なし。':'新規専用データのみ操作します。');
        return await question(`続行するには ${action.toUpperCase()} と入力: `)===action.toUpperCase();},
      progress:async(action,detail)=>{stage=`${action}記録`;await writeNew(`.${action}.result`,{runId,tagId,memoIds,action,...detail,status:'passed',completedAt:new Date().toISOString()});console.log(`PASS: ${action}`);}});
    await writeNew('.result',{...identity,...result,status:'passed',completedAt:new Date().toISOString()});
    console.log('PASS: HTTP409/PT409/trash revision conflict＋全データ不変。ゴミ箱内メモ2件revision=2・タグ1件・関連2件を保持。内部台帳・削除途中の障害ロールバックは未検証。');
  }catch(error){
    const diagnostic=safeUsageFailure(error);
    if(recorded){try{await writeNew('.failure',{runId:identity.runId,stage,diagnostic,status:'failed',completedAt:new Date().toISOString()});}catch{console.log('FAIL: 失敗結果の保存失敗。元の識別記録は保持。');}}
    console.log(`FAIL: ${stage} / ${diagnostic.phase} / 項目=${diagnostic.item}${diagnostic.httpStatus!==undefined?` / HTTP ${diagnostic.httpStatus}`:''}。自動再送・削除・復旧なし。`);
    if(recorded)console.log('識別記録を保持しています。再実行せず読み取り専用で状態を確認してください。');process.exitCode=1;
  }finally{password='';token=undefined;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.log('FAIL: ケース26終了');process.exitCode=1;});
