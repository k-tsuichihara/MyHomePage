import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {pathToFileURL} from 'node:url';
import {loadConfig,readPassword,requestJson} from './cli.mjs';
import {collectRecordedIds,freshId} from './resolve-missing-contract.mjs';
import {safeUsageFailure} from './tag-usage-diagnostics.mjs';
import {permanentDeleteRpc} from './permanent-delete-contract.mjs';
import {deleteConflictResponse,runDeleteConflictCase} from './delete-conflict-contract.mjs';
async function question(text){const r=createInterface({input:process.stdin,output:process.stdout});try{return await r.question(text);}finally{r.close();}}
async function main(){
  let password='',token,identity,writeNew,recorded=false,stage='設定';
  try{
    const {origin,key}=await loadConfig();if(!process.stdin.isTTY||!process.stdout.isTTY||process.argv.length!==2)throw new Error('invocation');
    console.log('ケース25 / dev-sandbox専用 / 最大10 RPC + 認証1回 / 書き込み確認4回');
    console.log('専用タグ・関連付きメモを作成しゴミ箱へ移動。古いrevisionで完全削除を1回試みます。誤成功時は専用メモと関連が消えます。自動復旧なし。');
    stage='認証';let email=(await question('dev-sandboxの専用テストユーザーのメールアドレス: ')).trim();if(!email)throw new Error('email');password=await readPassword();
    const auth=await requestJson(`${origin}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    email='';password='';if(typeof auth?.access_token!=='string'||!auth.access_token||typeof auth?.user?.id!=='string'||!auth.user.id)throw new Error('auth');token=auth.access_token;
    stage='識別記録';const directory=new URL('runs/',import.meta.url);await mkdir(directory,{recursive:true});const records=[];
    for(const e of await readdir(directory,{withFileTypes:true})){if(!e.name.endsWith('.json'))continue;if(!e.isFile())throw new Error('record');records.push(JSON.parse(await readFile(new URL(e.name,directory),'utf8')));}
    const ids=collectRecordedIds(records),runId=freshId(ids),memoId=freshId(ids),tagId=freshId(ids),requestId=freshId(ids),trashRequestId=freshId(ids);
    identity={version:1,test:'delete-conflict-read',runId,memoId,tagId,requestId,trashRequestId,userId:auth.user.id,projectHost:new URL(origin).hostname,status:'prepared',startedAt:new Date().toISOString()};
    writeNew=(suffix,value)=>writeFile(new URL(`${runId}.delete-conflict${suffix}.json`,directory),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
    await writeNew('',identity);recorded=true;console.log(`識別記録: tools/memo-db-test/runs/${runId}.delete-conflict.json`);
    const normal=permanentDeleteRpc(origin,key,token);
    const result=await runDeleteConflictCase({...identity,
      rpc:(name,payload)=>{if(!['memo_load_snapshot','memo_save_tag','memo_save','memo_change_state'].includes(name))throw new Error('rpc');return normal(name,payload);},
      rejectDelete:deleteConflictResponse(origin,key,token),setStage:s=>{stage=s;},
      confirm:async(action,summary)=>{stage=`${action}確認`;console.log(`操作: ${action} / ${JSON.stringify(summary)}`);
        console.log(action==='delete-conflict'?'拒否予定ですが、誤成功すれば専用メモと関連1件が完全削除されます。正しいrevisionでの削除し直し・復旧は行いません。':'今回の新規専用データだけが対象です。');
        return await question(`続行するには ${action.toUpperCase()} と入力: `)===action.toUpperCase();},
      progress:async(action,detail)=>{stage=`${action}記録`;await writeNew(`.${action}.result`,{runId,memoId,tagId,action,...detail,status:'passed',completedAt:new Date().toISOString()});console.log(`PASS: ${action}`);}});
    await writeNew('.result',{...identity,...result,status:'passed',completedAt:new Date().toISOString()});
    console.log('PASS: 直前状態revision=2＋HTTP409/PT409/期待メッセージ一致＋全取得データ不変。専用メモはゴミ箱内revision=2、タグ・関連各1件を保持。内部台帳は直接未確認。');
  }catch(error){
    const diagnostic=safeUsageFailure(error);
    if(recorded){try{await writeNew('.failure',{runId:identity.runId,memoId:identity.memoId,tagId:identity.tagId,stage,diagnostic,status:'failed',completedAt:new Date().toISOString()});}catch{console.log('FAIL: 失敗結果の保存失敗。元の識別記録は保持。');}}
    console.log(`FAIL: ${stage} / ${diagnostic.phase} / 項目=${diagnostic.item}${diagnostic.httpStatus!==undefined?` / HTTP ${diagnostic.httpStatus}`:''}。自動再送・削除・復旧なし。`);
    if(recorded)console.log('識別記録を保持しています。次の操作前に読み取り専用で確認してください。');process.exitCode=1;
  }finally{password='';token=undefined;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.log('FAIL: ケース25終了');process.exitCode=1;});
