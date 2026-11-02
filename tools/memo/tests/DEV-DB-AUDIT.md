# 開発Supabase DB：定義・権限監査の準備手順

作成日：2026-11-02。基準main `3b74b6d048b5a89e2a54e19dfc66d9988751d0d4`（PR #29マージ済み）。**監査SQLは未実行案。DB接続・SQL実行・設定変更・認証情報取得を承認する資料ではない。** 本PRは資料だけであり、稼働DBとの一致は未確認。

## 1. 根拠と成果物

- 正式原本：[Review8 SQL](../doc/v1.1.0/memo_v1_1_schema_review8.sql)、[6関数パッチ](../doc/v1.1.0/memo_v1_1_conflict_patch_review8.sql)、[統合仕様](../doc/v1.1.0/memo_v1_1_implementation_review8.md)、[正式型](../doc/v1.1.0/memo_v1_1_types_review8.ts)。原本は変更しない。schema SQL先頭のreview7等は履歴表記であり、ファイル名だけで適用済みと扱わない。
- クライアント：[RPC契約](CLOUD-RPC.md)、src/cloud-rpc-adapter.ts、snapshot-validation.ts。固定HTTPマッピングは500/P0002、409/PT409、void204、JSON200。実transportのsingle-rpc認定は未検証。
- 過去試験：[33項目サマリー](../../memo-db-test/TEST-SUMMARY-2026-10-25.md)、[ケース22](../../memo-db-test/UNAUTHENTICATED-TEST.md)、[ケース23](../../memo-db-test/ISOLATION-TEST.md)。最終33PASSは当時の公開RPCの結果であり、現行DBの全カタログ/ACL監査ではない。Auth/RLSの代表操作、競合、入力、タグ、完全削除等の実行実績と、今回の未実行定義監査を区別する。
- [catalog-audit.sql](db-audit/catalog-audit.sql)：A01〜A17のSELECTだけ。
- [function-definitions-optional.sql](db-audit/function-definitions-optional.sql)：別承認後に所有者が非公開で関数定義を取得するSELECTだけ。
- [差分チェックリスト](DEV-DB-AUDIT-CHECKLIST.md)：期待値・判定・差分・判断を記録するテンプレート。

## 2. 対象と禁止事項

対象は開発専用dev-sandboxのpublic.memos/tags/memo_tags/memo_id_registry/memo_requests、8RPCと4検証関数、関連する権限・pgcrypto。DBが構築済みであっても、定義・権限一致を前提にしない。

ユーザーテーブルのSELECT/COUNT、Authユーザー・台帳・削除済みIDの実値、pg_statsの分布値、接続文字列、JWT/GUC全文、pg_authid、他セッションのクエリ/ログは取得しない。public.memo_*やauth.uid、extensions.digestを実行しない。DDL/DML、DO/CALL、EXPLAIN ANALYZE、動的SQL、SET ROLE、GRANT、設定変更は含めない。pg_get_*は定義を文字列化するための組込関数で、その出力を実行しない。

## 3. 実行前に別途必要な承認と環境確認

1. オーナーが管理画面等の既存の正規手段でプロジェクト名・Project Refを確認する。本番k-life-logは対象外。DB側のversionやcurrent_userだけでは接続先のプロジェクトを証明できない。
2. 実行者、既存の接続手段、読取専用セッション、A番号、任意定義取得の可否、期限、結果保管先を承認する。service_role/管理APIキーを新しく使わない。SQL Editor等の既存の権限も自動的に使用許可されたとは扱わない。
3. 新規権限付与・監査ロール作成・接続設定変更はしない。権限不足ならその項目を未確認で停止し、必要な理由をまとめてオーナーへ相談する。所有者による実行・サニタイズ結果の提供を第一候補とする。
4. SQL案をレビューし、PostgreSQLの実版とカタログ列/関数の対応を確認する。主にPG14〜18のカタログを想定するが、実環境での構文/権限/負荷は未検証。読取専用セッションとクライアント側の15秒上限を推奨する。設定方法は今回のSQLに含めず、必要なら別承認する。PG側timeout/lock_timeoutが無制限なら実行前判断が必要。
5. 同時DDL/権限変更を避け、A番号ごとに実行・保存する。中断時は自動再実行せず、クライアントの中止だけでサーバー処理終了を断定しない。出力の行数制限/切詰めがある場合は不完全と記録する。

## 4. 実行順序・SQLの対応

| 番号 | 取得する定義/状態 | 確認点 |
|---|---|---|
| A01 | PG版/UTF8、実行ロール、read-only、timeout | 読取専用・負荷制限を確認。PostgREST版は含まない |
| A02 | 5表の存在・種別・所有者・RLS/FORCE RLS | 欠落や通常table以外なら後続を止めて判断 |
| A03〜05 | カラム型/順序/NULL/default、制約、index有効性 | 未知列も表示してTSの厳格検証への影響を記録 |
| A06 | 8RPC+4検証関数の全overload、戻り値/所有者/secdef/search_path/属性 | 余分なoverload、想定外設定、欠落を見落とさない |
| A07 | 全対象policyのroles/command/USING/WITH CHECK/permissive | 追加の許可policyによるOR緩和も確認 |
| A08〜10 | table/column/functionのACL | NULL ACLをdefault展開し、PUBLICを含めて確認 |
| A11〜13 | anon/authenticatedの実効table/column/function/schema権限 | ACLの表示と実効権限、RLSによる行制限は別 |
| A14 | 関連ロール属性/直接membership | ownerやBYPASSRLS、継承による許可に注意 |
| A15 | pgcrypto版・配置・digestの型/拡張所属 | extensionsに存在しなければ勝手に移設しない |
| A16 | 対象表の追加トリガー/ルール | 正式SQLにない挙動・データ参照の可能性を記録 |
| A17 | schema ACLと対象所有者のdefault privileges | 将来作成する関数/表の露出。現行ACLの代用にしない |

A06のfingerprintは定義差分追跡用であり、安全性の証明や秘密情報の匿名化ではない。リポジトリSQLファイルのmd5とは比較できず、版や整形で変化し得る。同じ値だけで意味一致と判定しない。関数本体の所有者条件・要求台帳・PT409・原子性の定義確認は任意ファイルによる別承認の取得/非公開レビューが必要。不許可なら本体は未確認とする。

A06は関数不在行を残し、identity_arguments/arguments_with_defaults/result_type/owner/設定一覧/fingerprintは存在時だけCASE内で評価する。逆解析関数のNULL引数時の挙動やSTRICT属性に依存しない。A02の不在表ownerとA03のdefault不在も同様に保護する。他の逆解析箇所は対象をINNER JOINした既存オブジェクトに限る。対象版での実際の挙動・SQL構文は未検証のまま、欠落時の動作をPASSと記録しない。

search_path以外のproconfigは設定名だけを出力する。未知の設定名があれば停止して相談し、JWT等の設定値を追加取得しない。入力検証4関数のdefault PUBLIC EXECUTEは、8RPCへのPUBLIC EXECUTE残存と区別する。補助関数のACL変更方針を勝手に確定しない。

## 5. 権限と監査の限界

基本的にはシステムカタログの参照と、pg_catalogの定義/権限問い合わせ関数の実行権限を用いる。アプリ表のSELECT、DBスーパーユーザー、service_roleキーは要求しない。ただしホスト環境のカタログ制限・メタデータ可視性・関数EXECUTE制限により取得できない場合がある。information_schemaの空結果やエラーを「対象なし/権限なし」の証明にしない。

- `pg_roles`で属性だけを選び、パスワード列を選ばない。pg_auth_membersは直接の関連だけであり全継承グラフを列挙したものではない。A11〜13は指定ロールの実効権限を別途照会する。SET ROLE可能性や実際のJWT/接続ロール割当を完全監査するものではない。
- 所有者名は正式SQLの実行主体で決まる。固定の正解ロール名は設計書から断定できない。SECURITY DEFINERはRLSを回避し得るため、関数内所有者条件とowner属性を両方確認する。監査者としての成功が一般ユーザーの権限を証明するわけではない。
- ACLは現時点の設定であり、過去にどのREVOKEを実行したかの履歴ではない。RLS実効動作・ユーザー間隔離・拒否時のDB不変は別途承認した実HTTP試験が必要。
- registry/requestsは列・PK・ACL・RLS・関数定義だけを確認する。実台帳件数、保存ハッシュ、削除済みフラグ/内容消去、ID再利用拒否が正しく稼働していることは直接証明しない。

## 6. 負荷・情報露出・保管

テーブルデータを走査しないが、カタログ走査・ACL展開・定義逆解析にもCPU/メモリとメタデータロック待ちが生じ得る。対象名/namespaceを絞っても常に一定時間とは限らない。長時間実行、DDL待機、権限エラー、版非対応、切詰め、予期しない定義があれば停止して報告する。自動的に範囲拡張や制限解除をしない。

定義には列default・CHECK・policy・関数設定・トリガー先・ロール名等が含まれ、想定外の定義には秘密や業務情報が直書きされている可能性がある。特に任意の関数全文は追加承認後、所有者が非公開で確認する。読み取り専用でも情報露出は起こり得る。組込の逆解析/型表示の内部処理も環境に依存するため、未知の型/拡張/定義があれば以後を止める。読取専用セッションだけで秘密情報の表示を防げるとは考えない。

結果はプロジェクトローカルのGit除外済み`.cloud-live/`等の承認済み非公開領域で保管し、Web配信/同期/アップロード対象にも含めない。自動収集は今回実装しない。PRにはチェックリストの判定とサニタイズした差分要約だけを載せ、関数全文・生結果・接続情報・実ユーザーIDを貼らない。切詰め/欠落項目は未確認のまま残す。

## 7. PostgreSQLとPostgRESTの版

PostgreSQLはA01で取得する。PostgRESTは独立サービスであり、pg_extensionやserver_versionから推定できない。オーナーが管理画面・既存の運用情報からデプロイ版/取得日時/根拠を確認する（その画面のアクセスも別途承認）。バナー/ヘッダーだけではプロキシ等との対応を確定しない。取得できなければ未確認とし、v14マッピング前提の実接続ゲートを解除しない。APIへの追加照会や設定/ログ全文取得を今回のSQLに混入させない。

## 8. 差分判定と承認一覧

チェックリストは一致/差分/未確認/対象外のいずれかで記録する。A番号、取得日時、実行者の権限区分、定義の対応箇所、差分の影響、オーナー判断を残す。監査資料のマージは実行許可でもDB一致の判定でもない。

別途承認が必要：開発環境への接続、カタログSQL各群の実行、任意関数全文の取得と保管、既存管理権限でのオーナー実行、PostgREST版の確認、権限/設定/SQL定義の修正、一般ユーザーによるAuth/RLS/GRANTの実動作試験、台帳を含むデータ確認。必要権限が足りなければ昇格/付与せず相談する。差分があってもスキーマ全文や6関数パッチを自動適用しない。

## 9. 今回の検証範囲と一次資料

監査SQLの静的レビューだけを行い、DBでの構文・権限・応答・負荷は未検証。SQLファイルをCLIやビルドへ接続しない。型チェック・既存Vitestと差分チェックを資料変更の回帰として実施し、DB監査のPASSとは扱わない。公開HTML/JS/CSS・製品コード・既存SQL原本・DB試験手順は変更しない。

- [PostgreSQLカタログ/権限問い合わせ](https://www.postgresql.org/docs/18/functions-info.html)
- [pg_proc](https://www.postgresql.org/docs/18/catalog-pg-proc.html)、[pg_policy](https://www.postgresql.org/docs/18/catalog-pg-policy.html)、[ACL](https://www.postgresql.org/docs/18/ddl-priv.html)
- [PostgREST 14エラー分類](https://docs.postgrest.org/en/v14/references/errors.html)

公式資料の版と稼働版を同一視せず、実行前に対象版で再確認する。

今回の確認結果：型チェックPASS、既存Vitest30ファイル1,300件PASS。SQLの静的点検では通常案22文・任意案1文がSELECT/CTEで、DML/DDLやアプリ表/関数への直接参照を含まないことを確認した（文字列リテラル内の対象名はカタログfilter用）。これはSQLパーサー/DBでの構文・権限検証や、安全性の完全な証明ではない。ステージ済み差分を含むgit diff --checkを実施する。資料だけの変更のためビルド/ブラウザE2Eは再実行しない。実接続・SQL実行・認証情報取得・DB監査結果は0件で、チェックリストは全項目未確認のまま提出する。

先生レビュー後も同じ範囲で再確認し、A06の3種のpg_get_function_*、fingerprint、A02/A03に明示的な存在時CASEがあることを文字列ベースで静的点検した。型チェック・既存1,300件・差分チェックはPASS。対象版のSTRICT属性やNULL時の実動作、SQLの構文/実行は検証していない。関数全文の別承認・実行前の読取専用/期限確認は引き続き必要。
