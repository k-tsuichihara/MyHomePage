import test from 'node:test';
import assert from 'node:assert/strict';
import {compareSnapshots} from './snapshot-comparison.mjs';
const fixture=()=>({memos:[{id:'m1',body:'one',revision:1},{id:'m2',body:'two',revision:2}],
  tags:[{id:'t1',name:'one'},{id:'t2',name:'two'}],
  memoTags:[{memo_id:'m1',tag_id:'t1',user_id:'owner'},{memo_id:'m2',tag_id:'t2',user_id:'owner'}]});
test('配列順と各オブジェクトのキー順のみの違いを許容',()=>{
  const expected=fixture(),actual=structuredClone(expected);
  for(const k of Object.keys(actual))actual[k]=actual[k].reverse().map(row=>Object.fromEntries(Object.entries(row).reverse()));
  compareSnapshots(actual,expected);
});
for(const collection of ['memos','tags','memoTags']){
  for(const mode of ['value','type','field-added','field-missing','missing','extra','duplicate-actual','duplicate-expected','duplicate-both','equal-size-replacement']){
    test(`${collection}: ${mode} は拒否`,()=>{
      const expected=fixture(),actual=structuredClone(expected),rows=actual[collection];
      if(mode==='value')rows[0].user_id='other';
      if(mode==='type')rows[0][collection==='memoTags'?'user_id':collection==='memos'?'revision':'name']=42;
      if(mode==='field-added')rows[0].unknown=null;
      if(mode==='field-missing')delete rows[0][collection==='memoTags'?'user_id':collection==='memos'?'body':'name'];
      if(mode==='missing')rows.pop();
      if(mode==='extra')rows.push(collection==='memoTags'?{memo_id:'extra',tag_id:'t1',user_id:'owner'}:{id:'extra'});
      if(mode.startsWith('duplicate-')){
        if(mode!=='duplicate-expected')rows.push({...rows[0]});
        if(mode!=='duplicate-actual')expected[collection].push({...expected[collection][0]});
      }
      if(mode==='equal-size-replacement')rows[0][collection==='memoTags'?'tag_id':'id']='replacement';
      assert.throws(()=>compareSnapshots(actual,expected));
    });
  }
}
test('関連複合キーの区切り文字衝突を防ぐ',()=>{
  const a={memos:[],tags:[],memoTags:[{memo_id:'a|b',tag_id:'c'},{memo_id:'a',tag_id:'b|c'}]};
  compareSnapshots(a,structuredClone(a));
});
