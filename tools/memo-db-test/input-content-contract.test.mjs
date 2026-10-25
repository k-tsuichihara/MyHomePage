import test from 'node:test';
import assert from 'node:assert/strict';
import {contentPlan,runInputContentCase,contentRejection} from './input-content-contract.mjs';
import './input-content-read.mjs';
globalThis.fetch=()=>{throw new Error('network forbidden');};
const runId='01234567-89ab-4cde-8fab-0123456789ab';
test('採用13拒否のエラー区別とUnicode分解形、上限から独立',()=>{
  const p=contentPlan(runId);assert.equal(p.rejects.length,13);
  assert.notEqual(p.title,p.title.normalize('NFC'));assert.notEqual(p.tag,p.tag.normalize('NFC'));
  assert.notEqual(p.preserved,p.preserved.normalize('NFC'));assert.ok(p.whitespace.includes('\n')&&p.whitespace.includes('\t'));
  assert.deepEqual(p.rejects.filter((c)=>c.message==='invalid argument').map((c)=>c.label),['title-null','body-null']);
  assert.ok(p.rejects.every((c)=>c.value===null||Array.from(c.value).length<100));
});
async function simulate(mode=''){
  const state={memos:[{id:'old',body:'private'}],tags:[{id:'old-tag',name:'old'}],memoTags:[]};
  const calls=[],confirmations=[],records=[],plan=contentPlan(runId);let result,error,saves=0,rejects=0;
  try{
    result=await runInputContentCase({runId,tagId:'tag',memoId:'memo',requestIds:Array.from({length:11},(_,i)=>`r${i}`),userId:'u',
      confirm:async(label)=>{confirmations.push(label);return mode!==`cancel-${label}`;},
      progress:async(label,detail)=>{records.push({label,...detail});if(mode===`record-${label}`)throw new Error('mock');},
      rpc:async(name,p)=>{
        calls.push({name,payload:structuredClone(p)});
        if(name==='memo_load_snapshot'){
          const s=structuredClone(state);for(const k of ['memos','tags','memoTags'])s[k]=s[k].reverse().map((r)=>Object.fromEntries(Object.entries(r).reverse()));return s;
        }
        if(name==='memo_save_tag'){
          const t={id:'tag',name:mode==='tag-normalized'?p.p_name.normalize('NFC'):p.p_name,user_id:'u',revision:1,created_at:'2026-10-25T00:00:00Z'};
          state.tags.push(structuredClone(t));return t;
        }
        assert.equal(name,'memo_save');saves++;
        assert.equal(p.p_request_id,`r${saves-1}`);assert.equal(p.p_expected_revision,saves===1?null:saves-1);
        assert.equal(p.p_body,['',plan.whitespace,plan.preserved][saves-1]);
        let row;
        if(saves===1){
          row={id:'memo',user_id:'u',title:p.p_title,body:p.p_body,revision:1,last_request_id:p.p_request_id,pinned_at:null,deleted_at:null,
            created_at:'2026-10-25T00:00:00Z',updated_at:'2026-10-25T00:00:00Z'};
          state.memoTags.push({user_id:'u',memo_id:'memo',tag_id:'tag'});
        }else row={...state.memos[1],body:p.p_body,revision:saves,last_request_id:p.p_request_id,updated_at:`2026-10-25T00:00:0${saves}Z`};
        if(mode==='title-normalized')row.title=row.title.normalize('NFC');
        if(mode==='body-trim'&&saves>1)row.body=row.body.trim();
        if(mode==='body-normalized'&&saves===3)row.body=row.body.normalize('NFC');
        if(mode==='body-newline'&&saves>1)row.body=row.body.replaceAll('\n','\r\n');
        if(saves===1)state.memos.push(structuredClone(row));else state.memos[1]=structuredClone(row);
        return {memo:row,tagIds:['tag']};
      },
      reject:async(name,p)=>{
        calls.push({name,payload:structuredClone(p),reject:true});const c=plan.rejects[rejects++];
        assert.equal(p[c.field],c.value);assert.equal(name,c.target==='tag'?'memo_save_tag':'memo_save');
        assert.equal(p.p_expected_revision,c.target==='tag'?1:3);
        if(c.target==='memo')assert.equal(p.p_request_id,`r${rejects-1+3}`);
        if(mode==='network')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
        if(mode==='memo-changed')state.memos[1].revision++;if(mode==='body-changed')state.memos[1].body='private changed';
        if(mode==='link-missing')state.memoTags=[];if(mode==='extra-link')state.memoTags.push({...state.memoTags[0]});
        if(mode==='other-changed')state.memos[0].body='private changed';if(mode==='tag-changed')state.tags[1].revision++;
        return {status:mode==='success'?200:mode==='http'?409:400,codeMatches:mode!=='code',message:mode==='message'?'wrong':
          name==='memo_save_tag'?'invalid tag input':p.p_title===null||p.p_body===null?'invalid argument':'invalid memo content'};
      }});
  }catch(e){error=e;}
  return {result,error,calls,confirmations,records,rejects};
}
test('正常4/拒否13・35 RPC/確認17回・全文字列保持と順序非依存比較',async()=>{
  const r=await simulate();assert.ifError(r.error);assert.equal(r.calls.length,35);assert.equal(r.confirmations.length,17);assert.equal(r.rejects,13);
  assert.equal(r.calls.filter((c)=>c.name==='memo_load_snapshot').length,18);assert.equal(r.result.revision,3);
  assert.ok(!JSON.stringify(r.records).includes('private'));assert.ok(!JSON.stringify(r.records).includes('Cafe'));
});
for(const mode of ['tag-normalized','title-normalized','body-trim','body-normalized','body-newline','memo-changed','body-changed','link-missing','extra-link',
  'other-changed','tag-changed','network','timeout','success','http','code','message','cancel-tag-preserved','cancel-body-preserved','cancel-title-empty',
  'record-tag-preserved','record-body-empty','record-title-empty']){
  test(`${mode}は停止・自動再送なし`,async()=>{
    const r=await simulate(mode);assert.ok(r.error);assert.ok(r.calls.length<=35);
    if(['network','timeout','success','http','code','message'].includes(mode))assert.equal(r.rejects,1);
    const ids=r.calls.filter((c)=>c.name==='memo_save').map((c)=>c.payload.p_request_id);assert.equal(new Set(ids).size,ids.length);
    if(mode==='cancel-tag-preserved')assert.equal(r.calls.length,1);
    if(mode==='record-body-empty')assert.equal(r.calls.filter((c)=>c.name==='memo_save').length,1);
  });
}
for(const mode of ['argument','content','tag','success','http','code','message','network','timeout','body','json']){
  test(`拒否通信 ${mode}（実通信なし）`,async()=>{
    let count=0;const name=mode==='tag'?'memo_save_tag':'memo_save';
    const action=()=>contentRejection('https://yohoppqflnhhvqypwhfv.supabase.co',{},name,{p_title:null},async(_url,options)=>{
      count++;assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
      assert.deepEqual(JSON.parse(options.body),{p_title:null});
      if(mode==='network')throw new TypeError('private');if(mode==='timeout')throw new DOMException('private','TimeoutError');
      return {status:mode==='success'?200:mode==='http'?409:400,text:async()=>{
        if(mode==='body')throw new TypeError('private');if(mode==='json')return 'private-invalid-json';
        return JSON.stringify({code:mode==='code'?'23514':'22023',message:mode==='message'?'private':mode==='argument'?'invalid argument':mode==='tag'?'invalid tag input':'invalid memo content'});
      }};
    });
    if(['success','http','network','timeout','body','json'].includes(mode))await assert.rejects(action());
    else{const r=await action();assert.equal(r.codeMatches,mode!=='code');assert.equal(r.message,mode==='message'?null:mode==='argument'?'invalid argument':mode==='tag'?'invalid tag input':'invalid memo content');}
    assert.equal(count,1);
  });
}
test('他origin/許可外RPCは送信前に停止',async()=>{
  let count=0;const f=()=>{count++;};await assert.rejects(contentRejection('https://production.example',{},'memo_save',{},f));
  await assert.rejects(contentRejection('https://yohoppqflnhhvqypwhfv.supabase.co',{},'memo_delete_tag',{},f));assert.equal(count,0);
});
