import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {pathToFileURL} from 'node:url';
import {loadConfig,readPassword,requestJson} from './cli.mjs';
import {collectRecordedIds,freshId} from './resolve-missing-contract.mjs';
import {runTagDeleteCase,tagDeleteRpc} from './tag-delete-contract.mjs';
import {safeUsageFailure} from './tag-usage-diagnostics.mjs';
async function question(text){const p=createInterface({input:process.stdin,output:process.stdout});try{return await p.question(text);}finally{p.close();}}
async function main(){
  let password='',token,identity,writeNew,recorded=false,stage='設定';
  try{
    const {origin,key}=await loadConfig();if(!process.stdin.isTTY||!process.stdout.isTTY||process.argv.length!==2)throw new Error('invocation');
    console.log('ケース18・dev-sandbox専用。最大13 RPC（save_tag2・save2・change_state1・delete_tag1・snapshot7）、確認6回、別途認証1回。');
    console.log('削除対象は今回新設する専用タグのみ。関連する通常/ゴミ箱メモのrevision・更新日時が進みlast_request_idがnullになります。');
    stage='認証';let email=(await question('テストユーザーのメールアドレス: ')).trim();if(!email)throw new Error('email');password=await readPassword();
    const auth=await requestJson(`${origin}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    email='';password='';if(typeof auth?.access_token!=='string'||!auth.access_token||typeof auth?.user?.id!=='string'||!auth.user.id)throw new Error('auth');token=auth.access_token;
    stage='識別記録';const directory=new URL('runs/',import.meta.url);await mkdir(directory,{recursive:true});const records=[];
    for(const e of await readdir(directory,{withFileTypes:true})){if(!e.name.endsWith('.json'))continue;if(!e.isFile())throw new Error('record');records.push(JSON.parse(await readFile(new URL(e.name,directory),'utf8')));}
    const reserved=collectRecordedIds(records),runId=freshId(reserved),tagIds=Array.from({length:2},()=>freshId(reserved)),memoIds=Array.from({length:2},()=>freshId(reserved)),requestIds=Array.from({length:3},()=>freshId(reserved));
    identity={version:1,test:'tag-delete-read',runId,tagIds,memoIds,requestIds,userId:auth.user.id,projectHost:new URL(origin).hostname,status:'prepared',startedAt:new Date().toISOString()};
    writeNew=(suffix,value)=>writeFile(new URL(`${runId}.tag-delete${suffix}.json`,directory),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
    await writeNew('',identity);recorded=true;console.log(`識別記録: tools/memo-db-test/runs/${runId}.tag-delete.json`);
    const headers={apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
    const result=await runTagDeleteCase({runId,tagIds,memoIds,requestIds,userId:auth.user.id,
      rpc:tagDeleteRpc(origin,headers),setStage:(s)=>{stage=s;},
      confirm:async(action,summary)=>{
        stage=`${action}確認`;console.log(`操作: ${action} / 対象: ${JSON.stringify(summary)}`);
        console.log('専用タグ2件・メモ2件だけを準備。trashは2件目、delete-tagは専用削除タグとその関連のみ。自動再送・削除・復旧なし。');
        return await question(`続行は ${action.toUpperCase()} と入力: `)===action.toUpperCase();
      },progress:async(action,detail)=>{
        stage=`${action}記録`;await writeNew(`.${action}.result`,{runId,tagIds,memoIds,action,...detail,status:'passed',completedAt:new Date().toISOString()});
        console.log(`PASS: ${action}`);
      }});
    await writeNew('.result',{...identity,...result,status:'passed',completedAt:new Date().toISOString()});
    console.log('PASS: 専用タグ削除・関連解除・通常メモrevision2/ゴミ箱メモrevision3・本文と対象外データ不変。メモ2件・残すタグ1件・関連1件を保持。');
  }catch(error){
    const diagnostic=safeUsageFailure(error);
    if(recorded){try{await writeNew('.failure',{runId:identity.runId,tagIds:identity.tagIds,memoIds:identity.memoIds,stage,diagnostic,status:'failed',completedAt:new Date().toISOString()});}catch{console.log('FAIL: 失敗記録の新規保存失敗。元の識別記録は保持。');}}
    console.log(`FAIL: ${stage} / ${diagnostic.phase} / 項目=${diagnostic.item}${diagnostic.httpStatus!==undefined?` / HTTP ${diagnostic.httpStatus}`:''}。自動再送・削除・復旧なし。`);
    for(const line of diagnostic.diagnostics??[])console.log(line);
    if(recorded)console.log('識別記録を保持しています。次の操作前に読み取り専用で確認してください。');process.exitCode=1;
  }finally{password='';token=undefined;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.log('FAIL: タグ削除テスト終了。');process.exitCode=1;});
