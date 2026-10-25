import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {pathToFileURL} from 'node:url';
import {loadConfig,readPassword,requestJson} from './cli.mjs';
import {collectRecordedIds,freshId} from './resolve-missing-contract.mjs';
import {tagDeleteRpc} from './tag-delete-contract.mjs';
import {safeUsageFailure} from './tag-usage-diagnostics.mjs';
import {runInputContentCase,contentRejection} from './input-content-contract.mjs';
async function question(text){const p=createInterface({input:process.stdin,output:process.stdout});try{return await p.question(text);}finally{p.close();}}
async function main(){
  let password='',token,identity,writeNew,recorded=false,stage='設定';
  try{
    const {origin,key}=await loadConfig();if(!process.stdin.isTTY||!process.stdout.isTTY||process.argv.length!==2)throw new Error('invocation');
    console.log('ケース21・dev-sandbox専用。最大35 RPC（save_tag6・save11・snapshot18）、確認17回、別途認証1回。');
    console.log('空/NULL・前後空白・改行/制御文字の拒否と、本文空文字/空白/LF/TAB・分解形Unicodeの厳密保持を検証。');
    stage='認証';let email=(await question('テストユーザーのメールアドレス: ')).trim();if(!email)throw new Error('email');password=await readPassword();
    const auth=await requestJson(`${origin}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    email='';password='';if(typeof auth?.access_token!=='string'||!auth.access_token||typeof auth?.user?.id!=='string'||!auth.user.id)throw new Error('auth');token=auth.access_token;
    stage='識別記録';const directory=new URL('runs/',import.meta.url);await mkdir(directory,{recursive:true});const records=[];
    for(const e of await readdir(directory,{withFileTypes:true})){if(!e.name.endsWith('.json'))continue;if(!e.isFile())throw new Error('record');records.push(JSON.parse(await readFile(new URL(e.name,directory),'utf8')));}
    const ids=collectRecordedIds(records),runId=freshId(ids),tagId=freshId(ids),memoId=freshId(ids),requestIds=Array.from({length:11},()=>freshId(ids));
    identity={version:1,test:'input-content-read',runId,tagId,memoId,requestIds,userId:auth.user.id,projectHost:new URL(origin).hostname,status:'prepared',startedAt:new Date().toISOString()};
    writeNew=(suffix,value)=>writeFile(new URL(`${runId}.input-content${suffix}.json`,directory),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
    await writeNew('',identity);recorded=true;console.log(`識別記録: tools/memo-db-test/runs/${runId}.input-content.json`);
    const headers={apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},normal=tagDeleteRpc(origin,headers);
    const result=await runInputContentCase({runId,tagId,memoId,requestIds,userId:auth.user.id,
      rpc:(name,payload)=>{
        if(!['memo_save_tag','memo_save','memo_load_snapshot'].includes(name))throw new Error('rpc');
        return normal(name,payload);
      },reject:(name,payload)=>contentRejection(origin,headers,name,payload),setStage:(s)=>{stage=s;},
      confirm:async(action,summary)=>{
        stage=`${action}確認`;console.log(`操作: ${action} / 対象: ${JSON.stringify(summary)}`);
        console.log('今回の専用データだけを操作。title/tag/bodyの不正要求は拒否期待ですが、誤成功しても取り消しません。自動再送・削除・復旧なし。');
        return await question(`続行は ${action.toUpperCase()} と入力: `)===action.toUpperCase();
      },progress:async(action,detail)=>{
        stage=`${action}記録`;await writeNew(`.${action}.result`,{runId,tagId,memoId,action,...detail,status:'passed',completedAt:new Date().toISOString()});console.log(`PASS: ${action}`);
      }});
    await writeNew('.result',{...identity,...result,status:'passed',completedAt:new Date().toISOString()});
    console.log('PASS: 内容妥当性17項目（許可4・拒否13）。文字列厳密保持と拒否後全データ不変。専用メモrevision3・タグ1件を保持。内部台帳は直接未確認。');
  }catch(error){
    const diagnostic=safeUsageFailure(error);
    if(recorded){try{await writeNew('.failure',{runId:identity.runId,tagId:identity.tagId,memoId:identity.memoId,stage,diagnostic,status:'failed',completedAt:new Date().toISOString()});}catch{console.log('FAIL: 失敗記録の新規保存失敗。元の識別記録は保持。');}}
    console.log(`FAIL: ${stage} / ${diagnostic.phase} / 項目=${diagnostic.item}${diagnostic.httpStatus!==undefined?` / HTTP ${diagnostic.httpStatus}`:''}。自動再送・削除・復旧なし。`);
    for(const line of diagnostic.diagnostics??[])console.log(line);if(recorded)console.log('識別記録を保持しています。次の操作前に読み取り専用で確認してください。');process.exitCode=1;
  }finally{password='';token=undefined;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.log('FAIL: 入力内容テスト終了。');process.exitCode=1;});
