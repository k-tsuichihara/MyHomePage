import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {pathToFileURL} from 'node:url';
import {loadConfig,readPassword,requestJson} from './cli.mjs';
import {collectRecordedIds,freshId} from './resolve-missing-contract.mjs';
import {safeUsageFailure} from './tag-usage-diagnostics.mjs';
import {UsageDiagnostic} from './tag-usage-diagnostics.mjs';
import {permanentDeleteRpc} from './permanent-delete-contract.mjs';
import {frozenSaveRpc,case26Source} from './deleted-replay-contract.mjs';
import {case27Source} from './deleted-id-contract.mjs';
import {runResolveMismatchCase,case28Source,resolveMismatchRejection} from './resolve-mismatch-contract.mjs';
async function question(text){const r=createInterface({input:process.stdin,output:process.stdout});try{return await r.question(text);}finally{r.close();}}
async function main(){
  let password='',token,identity,writeNew,recorded=false,stage='設定';
  try{
    const {origin,key}=await loadConfig();if(!process.stdin.isTTY||!process.stdout.isTTY||process.argv.length!==2)throw new Error('invocation');
    console.log('ケース29 / dev-sandbox専用 / 最大11 RPC + 認証1回 / 書き込み確認2回');
    console.log('専用タグ・メモを作成し、本文だけ異なる要求照合を1回実施。既存データを保護し、元保存結果も再照合します。削除操作なし。');
    stage='ケース26記録照合';const sourceRunId='27027609-0196-4590-8b96-4183a948a23e';
    const protectedRun=case26Source(JSON.parse(await readFile(new URL(`runs/${sourceRunId}.empty-trash-conflict.json`,import.meta.url),'utf8')),
      JSON.parse(await readFile(new URL(`runs/${sourceRunId}.empty-trash-conflict.result.json`,import.meta.url),'utf8')));
    const source27RunId='3f13bccc-a95c-4a7a-b7ea-978286bf5110';stage='ケース27記録照合';
    const protected27=case27Source(JSON.parse(await readFile(new URL(`runs/${source27RunId}.deleted-replay.json`,import.meta.url),'utf8')),
      JSON.parse(await readFile(new URL(`runs/${source27RunId}.deleted-replay.result.json`,import.meta.url),'utf8')),protectedRun);
    const source28RunId='4f502bf4-1184-4e2a-b6f5-d41bf9934109';stage='ケース28記録照合';
    const protected28=case28Source(JSON.parse(await readFile(new URL(`runs/${source28RunId}.deleted-id.json`,import.meta.url),'utf8')),
      JSON.parse(await readFile(new URL(`runs/${source28RunId}.deleted-id.result.json`,import.meta.url),'utf8')),protectedRun,protected27);
    stage='認証';let email=(await question('dev-sandboxの専用テストユーザーのメールアドレス: ')).trim();if(!email)throw new Error('email');password=await readPassword();
    const auth=await requestJson(`${origin}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    email='';password='';if(typeof auth?.access_token!=='string'||!auth.access_token||typeof auth?.user?.id!=='string'||!auth.user.id)throw new Error('auth');token=auth.access_token;
    if(auth.user.id!==protectedRun.userId)throw new UsageDiagnostic('認証確認','case26.userMismatch');
    stage='識別記録';const directory=new URL('runs/',import.meta.url);await mkdir(directory,{recursive:true});const records=[];
    for(const e of await readdir(directory,{withFileTypes:true})){if(!e.name.endsWith('.json'))continue;if(!e.isFile())throw new Error('record');records.push(JSON.parse(await readFile(new URL(e.name,directory),'utf8')));}
    const ids=collectRecordedIds(records),runId=freshId(ids),memoId=freshId(ids),tagId=freshId(ids),requestId=freshId(ids);
    identity={version:1,test:'resolve-mismatch-read',runId,memoId,tagId,requestId,userId:auth.user.id,
      sourceRunId,source27RunId,source28RunId,projectHost:new URL(origin).hostname,status:'prepared',startedAt:new Date().toISOString()};
    writeNew=(suffix,value)=>writeFile(new URL(`${runId}.resolve-mismatch${suffix}.json`,directory),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
    await writeNew('',identity);recorded=true;console.log(`識別記録: tools/memo-db-test/runs/${runId}.resolve-mismatch.json`);
    const normal=permanentDeleteRpc(origin,key,token);
    const result=await runResolveMismatchCase({...identity,protectedRun,protected27,protected28,rejectResolve:resolveMismatchRejection(origin,key,token),saveFrozen:frozenSaveRpc(origin,key,token),rpc:(name,p)=>{if(!['memo_load_snapshot','memo_save_tag','memo_resolve_request'].includes(name))throw new Error('rpc');return normal(name,p);},setStage:s=>{stage=s;},
      confirm:async(action,summary)=>{stage=`${action}確認`;console.log(`操作: ${action} / ${JSON.stringify(summary)}`);
        console.log('今回の専用タグ/メモを新規作成して保持します。既存データの変更・削除は行いません。');
        return await question(`続行するには ${action.toUpperCase()} と入力: `)===action.toUpperCase();},
      progress:async(action,detail)=>{stage=`${action}記録`;await writeNew(`.${action}.result`,{runId,memoId,tagId,action,...detail,status:'passed',completedAt:new Date().toISOString()});console.log(`PASS: ${action}`);}});
    await writeNew('.result',{...identity,...result,status:'passed',completedAt:new Date().toISOString()});
    console.log('PASS: HTTP400/22023/request mismatch＋全データ不変＋元保存結果一致。専用メモ・タグ・関連各1件保持。内部台帳は直接未確認。');
  }catch(error){
    const diagnostic=safeUsageFailure(error);
    if(recorded){try{await writeNew('.failure',{runId:identity.runId,memoId:identity.memoId,tagId:identity.tagId,stage,diagnostic,status:'failed',completedAt:new Date().toISOString()});}catch{console.log('FAIL: 失敗結果の保存失敗。元の識別記録は保持。');}}
    console.log(`FAIL: ${stage} / ${diagnostic.phase} / 項目=${diagnostic.item}${diagnostic.httpStatus!==undefined?` / HTTP ${diagnostic.httpStatus}`:''}。自動再送・削除・復旧なし。`);
    if(recorded)console.log('識別記録を保持しています。次の操作前に読み取り専用で確認してください。');process.exitCode=1;
  }finally{password='';token=undefined;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.log('FAIL: ケース29終了');process.exitCode=1;});
