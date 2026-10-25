import test from 'node:test';
import assert from 'node:assert/strict';
import {usageSnapshot,safeUsageFailure} from './tag-usage-diagnostics.mjs';
globalThis.fetch=()=>{throw new Error('network forbidden');};
const origin='https://yohoppqflnhhvqypwhfv.supabase.co';
for(const mode of ['ok','network','timeout','http','body','json']){
  test(`snapshot ${mode}を安全に分類・自動再送なし`,async()=>{
    let calls=0;
    const request=()=>usageSnapshot(origin,{apikey:'private-key'},async(url,options)=>{
      calls++;assert.equal(url,`${origin}/rest/v1/rpc/memo_load_snapshot`);assert.equal(options.body,'{}');
      assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
      if(mode==='network')throw Object.assign(new TypeError('private-message'),{cause:{code:'ECONNRESET'}});
      if(mode==='timeout')throw new DOMException('private-message','TimeoutError');
      return {status:mode==='http'?503:200,text:async()=>{
        if(mode==='body')throw Object.assign(new TypeError('private-message'),{cause:{code:'UND_ERR_SOCKET'}});
        return mode==='json'?'private-invalid-json':'{"memos":[],"tags":[],"memoTags":[]}';
      }};
    });
    if(mode==='ok')assert.deepEqual(await request(),{memos:[],tags:[],memoTags:[]});
    else await assert.rejects(request(),(e)=>{
      const d=safeUsageFailure(e);assert.equal(d.phase,{network:'fetch通信',timeout:'fetch通信',http:'HTTP応答',body:'応答本文受信',json:'JSON解析'}[mode]);
      assert.equal(d.item,'memo_load_snapshot');assert.ok(!JSON.stringify(d).includes('private'));
      assert.ok(!JSON.stringify(d).includes(origin));if(mode==='http')assert.equal(d.httpStatus,503);
      if(mode==='timeout')assert.ok(d.diagnostics.join().includes('TimeoutError'));
      return true;
    });
    assert.equal(calls,1);
  });
}
test('異なる接続先は通信前に停止',async()=>{
  let calls=0;await assert.rejects(usageSnapshot('https://production.example',{},async()=>{calls++;}),
    (e)=>e.phase==='接続先検証');assert.equal(calls,0);
});
test('未知の例外やcauseの任意文字列は出力しない',async()=>{
  assert.deepEqual(safeUsageFailure(new Error('private-message')),{phase:'処理例外',item:'不明（詳細非表示）'});
  await assert.rejects(usageSnapshot(origin,{},async()=>{throw {name:'private-name',cause:{code:'private-code'}};}),
    (e)=>{assert.ok(!JSON.stringify(safeUsageFailure(e)).includes('private'));return true;});
});
