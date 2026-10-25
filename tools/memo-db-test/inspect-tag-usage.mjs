import {readFile} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {pathToFileURL} from 'node:url';
import {loadConfig,readPassword} from './cli.mjs';
import {TARGET_RUN,InspectionError,validateUsageRecords,inspectionRequest,inspectUsageSnapshot} from './inspect-tag-usage-contract.mjs';

async function readRecord(suffix){
  let raw;
  try{raw=await readFile(new URL(`runs/${TARGET_RUN}.tag-usage${suffix}.json`,import.meta.url),'utf8');}
  catch{throw new InspectionError('実行記録読取');}
  try{return JSON.parse(raw);}catch{throw new InspectionError('実行記録JSON解析');}
}
async function main(){
  let stage='設定',password='',email='',token;
  try{
    const {origin,key}=await loadConfig();
    if(!process.stdin.isTTY||!process.stdout.isTTY||process.argv.length!==2)throw new InspectionError('対話実行条件');
    stage='実行記録照合';
    const records={identity:await readRecord(''),used:await readRecord('.tag-used.result'),unused:await readRecord('.tag-unused.result'),failure:await readRecord('.failure')};
    const r=validateUsageRecords(records,new URL(origin).hostname);
    console.log('PASS: 識別記録・タグ2段階PASS・失敗記録の対応');
    console.log('認証後はmemo_load_snapshotを1回だけ実行。保存・再送・削除・復旧・記録書き込みは行いません。');
    stage='認証';const prompt=createInterface({input:process.stdin,output:process.stdout});
    try{email=(await prompt.question('当該runと同じテストユーザーのメールアドレス: ')).trim();}finally{prompt.close();}
    if(!email)throw new InspectionError('認証入力');password=await readPassword();
    const auth=await inspectionRequest(origin,key,'login',{email,password});email='';password='';
    if(typeof auth?.access_token!=='string'||!auth.access_token||auth?.user?.id!==r.userId)throw new InspectionError('認証所有者照合');
    token=auth.access_token;console.log('PASS: 認証・run所有者一致');
    stage='読み取りRPC';const snapshot=await inspectionRequest(origin,key,'snapshot',{token});
    stage='取得後検証';const checks=inspectUsageSnapshot(r,snapshot);
    for(const c of checks)console.log(`${c.passed?'PASS':'FAIL'}: ${c.field}${c.summary?` (${c.summary})`:''}`);
    console.log('現在状態の診断のみです。元runのFAILをPASSへ変更しません。');
    console.log('過去の本文・日時・対象外データのsnapshotは未保存のため、失敗時点からの完全不変や当時の通信障害原因は証明できません。');
    if(checks.some((c)=>!c.passed))process.exitCode=1;
  }catch(e){
    const known=e instanceof InspectionError;
    console.log(`FAIL: ${stage} / ${known?e.phase:'処理例外（詳細非表示）'}${known&&Number.isInteger(e.status)?` / HTTP ${e.status}`:''}`);
    if(known)for(const line of e.diagnostics)console.log(line);
    console.log('再送・削除・復旧は行いません。元runと記録は変更していません。');process.exitCode=1;
  }finally{email='';password='';token=undefined;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.log('FAIL: 読み取り診断終了。');process.exitCode=1;});
