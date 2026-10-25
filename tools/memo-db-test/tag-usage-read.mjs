import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {pathToFileURL} from 'node:url';
import {loadConfig,readPassword,requestJson} from './cli.mjs';
import {collectRecordedIds,freshId} from './resolve-missing-contract.mjs';
import {memoTagsRpc} from './memo-tags-contract.mjs';
import {pinRpc} from './pin-read.mjs';
import {runTagUsageCase} from './tag-usage-contract.mjs';
import {usageSnapshot,safeUsageFailure} from './tag-usage-diagnostics.mjs';
async function question(text){const p=createInterface({input:process.stdin,output:process.stdout});try{return await p.question(text);}finally{p.close();}}
async function main(){
  let password='',token,identity,writeNew,recorded=false,stage='設定';
  try{
    const {origin,key}=await loadConfig();if(!process.stdin.isTTY||!process.stdout.isTTY||process.argv.length!==2)throw new Error('invocation');
    console.log('ケース17・dev-sandbox専用。最大13 RPC（save_tag2・save2・change_state2・snapshot7）、確認6回、別途認証1回。');
    console.log('件数専用APIはありません。snapshotから通常メモのみをローカル集計します。');
    stage='認証';let email=(await question('テストユーザーのメールアドレス: ')).trim();if(!email)throw new Error('email');password=await readPassword();
    const auth=await requestJson(`${origin}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    email='';password='';if(typeof auth?.access_token!=='string'||!auth.access_token||typeof auth?.user?.id!=='string'||!auth.user.id)throw new Error('auth');token=auth.access_token;
    stage='識別記録';const directory=new URL('runs/',import.meta.url);await mkdir(directory,{recursive:true});const records=[];
    for(const e of await readdir(directory,{withFileTypes:true})){if(!e.name.endsWith('.json'))continue;if(!e.isFile())throw new Error('record');records.push(JSON.parse(await readFile(new URL(e.name,directory),'utf8')));}
    const reserved=collectRecordedIds(records),runId=freshId(reserved),tagIds=Array.from({length:2},()=>freshId(reserved)),memoIds=Array.from({length:2},()=>freshId(reserved)),requestIds=Array.from({length:4},()=>freshId(reserved));
    identity={version:1,test:'tag-usage-read',runId,tagIds,memoIds,requestIds,userId:auth.user.id,projectHost:new URL(origin).hostname,status:'prepared',startedAt:new Date().toISOString()};
    writeNew=(suffix,value)=>writeFile(new URL(`${runId}.tag-usage${suffix}.json`,directory),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
    await writeNew('',identity);recorded=true;console.log(`識別記録: tools/memo-db-test/runs/${runId}.tag-usage.json`);
    const headers={apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},normal=memoTagsRpc(origin,headers),state=pinRpc(origin,headers);
    const result=await runTagUsageCase({runId,tagIds,memoIds,requestIds,userId:auth.user.id,
      rpc:(name,payload)=>name==='memo_load_snapshot'?usageSnapshot(origin,headers)
        :name==='memo_change_state'?state(name,payload):normal(name,payload),setStage:(s)=>{stage=s;},
      confirm:async(action,summary)=>{
        stage=`${action}確認`;console.log(`操作: ${action} / 対象: ${JSON.stringify(summary)}`);
        console.log('専用タグ2件・専用メモ2件だけを操作。trash/restoreは2件目のみ。自動再送・削除・復旧なし。');
        return await question(`続行は ${action.toUpperCase()} と入力: `)===action.toUpperCase();
      },progress:async(action,detail)=>{
        stage=`${action}記録`;await writeNew(`.${action}.result`,{runId,tagIds,memoIds,action,...detail,status:'passed',completedAt:new Date().toISOString()});
        console.log(`PASS: ${action}・使用タグ件数=${detail.usedTagCount}・未使用タグ件数=${detail.unusedTagCount??'タグ作成前'}`);
      }});
    await writeNew('.result',{...identity,...result,status:'passed',completedAt:new Date().toISOString()});
    console.log('PASS: 通常メモ2件で件数2、ゴミ箱移動で1、復元で2、未使用タグは0。専用メモ2件・タグ2件・関連2件を保持。');
  }catch(error){
    const diagnostic=safeUsageFailure(error);
    if(recorded){try{await writeNew('.failure',{runId:identity.runId,tagIds:identity.tagIds,memoIds:identity.memoIds,stage,diagnostic,status:'failed',completedAt:new Date().toISOString()});}catch{console.log('FAIL: 失敗記録の新規保存失敗。元の識別記録は保持。');}}
    console.log(`FAIL: ${stage} / ${diagnostic.phase} / 項目=${diagnostic.item}${diagnostic.httpStatus!==undefined?` / HTTP ${diagnostic.httpStatus}`:''}。自動再送・削除・復旧なし。`);
    for(const line of diagnostic.diagnostics??[])console.log(line);
    if(recorded)console.log('識別記録を保持しています。次の操作前に読み取り専用で確認してください。');process.exitCode=1;
  }finally{password='';token=undefined;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.log('FAIL: タグ使用件数テスト終了。');process.exitCode=1;});
