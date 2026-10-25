import {isDeepStrictEqual as equal} from 'node:util';
import {UsageDiagnostic,SAFE_ROW_FIELDS} from './tag-usage-diagnostics.mjs';
const check=(v,item)=>{if(!v)throw new UsageDiagnostic('取得後検証',item);};
export function compareSnapshots(a,b){
  check(a&&b,'snapshot');
  for(const collection of ['memos','tags','memoTags']){
    const index=(rows,side)=>{
      check(Array.isArray(rows),`snapshot.${collection}.${side}.array`);
      const result=new Map();
      for(const row of rows){
        check(row&&typeof row==='object'&&!Array.isArray(row),`snapshot.${collection}.${side}.row`);
        const fields=collection==='memoTags'?['memo_id','tag_id']:['id'];
        check(fields.every((field)=>typeof row[field]==='string'&&row[field].length>0),`snapshot.${collection}.${side}.identity`);
        // Encode components, rather than concatenating with an ambiguous separator.
        const key=JSON.stringify(fields.map((field)=>row[field]));
        check(!result.has(key),`snapshot.${collection}.${side}.duplicate`);
        result.set(key,row);
      }
      return result;
    };
    const actual=index(a[collection],'actual'),expected=index(b[collection],'expected');
    check(actual.size===expected.size,`snapshot.${collection}.length`);
    for(const key of expected.keys())check(actual.has(key),`snapshot.${collection}.missing`);
    for(const key of actual.keys())check(expected.has(key),`snapshot.${collection}.extra`);
    for(const [key,wanted] of expected){
      const row=actual.get(key);
      for(const field of SAFE_ROW_FIELDS){
        check(Object.hasOwn(row,field)===Object.hasOwn(wanted,field)&&equal(row[field],wanted[field]),`snapshot.${collection}.${field}`);
      }
      // Compare complete rows, including unknown columns and added/missing fields.
      // isDeepStrictEqual ignores object key insertion order, but retains types and values.
      check(equal(row,wanted),`snapshot.${collection}.allFields`);
    }
  }
}
