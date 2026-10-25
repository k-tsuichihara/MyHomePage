import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {pathToFileURL} from 'node:url';
import {loadConfig,readPassword,requestJson} from './cli.mjs';
import {collectRecordedIds,freshId} from './resolve-missing-contract.mjs';
import {safeUsageFailure} from './tag-usage-diagnostics.mjs';
import {isolationApi,runIsolationCase} from './isolation-contract.mjs';
async function question(text){const r=createInterface({input:process.stdin,output:process.stdout});try{return await r.question(text);}finally{r.close();}}
async function main(){
  const tokens=[];let password='',recorded=false,identity,writeNew,stage='設定';
  try{
    const {origin,key}=await loadConfig();
    if(!process.stdin.isTTY||!process.stdout.isTTY||process.argv.length!==2)throw new Error('invocation');
    console.log('ケース23 / dev-sandbox専用 / 最大50 RPC + SELECT12 + 認証2 / 書き込み確認16回');
    console.log('A・Bはテスト専用ユーザーに限定。各1メモ・1タグを新規作成し、メモはゴミ箱に残します。');
    if(await question('両アカウントがdev-sandboxのテスト専用であることを確認し TEST-USERS と入力: ')!=='TEST-USERS')throw new Error('users');
    const userIds=[];
    for(const label of ['A','B']){
      stage=`認証${label}`;let email=(await question(`専用ユーザー${label}のメールアドレス: `)).trim();if(!email)throw new Error('email');password=await readPassword();
      const auth=await requestJson(`${origin}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
      email='';password='';
      if(typeof auth?.access_token!=='string'||!auth.access_token||!/^[0-9a-f-]{36}$/i.test(auth?.user?.id??''))throw new Error('auth');
      tokens.push(auth.access_token);userIds.push(auth.user.id);
    }
    if(userIds[0]===userIds[1])throw new Error('same-user');
    stage='識別記録';const directory=new URL('runs/',import.meta.url);await mkdir(directory,{recursive:true});const records=[];
    for(const e of await readdir(directory,{withFileTypes:true})){if(!e.name.endsWith('.json'))continue;if(!e.isFile())throw new Error('record');records.push(JSON.parse(await readFile(new URL(e.name,directory),'utf8')));}
    const ids=collectRecordedIds(records),runId=freshId(ids),users=userIds.map(userId=>({userId,...Object.fromEntries(['memoId','tagId','createId','trashId','editId','stateId'].map(k=>[k,freshId(ids)]))}));
    identity={version:1,test:'isolation-read',runId,users,projectHost:new URL(origin).hostname,status:'prepared',startedAt:new Date().toISOString()};
    writeNew=(suffix,value)=>writeFile(new URL(`${runId}.isolation${suffix}.json`,directory),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
    await writeNew('',identity);recorded=true;console.log(`識別記録: tools/memo-db-test/runs/${runId}.isolation.json`);
    const apis=tokens.map(t=>isolationApi(origin,key,t));
    const result=await runIsolationCase({runId,users,
      rpc:(i,n,p,d)=>{stage=`ユーザー${i===0?'A':'B'} / ${n}`;return apis[i](n,p,d);},
      select:(i,n,p)=>{stage=`直接SELECT / ${n}`;return apis[i](n,p);},
      confirm:async(label,summary)=>{stage=label;console.log(`操作: ${label} / ${JSON.stringify(summary)}`);
        console.log('専用IDのみ。拒否予定でも誤成功時は変更・削除の可能性があります。自動復旧なし。');
        return await question(`続行するには ${label.toUpperCase()} と入力: `)===label.toUpperCase();},
      progress:async(label,detail)=>{stage=`記録 / ${label}`;await writeNew(`.${label}.result`,{runId,label,...detail,status:'passed',completedAt:new Date().toISOString()});console.log(`PASS: ${label}`);}});
    await writeNew('.result',{...identity,...result,status:'passed',completedAt:new Date().toISOString()});console.log('PASS: 双方向のRLS非表示・RPC拒否・両ユーザーの全取得データ不変。専用メモ2件（ゴミ箱）・タグ2件・関連2件を保持。');
  }catch(error){
    const diagnostic=safeUsageFailure(error);
    if(recorded){try{await writeNew('.failure',{runId:identity.runId,stage,diagnostic,status:'failed',completedAt:new Date().toISOString()});}catch{console.log('FAIL: 失敗結果の保存失敗。元の識別記録は保持。');}}
    console.log(`FAIL: ${stage} / ${diagnostic.phase} / 項目=${diagnostic.item}${diagnostic.httpStatus!==undefined?` / HTTP ${diagnostic.httpStatus}`:''}。自動再送・削除・復旧なし。`);
    if(recorded)console.log('識別記録を保持しています。次の操作前に読み取り専用で状態を確認してください。');process.exitCode=1;
  }finally{password='';tokens.fill(undefined);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.log('FAIL: ケース23終了');process.exitCode=1;});
