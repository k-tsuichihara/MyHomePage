import test from 'node:test';
import assert from 'node:assert/strict';
import {runIsolationCase,isolationApi} from './isolation-contract.mjs';
import './isolation-read.mjs';
globalThis.fetch=()=>{throw new Error('network forbidden');};
const id=n=>`${n.toString(16).padStart(8,'0')}-1234-4234-8234-123456789abc`;
const users=[0,1].map(i=>Object.fromEntries(['userId','memoId','tagId','createId','trashId','editId','stateId'].map((k,j)=>[k,id(10+i*10+j)])));
async function simulate(mode=''){
  const states=users.map(u=>({memos:[{id:`old-${u.userId}`,user_id:u.userId,body:'private'}],tags:[],memoTags:[]}));
  const calls=[],confirms=[],records=[];let result,error,probes=0;
  try{result=await runIsolationCase({runId:id(1),users:mode==='same-user'?[users[0],users[0]]:users,
    confirm:async(label)=>{confirms.push(label);return mode!==`cancel-${label}`;},
    progress:async(label,d)=>{records.push({label,...d});if(mode===`record-${label}`)throw new Error('private');},
    select:async(i,target,u)=>{calls.push(['select',i,target]);
      if(u.userId!==users[i].userId)return mode==='leak'?[{id:u.memoId}]:[];
      if(mode==='own-empty')return [];
      return [target==='memos'?{id:u.memoId,user_id:u.userId}:target==='tags'?{id:u.tagId,user_id:u.userId}:{user_id:u.userId,memo_id:u.memoId,tag_id:u.tagId}];},
    rpc:async(i,n,p,d)=>{
      calls.push(['rpc',i,n,p,d]);const s=states[i],u=users[i];
      if(d){probes++;
        if(mode==='timeout')throw new DOMException('private','TimeoutError');
        if(mode==='network')throw new TypeError('private');
        if(mode==='success')return {rejected:false};
        if(mode==='changed-self')s.memos[0].body='changed';
        if(mode==='changed-other')states[1-i].memos[0].body='changed';
        if(mode==='relation-extra')states[1-i].memoTags.push({...states[1-i].memoTags[0],tag_id:id(99)});
        if(mode==='relation-duplicate')states[1-i].memoTags.push({...states[1-i].memoTags[0]});
        if(mode==='relation-owner')states[1-i].memoTags[0].user_id=u.userId;
        return {rejected:true};
      }
      if(n==='memo_load_snapshot'){
        const out=structuredClone(s);
        if(mode==='snapshot-owner')out.memos[0].user_id='foreign';
        if(probes&&mode==='field-added')out.tags[0].extra=true;
        for(const k of ['memos','tags','memoTags'])out[k].reverse().forEach((r,j)=>{out[k][j]=Object.fromEntries(Object.entries(r).reverse());});return out;
      }
      if(n==='memo_save_tag'){
        const t={id:p.p_id,user_id:u.userId,name:p.p_name,revision:1,created_at:'2026-10-25T00:00:00Z'};
        s.tags.push(structuredClone(t));return mode==='tag-id'?{...t,id:id(88)}:t;
      }
      if(n==='memo_save'){
        const m={id:p.p_id,user_id:u.userId,title:p.p_title,body:p.p_body,revision:1,last_request_id:p.p_request_id,pinned_at:null,deleted_at:null,created_at:'2026-10-25T00:00:00Z',updated_at:'2026-10-25T00:00:00Z'};
        s.memos.push(structuredClone(m));s.memoTags.push({user_id:u.userId,memo_id:u.memoId,tag_id:u.tagId});
        return {memo:mode==='memo-revision'?{...m,revision:2}:m,tagIds:[u.tagId]};
      }
      assert.equal(n,'memo_change_state');const m=s.memos.find(r=>r.id===u.memoId);
      Object.assign(m,{revision:2,updated_at:'2026-10-25T00:00:01Z',deleted_at:'2026-10-25T00:00:01Z',last_request_id:u.trashId});
      return mode==='trash-body'?{...m,body:'changed'}:structuredClone(m);
    }});}catch(e){error=e;}
  return {result,error,calls,confirms,records};
}
test('双方向RLS非表示・10拒否・全データ不変・50RPC/12SELECT/16確認',async()=>{
  const r=await simulate();assert.ifError(r.error);assert.equal(r.result.denials,10);
  assert.equal(r.calls.filter(c=>c[0]==='rpc').length,50);assert.equal(r.calls.filter(c=>c[0]==='select').length,12);
  assert.equal(r.confirms.length,16);assert.ok(!JSON.stringify(r.records).includes('private'));
  for(const actor of [0,1])assert.equal(r.calls.filter(c=>c[0]==='rpc'&&c[1]===actor&&c[4]).length,5);
  for(const c of r.calls.filter(c=>c[4]&&['memo_save','memo_change_state'].includes(c[2])))assert.deepEqual(c[4],{status:500,code:'P0002',message:'memo not found'});
});
for(const mode of ['same-user','leak','own-empty','timeout','network','success','changed-self','changed-other','relation-extra','relation-duplicate','relation-owner','snapshot-owner','field-added','tag-id','memo-revision','trash-body',
  'cancel-tag-0','cancel-create-0','cancel-trash-0','cancel-edit-0','cancel-delete-tag-1','record-tag-0','record-edit-0']){
  test(`${mode}: 即停止・再試行なし`,async()=>{const r=await simulate(mode);assert.ok(r.error);assert.ok(r.calls.filter(c=>c[0]==='rpc').length<=50);
    for(const actor of [0,1])for(const name of ['memo_save','memo_change_state','memo_delete_permanently','memo_save_tag','memo_delete_tag'])assert.ok(r.calls.filter(c=>c[0]==='rpc'&&c[1]===actor&&c[2]===name&&c[4]).length<=1);
    if(['timeout','network','success','changed-self','changed-other','relation-extra','relation-duplicate','relation-owner','field-added'].includes(mode))assert.equal(r.calls.filter(c=>c[4]).length,1);
  });
}
const origin='https://yohoppqflnhhvqypwhfv.supabase.co';
const denial={status:409,code:'PT409',message:'tag revision conflict'};
for(const mode of ['ok','status','code','message','success','json','body','network','timeout']){
  test(`通信契約 ${mode}`,async()=>{let calls=0;
    const api=isolationApi(origin,'sb_publishable_mock','private-token',async(url,o)=>{
      calls++;assert.equal(o.redirect,'error');assert.ok(o.signal instanceof AbortSignal);assert.equal(o.headers.Authorization,'Bearer private-token');
      if(mode==='network'||mode==='timeout')throw new Error('private');
      return {status:mode==='status'?400:mode==='success'?200:409,body:{cancel:async()=>{}},text:async()=>{
        if(mode==='body')throw new Error('private');if(mode==='json')return 'private';
        return JSON.stringify({code:mode==='code'?'40001':'PT409',message:mode==='message'?'private':denial.message});}};
    });
    if(mode==='ok')assert.deepEqual(await api('memo_delete_tag',{p_id:users[0].tagId},denial),{rejected:true});
    else await assert.rejects(api('memo_delete_tag',{p_id:users[0].tagId},denial));assert.equal(calls,1);
  });
}
for(const target of ['memos','tags','memo_tags'])test(`直接SELECTフィルター ${target}`,async()=>{
  const api=isolationApi(origin,'sb_publishable_mock','token',async(url,o)=>{
    assert.equal(o.method,'GET');assert.ok(!Object.hasOwn(o,'body'));assert.ok(url.includes(target==='tags'?users[1].tagId:users[1].memoId));
    return {status:200,text:async()=>'[]'};
  });assert.deepEqual(await api(target,users[1]),[]);
});
for(const [host,key,route] of [['https://production.invalid','sb_publishable_mock','memo_save'],[origin,'secret','memo_save'],[origin,'sb_publishable_mock','memo_empty_trash']])test('接続先/キー/経路の拒否',async()=>{
  let calls=0;const api=isolationApi(host,key,'token',async()=>{calls++;});await assert.rejects(api(route,{}));assert.equal(calls,0);
});
for(const status of [500,400,404])test(`P0002のHTTP厳密照合 ${status}`,async()=>{
  const api=isolationApi(origin,'sb_publishable_mock','token',async()=>({status,body:{cancel:async()=>{}},text:async()=>JSON.stringify({code:'P0002',message:'memo not found'})}));
  const action=()=>api('memo_save',{}, {status:500,code:'P0002',message:'memo not found'});
  if(status===500)assert.deepEqual(await action(),{rejected:true});else await assert.rejects(action());
});
