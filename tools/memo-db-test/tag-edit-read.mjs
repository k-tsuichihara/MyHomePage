import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {pathToFileURL} from 'node:url';
import {loadConfig,readPassword,requestJson} from './cli.mjs';
import {collectRecordedIds,freshId} from './resolve-missing-contract.mjs';
import {runTagEditCase,tagRpc,tagNames} from './tag-edit-contract.mjs';
async function question(text) {
  const prompt=createInterface({input:process.stdin,output:process.stdout});
  try{return await prompt.question(text);}finally{prompt.close();}
}
async function main() {
  let password='',token,identity,writeNew,recorded=false,stage='設定';
  try {
    const {origin,key}=await loadConfig();
    if(!process.stdin.isTTY||!process.stdout.isTTY||process.argv.length!==2)throw new Error('invocation');
    console.log('dev-sandbox専用。最大7 RPC（save_tag3・snapshot4）、確認3回、別途認証1回。');
    console.log('タグにはrequestId・要求台帳なし。競合は古いrevisionで検証し、名前重複はケース14に残します。');
    stage='認証';let email=(await question('テストユーザーのメールアドレス: ')).trim();
    if(!email)throw new Error('email');password=await readPassword();
    const auth=await requestJson(`${origin}/auth/v1/token?grant_type=password`,{
      method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    email='';password='';
    if(typeof auth?.access_token!=='string'||!auth.access_token||typeof auth?.user?.id!=='string'||!auth.user.id)throw new Error('auth');
    token=auth.access_token;stage='識別記録';
    const directory=new URL('runs/',import.meta.url);await mkdir(directory,{recursive:true});const records=[];
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      if(!entry.name.endsWith('.json'))continue;if(!entry.isFile())throw new Error('record');
      records.push(JSON.parse(await readFile(new URL(entry.name,directory),'utf8')));
    }
    const ids=collectRecordedIds(records),runId=freshId(ids),tagId=freshId(ids);
    identity={version:1,test:'tag-edit-read',runId,tagId,userId:auth.user.id,projectHost:new URL(origin).hostname,
      status:'prepared',requestResolution:'not-supported-no-request-id-or-ledger',startedAt:new Date().toISOString()};
    writeNew=(suffix,value)=>writeFile(new URL(`${runId}.tag-edit${suffix}.json`,directory),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
    await writeNew('',identity);recorded=true;console.log(`識別記録: tools/memo-db-test/runs/${runId}.tag-edit.json`);
    const headers={apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
    const result=await runTagEditCase({tagId,names:tagNames(runId),userId:auth.user.id,rpc:tagRpc(origin,headers),
      setStage:(value)=>{stage=value;},
      confirm:async(action,payload)=>{
        stage=`${action}確認`;
        console.log(`対象: ${tagId} / ${action} / RPC引数: ${JSON.stringify(payload)}`);
        console.log('新規専用タグだけを操作。競合の誤成功時は名前・revisionが変わり得ます。自動再送・削除・復旧なし。');
        return await question(`続行は ${action.toUpperCase()} と入力: `)===action.toUpperCase();
      },
      progress:async(action,detail)=>{
        stage=`${action}結果記録`;
        await writeNew(`.${action}.result`,{runId,tagId,action,...detail,status:'passed',completedAt:new Date().toISOString()});
        console.log(`PASS: ${action}・revision=${detail.revision}`);
      }});
    await writeNew('.result',{...identity,...result,status:'passed',completedAt:new Date().toISOString()});
    console.log('PASS: タグ作成・名前変更・revision競合。専用タグ1件をrevision=2で保持。名前重複と関連付きメモへの影響は対象外。');
  }catch{
    if(recorded){try{await writeNew('.failure',{runId:identity.runId,tagId:identity.tagId,stage,status:'failed',completedAt:new Date().toISOString()});}
      catch{console.log('FAIL: 失敗結果の保存失敗。元の識別記録は保持。');}}
    console.log(`FAIL: ${stage}。自動再送・削除・復旧は行いません。`);
    if(recorded)console.log('識別記録を保持しています。次の操作前に読み取り専用で確認してください。');
    process.exitCode=1;
  }finally{password='';token=undefined;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.log('FAIL: タグテスト終了。');process.exitCode=1;});
