import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {pathToFileURL} from 'node:url';
import {loadConfig,readPassword,requestJson} from './cli.mjs';
import {collectRecordedIds,freshId} from './resolve-missing-contract.mjs';
import {runMissingTagCase,missingTagName,missingTagResponse} from './missing-tag-contract.mjs';
import {memoTagsRpc} from './memo-tags-contract.mjs';
async function question(text){const p=createInterface({input:process.stdin,output:process.stdout});try{return await p.question(text);}finally{p.close();}}
async function main(){
  let password='',token,identity,writeNew,recorded=false,stage='設定';
  try{
    const {origin,key}=await loadConfig();
    if(!process.stdin.isTTY||!process.stdout.isTTY||process.argv.length!==2)throw new Error('invocation');
    console.log('ケース16・dev-sandbox専用。最大9 RPC（save_tag1・save2・snapshot4・resolve2）、確認3回、別途認証1回。');
    stage='認証';let email=(await question('テストユーザーのメールアドレス: ')).trim();if(!email)throw new Error('email');password=await readPassword();
    const auth=await requestJson(`${origin}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    email='';password='';if(typeof auth?.access_token!=='string'||!auth.access_token||typeof auth?.user?.id!=='string'||!auth.user.id)throw new Error('auth');token=auth.access_token;
    stage='識別記録';const directory=new URL('runs/',import.meta.url);await mkdir(directory,{recursive:true});const records=[];
    for(const entry of await readdir(directory,{withFileTypes:true})){
      if(!entry.name.endsWith('.json'))continue;if(!entry.isFile())throw new Error('record');records.push(JSON.parse(await readFile(new URL(entry.name,directory),'utf8')));
    }
    const ids=collectRecordedIds(records),runId=freshId(ids),memoId=freshId(ids),requestId=freshId(ids),updateRequestId=freshId(ids),tagIds=[freshId(ids),freshId(ids)];
    identity={version:1,test:'missing-tag-read',runId,memoId,requestId,updateRequestId,tagIds,userId:auth.user.id,projectHost:new URL(origin).hostname,status:'prepared',startedAt:new Date().toISOString()};
    writeNew=(suffix,value)=>writeFile(new URL(`${runId}.missing-tag${suffix}.json`,directory),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
    await writeNew('',identity);recorded=true;console.log(`識別記録: tools/memo-db-test/runs/${runId}.missing-tag.json`);
    const headers={apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
    const result=await runMissingTagCase({base:{p_id:memoId,p_request_id:requestId,p_expected_revision:null,p_title:`DBTEST-MISSING-TAG-${runId}`,p_body:`missing tag test ${runId}`,p_tag_ids:[tagIds[0]]},
      updateRequestId,tagId:tagIds[0],missingTagId:tagIds[1],tagName:missingTagName(runId),userId:auth.user.id,
      rpc:memoTagsRpc(origin,headers),rejectSave:(payload)=>missingTagResponse(`${origin}/rest/v1/rpc/memo_save`,headers,payload),setStage:(s)=>{stage=s;},
      confirm:async(action,summary)=>{
        stage=`${action}確認`;console.log(`操作: ${action} / 対象: ${JSON.stringify(summary)}`);
        console.log('新規専用タグ1件・メモ1件だけを作成。reject-updateは不存在確認した新規タグIDで本文・関連変更を1回試行。誤成功でも取り消しません。自動再送・削除・復旧なし。');
        return await question(`続行は ${action.toUpperCase()} と入力: `)===action.toUpperCase();
      },progress:async(action,detail)=>{
        stage=`${action}記録`;await writeNew(`.${action}.result`,{runId,memoId,tagIds,action,...detail,status:'passed',completedAt:new Date().toISOString()});console.log(`PASS: ${action}`);
      }});
    await writeNew('.result',{...identity,...result,status:'passed',completedAt:new Date().toISOString()});
    console.log('PASS: HTTP400/22023/unknown tag、本文・revision=1・タグ関連・全取得データ不変。専用メモ1件とタグ1件を保持。');
    console.log('不正タグは更新前に拒否される設計。途中書き込みのロールバックを直接証明したものではなく、照合nullも未実行の証明ではありません。');
  }catch{
    if(recorded){try{await writeNew('.failure',{runId:identity.runId,memoId:identity.memoId,tagIds:identity.tagIds,stage,status:'failed',completedAt:new Date().toISOString()});}catch{console.log('FAIL: 失敗記録の新規保存失敗。元の識別記録は保持。');}}
    console.log(`FAIL: ${stage}。再送・削除・復旧なし。`);if(recorded)console.log('識別記録を保持しています。次の操作前に読み取り専用で状態を確認してください。');process.exitCode=1;
  }finally{password='';token=undefined;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.log('FAIL: 不存在タグ更新拒否テスト終了。');process.exitCode=1;});
