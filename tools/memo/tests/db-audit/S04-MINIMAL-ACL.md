# S04：v1.1.0の最小helper権限整理

## 現在の契約と完了範囲

今回のオーナー方針により、S04は「不要なhelper直接実行権限を除去し、正式8 RPCを壊さないためのrepository準備」に限定する。旧[R02計画](R02-ACL-CHANGE-PLAN.md)の完全な原本復元・必要内部主体再構成を必須とした条件を、この範囲では置き換える。公開UI統合タスクR02 COMPLETEとは別の権限課題である。

S04 COMPLETEはSQL案・静的試験・Q04条件の準備完了として記録した。その後、オーナー個別承認によるdev-sandbox適用成功、Q04-READ限定PASS、Step 3ケース13/6（タグ作成/改名/競合とメモ作成/並行更新/保存照合）の総合PASSが報告された（[実行記録](../../../memo-db-test/Q04-RESULTS.md)）。S04差分として追加の実試験は不要と評価し、Step 3のS04差分確認を完了候補とする。これはQ04全体やsingle-rpc認定ではない。以下の未適用/未承認表現と試験一覧は準備履歴であり、現在の実施記録・差分選定を優先する。既存監査/ケースを再実行せず、非公開原本/内部値を要求しない。cleanup・公開・追加実環境操作は未承認。

## 必須条件の再評価

| 旧条件 | v1.1.0での分類 | 理由・今回の扱い |
|---|---|---|
| T02 ACL原本の完全性証明 | 将来hardeningとして延期可能 | 完全な元ACL再現のための条件。今回の撤回対象は固定4署名・3主体で、実行途中のエラーは原子的取消し。原本は非公開保持し、完全性確認済みとはしない |
| NOLOGIN候補の用途特定 | 現在の目的には不要 | 新規GRANTも既存の個別内部GRANT撤回も行わない。NOLOGIN属性から必要性を推定しない。既知の正式RPC/CHECK/index経路はQ04対象。候補が実際に必要な経路と判明した場合のみ再評価 |
| 4署名ごとの内部主体GRANT設計 | Q04で実証すれば足りる | 追加GRANTが必要とは未確定。撤回後に既存RPC ownerの実効EXECUTEをガードし、不足なら全取消し。自動追加せず、その不足が出た場合のみ具体的な最小修正を再設計 |
| 候補主体への非波及証明 | 候補の一般的証明は現在の目的には不要 | 候補へ権限を追加しない。ただしclientにhelper実行が残らないこと自体は公開必須。SQLが現在の継承/SET到達権限を検査し、Q04で直接拒否を確認する |
| grantor/Grant Optionを含む完全な元ACL復旧 | 将来hardeningとして延期可能 | 完全逆操作は作成しない。RESTRICTで付与連鎖の自動取消しを避け、適用失敗は取消し。成功後の問題は利用停止と限定forward fixを別承認する |
| NULL ACLの完全復旧条件 | 現在の目的には不要 | proaclのNULL表現を再現することはクライアント直接拒否/正式RPC正常性の成立条件ではない。直接catalog更新や関数再作成はしない |

完全復元を準備しないことは、無条件の復旧保証を意味しない。Supabaseのバックアップ/PITRについて利用可否・復元粒度・権限ACLの復元を確認していないため、代替保証には数えない。今回の復旧方針は「失敗時原子的取消し、成功後の不具合は停止して対象限定forward fix」。PUBLIC再公開・推測したGRANT・自動retry/rollbackはしない。

## 静的根拠と最小SQL

正本はreview8 schema/競合patch、既存監査A01〜A17・8 RPC body・S01〜S06・T00〜T05。本文一致、4 helperの存在・INVOKER属性、8 RPCのDEFINER属性、CHECK3件/index1件のCATALOG-MATCHを再利用する。srcのRPC経路にhelper直接呼出しはない。ブラウザの入力検証はTypeScriptで実装し、DB側はmemo_save/memo_save_tagおよびDMLに伴うCHECK/indexからhelperを使用する。直接表DMLは既存契約で禁止されている。

schemaは同じ適用主体による関数作成を記述するが、実DB ownerの同一性は仮定しない。SECURITY DEFINERはRPC ownerとして実行し、INVOKER helperはその実行主体を引き継ぐ。ownerも通常権限を撤回可能であり、「ownerだから必ずEXECUTE可能」とはしない。

[s04-helper-execute.sql](s04-helper-execute.sql)は単一DO文で次を実行する**未適用のレビュー案**。

1. 固定4 helper/8 RPCの存在・関数種別・DEFINER属性とclient role存在を検査。
2. helper4件だけPUBLIC/anon/authenticatedのEXECUTEをRESTRICTで撤回。
3. 各RPC ownerに各helperの実効EXECUTEが残るか検査。これは保守的な十分条件であり、全ownerが全helperを使うとの主張ではない。不足でもGRANTしない。
4. clientの実効EXECUTE、SET可能なrole経由のEXECUTE残存があれば例外。継承は実効権限関数で検査。

例外を握り潰さず、1文全体を取消す。autocommit環境では成功時に永続化するため、SQLを開く・保存する行為と実行承認を区別する。DO内にCOMMIT/ROLLBACKはない。環境制限はSQL自身のProject Ref検出ではなく、承認済み実行入口の責務。時間上限・同時DDL/権限変更のない時間枠も適用承認時に定める。既存15s/3s方針を無断変更しない。

ロール追加・追加GRANT・既存RPC ACL/owner/本文・表ACL/RLS・CHECK/index・schema・A17のdefault ACLは変更しない。一般的ACL管理・ロールグラフ再構築は追加しない。8 RPC ownerのガードは実行正常性や全保守主体を証明しない。Q04を省略しない。

## Q04への引継ぎ・停止条件

既存[E01〜E11](R02-ACL-CHANGE-PLAN.md)の関連ケースと既存入力/タグ試験を再利用し、新しい汎用試験基盤は作らない。

- 個別承認後のdev-sandbox適用に限る。確認済みProject Ref/origin/isolationや過去監査は、具体的な変更理由なしに再監査しない。
- 適用SQLの成功/失敗/終了不明を区別。失敗は後続停止、終了不明は再送禁止。同時DDL/権限変更・ガード不一致では適用を進めない。
- anon/authenticatedで4 helper直接拒否、authenticatedで正式8 RPC正常性。RPCによるメモ作成/更新、タグ作成/改名、CHECK入力拒否、一意indexのASCII同値/非ASCII区別を合成データで確認。
- RPC ACL、表直接DML禁止、RLS所有者分離、要求台帳・競合・結果不明契約を維持。実Auth/HTTP/応答出所・single-rpcは既存acceptanceの別条件であり、今回認定しない。
- 新しい権限不足が出たら失敗した実経路だけを対象にforward fixを設計し、個別承認。内部roleの推測GRANTやPUBLIC再付与で回避しない。
- SQL適用成功だけで公開しない。合成対象・呼出し/変更件数・実行時間・停止担当・後片付けは実操作前に承認。自動再送・自動削除なし。

## AI Gateの限界と仕様根拠

今回の結果：typecheck PASS、S04静的4件と既存RPC adapter/sender/Auth境界147件（計4ファイル151件）PASS、git diff --check PASS。実DB/SQL/Auth/RPC操作0件。既存監査再実行0件。未追跡の既存Human Gate成果物は参照・変更・追加しない。

`s04-helper-execute.test.ts`は対象署名を既存監査SQLと照合し、変更範囲、例外/権限ガード、schemaのDEFINER/INVOKER属性を静的検査する。SQLを実行せず、PostgreSQL構文受理・実効権限・ロール到達・原子性の実証やRPC回帰PASSとは扱わない。

- [PostgreSQL 17 CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html)：DEFINER/INVOKERとowner。
- [PostgreSQL 17 privileges](https://www.postgresql.org/docs/17/ddl-priv.html)：ownerの通常権限は撤回可能。
- [PostgreSQL 17 DO](https://www.postgresql.org/docs/17/sql-do.html)：一度実行される匿名コードブロック。
- [PostgreSQL 17 transaction](https://www.postgresql.org/docs/17/tutorial-transactions.html)：文/transactionの原子性。
- [PostgreSQL 17 privilege inquiries](https://www.postgresql.org/docs/17/functions-info.html)：has_function_privilege、pg_has_role SET。

A17/S05は従来どおり保留。既存ACL原本は破棄せず非公開保管契約を維持する。本準備は実DB適用・production変更・公開の承認ではない。
