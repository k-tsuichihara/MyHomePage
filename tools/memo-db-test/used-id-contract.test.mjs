import test from 'node:test';
import assert from 'node:assert/strict';
import { runUsedIdCase } from './used-id-contract.mjs';
globalThis.fetch = () => { throw new Error('network forbidden'); };
async function simulate(mode = '') {
  let calls=0, reads=0, failed=false; const confirmations=[];
  const base={ p_id:'new', p_request_id:'first', p_expected_revision:null, p_title:'dummy', p_body:'dummy', p_tag_ids:[] };
  const memo={ id:'new', user_id:'u', title:'dummy', body:'dummy', revision:1, last_request_id:'first', pinned_at:null, deleted_at:null,
    created_at:'2026-10-15T00:00:00Z', updated_at:'2026-10-15T00:00:00Z' };
  try {
    await runUsedIdCase({ base, secondRequestId:'second', userId:'u',
      confirm:async (kind)=>{confirmations.push(kind);return mode!=='cancel';},
      progress:async()=>{if(mode==='record-failure')throw new Error('mock');},
      snapshot:async()=>{reads++;if(mode==='read-failure'&&reads===3)throw new Error('mock');
        const s={memos:reads===1?[]:[structuredClone(memo)],tags:[],memoTags:[]};
        if(reads===4&&mode==='changed')s.memos[0].revision=2;
        return s;},
      rpc:async(name,p,rejection)=>{calls++;assert.equal(name,'memo_save');assert.equal(p.p_id,'new');
        if(!rejection){assert.equal(p.p_request_id,'first');return {memo:structuredClone(memo),tagIds:[]};}
        assert.equal(p.p_request_id,'second');assert.equal(p.p_expected_revision,null);
        if(mode==='timeout')throw new DOMException('mock','TimeoutError');
        return {status:mode==='success'?200:mode==='http'?400:409,error:{code:mode==='code'?'23505':'PT409',
          message:mode==='message'?'memo revision conflict':'previously used memo id'}};},
    });
  }catch{failed=true;}
  return {calls,reads,failed,confirmations};
}
test('HTTP409/PT409/使用済みIDと全データ不変、2保存・4読込',async()=>{
  const r=await simulate();assert.equal(r.failed,false);assert.equal(r.calls,2);assert.equal(r.reads,4);
  assert.deepEqual(r.confirmations,['create','reuse']);
});
for(const mode of ['success','http','code','message','changed','timeout','read-failure','record-failure','cancel']){
  test(mode+'で停止・再送なし',async()=>{const r=await simulate(mode);assert.equal(r.failed,true);assert.ok(r.calls<=2);
    if(['read-failure','record-failure'].includes(mode))assert.equal(r.calls,1);
    if(mode==='cancel')assert.equal(r.calls,0);});
}
