import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {pathToFileURL} from 'node:url';
import {loadConfig,readPassword,requestJson} from './cli.mjs';
import {collectRecordedIds,freshId} from './resolve-missing-contract.mjs';
import {runMemoTagsCase,memoTagsRpc,memoTagNames} from './memo-tags-contract.mjs';
async function question(text){const p=createInterface({input:process.stdin,output:process.stdout});try{return await p.question(text);}finally{p.close();}}
async function main(){
  let password='',token,identity,writeNew,recorded=false,stage='設定';
  try{
    const {origin,key}=await loadConfig();
    if(!process.stdin.isTTY||!process.stdout.isTTY||process.argv.length!==2)throw new Error('invocation');
    console.log('ケース15・dev-sandbox専用。最大11 RPC（save_tag2・save2・snapshot5・resolve2）、確認4回、別途認証1回。');
    stage='認証';let email=(await question('テストユーザーのメールアドレス: ')).trim();if(!email)throw new Error('email');password=await readPassword();
    const auth=await requestJson(`${origin}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    email='';password='';if(typeof auth?.access_token!=='string'||!auth.access_token||typeof auth?.user?.id!=='string'||!auth.user.id)throw new Error('auth');token=auth.access_token;
    stage='識別記録';const directory=new URL('runs/',import.meta.url);await mkdir(directory,{recursive:true});const records=[];
    for(const entry of await readdir(directory,{withFileTypes:true})){
      if(!entry.name.endsWith('.json'))continue;if(!entry.isFile())throw new Error('record');records.push(JSON.parse(await readFile(new URL(entry.name,directory),'utf8')));
    }
    const ids=collectRecordedIds(records),runId=freshId(ids),memoId=freshId(ids),requestId=freshId(ids),updateRequestId=freshId(ids),tagIds=[freshId(ids),freshId(ids)];
    identity={version:1,test:'memo-tags-read',runId,memoId,requestId,updateRequestId,tagIds,userId:auth.user.id,projectHost:new URL(origin).hostname,status:'prepared',startedAt:new Date().toISOString()};
    writeNew=(suffix,value)=>writeFile(new URL(`${runId}.memo-tags${suffix}.json`,directory),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
    await writeNew('',identity);recorded=true;console.log(`識別記録: tools/memo-db-test/runs/${runId}.memo-tags.json`);
    const headers={apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
    const result=await runMemoTagsCase({base:{p_id:memoId,p_request_id:requestId,p_expected_revision:null,p_title:`DBTEST-MEMO-TAGS-${runId}`,p_body:`memo tags test ${runId}`,p_tag_ids:[tagIds[0]]},
      updateRequestId,tagIds,tagNames:memoTagNames(runId),userId:auth.user.id,rpc:memoTagsRpc(origin,headers),setStage:(s)=>{stage=s;},
      confirm:async(action,summary)=>{
        stage=`${action}確認`;console.log(`操作: ${action} / 対象: ${JSON.stringify(summary)}`);
        console.log('新規専用タグ2件・メモ1件だけを操作。更新では本文変更とタグA→B置換を実行。自動再送・削除・復旧なし。');
        return await question(`続行は ${action.toUpperCase()} と入力: `)===action.toUpperCase();
      },progress:async(action,detail)=>{
        stage=`${action}記録`;await writeNew(`.${action}.result`,{runId,memoId,tagIds,action,...detail,status:'passed',completedAt:new Date().toISOString()});console.log(`PASS: ${action}`);
      }});
    await writeNew('.result',{...identity,...result,status:'passed',completedAt:new Date().toISOString()});
    console.log('PASS: 本文・revision=2・タグA解除/タグB紐付け・対象外不変・要求照合。専用メモ1件とタグ2件を保持。ケース16は未実施。');
  }catch{
    if(recorded){try{await writeNew('.failure',{runId:identity.runId,memoId:identity.memoId,tagIds:identity.tagIds,stage,status:'failed',completedAt:new Date().toISOString()});}catch{console.log('FAIL: 失敗記録の新規保存失敗。元の識別記録は保持。');}}
    console.log(`FAIL: ${stage}。再送・削除・復旧なし。`);if(recorded)console.log('識別記録を保持しています。次の操作前に読み取り専用で状態を確認してください。');process.exitCode=1;
  }finally{password='';token=undefined;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.log('FAIL: 本文・タグ一括更新テスト終了。');process.exitCode=1;});
