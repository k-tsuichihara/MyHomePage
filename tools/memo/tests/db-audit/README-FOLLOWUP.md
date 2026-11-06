# 追加カタログ監査：型OID・補助EXECUTE・依存・ロール（未実施）

作成日：2026-11-06。基準main：`78572fb7f673ae95162d27edf89be09c99b9f8c4`（PR #36マージ済み）。成果物は[followup-catalog-audit.sql](followup-catalog-audit.sql)と本手順。**SQL作成・本PRのマージは実行承認ではない。今回は接続・実行・実測取得を行わない。** 既存のSQL・正式原本・アプリコードは変更しない。

再提出：2026-11-06。PR #37のマージ`9fcdcfa`、取消コミット`8fc938f`、revert PR #38のマージ`4afdf56d9c57172743930e624d1d36a8efc9e4d8`を確認。最新mainから別ブランチへ対象4ファイルを復元してS05を修正した。mainのrevertコミットを取り消す操作やPR #37の再マージは行わない。上記の準備基準と監査履歴は保持する。復元・修正後も全SQLは未実行。

## 1. 根拠と今回埋める確認範囲

[監査履歴](../DEV-DB-AUDIT.md)、[チェックリスト](../DEV-DB-AUDIT-CHECKLIST.md)、[R02設計](../HELPER-EXECUTE-DESIGN.md)、[正式schema](../../doc/v1.1.0/memo_v1_1_schema_review8.sql)、[6関数パッチ](../../doc/v1.1.0/memo_v1_1_conflict_patch_review8.sql)を根拠とする。

オーナー報告では8RPCの本文は改行正規化後に一致しているが、memo_change_stateのpublic.memos/memos、memo_save_tagのpublic.tags/tagsは表示差によるREVIEWで型OIDは未確認。R02の補助4関数owner/実効権限、実DBの依存・継承もUNKNOWN。今回のSQL案で結果は取得しておらず、未確認をPASSにしない。A17の対応保留は別課題で、default privileges変更やR02の採用決定は含めない。

## 2. SELECT群と出力の解釈

各S番号は独立した1文。固定publicスキーマと完全な入力署名で関数を解決する。想定外overloadの本文は取得せず、同名全overloadの存在確認は既存A06の別承認範囲。全関数の存在・種別はS02で先に照合する。欠落・別種別ならS03以降へ進まない。

| 番号 | 対象・出力 | 判定方法・限界 |
|---|---|---|
| S01 | change_state/save_tagの関数OID、prorettype、public.memos/tagsのreltype、型schema/名前/typrelid | 2行を確認。OID-MATCHは同じDB・同じ照会時点でprorettype=reltype、型の参照先表一致、非SETOFの関数であるという判定。表示名だけでは判定しない。欠落NULLはUNKNOWN、相違はREVIEW。OIDを他DB/過去取得の値と比較しない |
| S02 | 固定12署名（8RPC＋補助4関数）の存在・種別・owner・DEFINER・ACL NULL有無 | 正確な12行/署名各1件。全prokind=fを確認。owner名を事前固定しない。補助4関数は原本ではINVOKER、RPCはDEFINER。owner欠落/未知属性なら停止 |
| S03 | 補助4関数のACL：grantee/grantor/privilege/Grant Option | explicit-aclとbuiltin-default-expandedを区別。NULL ACLはacldefaultで展開するが、A17の将来オブジェクトdefault ACLの照会とは別。空ACLでもLEFT JOINで対象を残し、NULL行を付与ありにしない。PUBLICはgrantee_oid=0。所有者の再付与権と通常EXECUTEを混同しない |
| S04 | anon/authenticated/authenticator、12関数owner、対象5表ownerから補助4関数への実効EXECUTEとpublic USAGE | 明示ACLと別の照会。PUBLIC/継承/所有・管理権限の影響を含む現在の判定で、どの付与経路かはS03/S06で確認。NULLは拒否falseではなく未確認。source別の重複ロール行は意図的。表欠落は既存A02と突合。実HTTP/JWTロール割当やRLS実動作を証明しない |
| S05 | memosの2CHECK、tagsの1CHECK、tags_name_per_userの種別・所属・直接関数依存数と総合判定 | 正常時4行、candidate_count=1。通常表r、CHECK種別c/validated、通常index種別i/pg_index行/所属表/unique/valid/readyと、期待関数依存1件・その他0件をすべて照合。欠落/依存0件等はUNKNOWN、相違はREVIEW、全条件成立時だけCATALOG-MATCH。式全文を取得しないため、列・引数・照合や式全体の意味一致は証明しない |
| S06 | 関連主体から所属先への再帰到達ロール、各辺のadmin/inherit/set、MEMBER/USAGE/SET | UNIONで再訪を抑え、関連主体から上位方向に限定。親から全子ロールへ展開しない。到達は構造上の所属経路であり、自動継承・SET可能性とは別。各辺のフラグとpg_has_roleを併記し、rolinheritだけで判断しない。superuserの特別扱い・実JWT/SET ROLEの実行可能性を網羅した証明ではない |

S05は固定CHECK/indexから登録されている直接の関数依存を数え、想定外依存の件数も通知する。式や本文は取得しない。補助関数同士・RPC本文の文字列解決、未知のビュー/ジョブ/動的SQLを網羅しない。追加調査は別承認。S06はクラスタ共通のロール関係を参照するため、上位ロールに運用情報が含まれ得る。公開時はロール名等も必要最小限の要約にする。

### S05修正の判定条件と静的レビュー観点

indexは名前でpublic内の候補を取得し、pg_indexはindexrelidだけで対応付けてactual_table_oid=indrelidを保持する。期待表をJOIN条件に入れて所属違いを隠さず、出力した期待table_oidと総合CASEで比較する。CHECKもcontypeを取得してcを確認する。同名の別種別を正しい対象としない。

| 想定状態 | overall_resultの設計上の期待 | 静的確認箇所 |
|---|---|---|
| 期待依存はあるがindex所属先が別表 | REVIEW | actual_table_oidとtable_oidの比較 |
| 同名のtable/sequence/partitioned index等 | REVIEW | indexのobject_kind=iに限定。通常表r以外も別設計として停止 |
| 通常index候補だがpg_index行なし | UNKNOWN | pg_index_oidのNULL確認 |
| 同名制約がCHECK以外 | REVIEW | checkのobject_kind=c確認 |
| 無効/未ready/非unique、未validated CHECK | REVIEW | 各状態のIS DISTINCT FROM true確認 |
| 期待関数の欠落、対象欠落、依存0件 | UNKNOWN | 欠落/依存不足を一致へ変換しない |
| 期待依存なし、追加関数依存あり、候補複数 | REVIEW | candidate_countと依存総数/期待数/その他数 |
| 全構造条件・期待依存1件・その他0件が成立 | CATALOG-MATCH | CASEの最終分岐のみ |

S05は関数依存の生行を並べる旧形式から、件数と総合判定を返す形式へ修正した。想定外依存はother_dependency_countとして通知し、詳細の追加取得は別承認とする。CATALOG-MATCHはカタログ上の限定一致であり、CHECK/index式の意味一致、評価時の実効権限、実動作のPASSではない。表のケースは静的な設計確認で、DBで再現試験した結果ではない。

## 3. オーナーの実行前承認・確認

次の確認が完了するまではSQLを実行しない。

1. 正規の管理手段でdev-sandboxのプロジェクト名/Refを確認。本番k-life-logは禁止。PG版やcurrent_userだけを環境証明にしない。
2. 実行するS番号、実行者の既存権限、期限、非公開の保管先/閲覧者/保持期間/破棄担当を承認する。新規接続設定・service_role/管理APIキー・権限昇格・ロール追加は不要。権限不足は停止し、管理者として自動再実行しない。
3. PG17向けのカタログ列/関数の互換性を確認。S06のinherit_option/set_optionとpg_has_roleのSET等を他版へ無確認で流用しない。SQL Editorのtransaction維持・結果タブ・行/セル制限・自動再試行の有無を確認する。
4. SQL Editorが接続先・sessionを保持した同一バッチでREAD ONLYを実施できることを確認。各選択実行が別transactionになる場合はREAD ONLYを保証したと扱わず停止し、実行方法を相談する。
5. 出力保護を先に確認する。画面共有・自動ログ/同期・Web配信から隔離し、結果はGit除外・非公開領域だけへ保存。ファイル名だけで非公開認定しない。関数本文・認証情報・ユーザーデータの取得を追加しない。

## 4. 手動SQL Editor実行案（別承認後のみ・今回は未実行）

監査SQLファイルはSELECTのみ。以下はオーナーが別途承認するセッション操作の例であり、永続設定変更や権限変更の案ではない。

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
SELECT current_user AS execution_role,
       pg_catalog.current_setting('server_version') AS server_version,
       pg_catalog.current_setting('transaction_read_only') AS read_only,
       pg_catalog.current_setting('statement_timeout') AS statement_timeout,
       pg_catalog.current_setting('lock_timeout') AS lock_timeout;
-- 同一transactionで事前確認後、承認されたS番号のSELECTだけを実行する。
ROLLBACK;
```

まず事前確認でread_only=on、承認されたPG版/role、timeoutが15s/3s相当であることを確認する。確認後、同一transaction内でS02の対象存在を確認し、S01・S03〜S06を承認範囲だけ実行する。全件実行を既定承認としない。複数結果タブを保持できないSQL Editorでは、確認と結果保全が可能な手順を実行前に確定する。条件確認前に監査SELECTが自動的に続行されるバッチにしない。

クライアント側も1文の待機上限を事前承認し、サーバーtimeoutとは別に管理する。エラー/timeout/ロック待機/予期しない値/切詰め/対象不在があれば後続停止。失敗transactionは同一sessionでROLLBACKして終了し、切断やUI中止だけでサーバー停止を断定しない。接続状態不明なら再送せず相談する。正常終了もROLLBACKで読取transactionを閉じる。自動再試行、SET ROLE、定義修正、GRANT/REVOKE、制約/index再作成は行わない。

カタログ走査、ACL展開、再帰ロール追跡にも負荷やメタデータロック待ちがある。関連上位ロールが多ければ結果が増えるため、15秒上限・出力制限を超えたら未確認で停止。LIMITで黙って間引いた結果を完全としない。実権限・負荷・構文・結果量は未検証。

## 5. 非公開保管・公開要約テンプレート

結果は非公開のまま照合する。公開先にはカタログ生結果・ACL一覧・関数本文・ハッシュ・秘密情報・実ユーザーIDを貼らない。[監査手順第11章](../DEV-DB-AUDIT.md)の保管/保全/個別破棄を適用し、既存の非公開CSV・抽出SQL・差分を今回の準備作業で開かない。

取得日時・環境確認根拠・実行者の権限区分・PG版・SQL版/S番号・read-only/timeout確認・出力欠落/切詰め・非公開保管の識別子を、承認された範囲で記録する。必要性のない生OID/ロール名はPRへ転載せず、判定要約に置き換える。

| 項目 | 現状 | 安全な結果要約欄 | 残課題・次の承認 |
|---|---|---|---|
| S01 戻り値2件 | 未実施・UNKNOWN/REVIEW継続 | 各型のOID同一/不一致/確認不能。実行後のみ記入 | 表記差だけでPASSにしない |
| S02 完全署名・owner | 未実施・UNKNOWN | 存在/種別/ownerを必要内部主体として確認できた範囲 | 欠落/未知主体は停止 |
| S03 補助ACL | 未実施・UNKNOWN | PUBLIC/直接付与/NULL既定展開/空ACLの区別 | 権限制限は別承認 |
| S04 実効EXECUTE | 未実施・UNKNOWN | anon/authenticated/内部主体の実効許可の要約 | 実呼出し・RLSは別試験 |
| S05 登録依存 | 未実施・UNKNOWN | 4対象の期待直接依存・追加依存・欠落の有無 | 式全体/本文依存は未検証 |
| S06 継承関係 | 未実施・UNKNOWN | 所属・即時継承・SET可能性の違いを要約 | 全クラスタ/実Authの監査ではない |

不足を推測で埋めない。今回の提出時点では全行未実施。取得成功と監査一致、監査一致と権限制限採用、採用と適用承認を分ける。R02は未解決、B案は未採用。A17の対応保留、実Auth/RLS/HTTP/競合/ロールバックなど既存のゲートを維持する。

## 6. 静的確認の根拠と未検証事項

- [PG17権限問い合わせ](https://www.postgresql.org/docs/17/functions-info.html)：OID指定のhas_function_privilege/has_schema_privilege、pg_has_role、acldefault/aclexplode。
- [PG17 pg_depend](https://www.postgresql.org/docs/17/catalog-pg-depend.html)：依存元/依存先のclassid・objid・subidを区別。
- [PG17 pg_auth_members](https://www.postgresql.org/docs/17/catalog-pg-auth-members.html)：admin/inherit/set列。クラスタ共通である点に注意。

静的点検は実DBでの構文・権限・欠落時挙動・負荷・出力完全性や、安全性の保証ではない。今回の実施範囲はSQL案/文書の読取り照合・差分/リンク検証だけで、DBやテスト環境での実行は行わない。
