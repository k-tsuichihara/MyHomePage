# R02：補助EXECUTEの変更・復旧レビュー案（適用禁止）

作成日：2026-11-07。基準main：`61d81d6692350c5f33fe5a246382d351ea6e0891`（PR #40マージ済み）。[R02設計](../HELPER-EXECUTE-DESIGN.md)のB案を具体化する静的レビュー資料。**B案は第一候補・未採用、R02は未解決。** 取得済み監査の要約は[監査記録第15章](../DEV-DB-AUDIT.md)を参照し、再記載しない。

今回の許可は設計作成だけ。DB接続・SQL実行・GRANT/REVOKE/DDL/DML適用・本番操作は禁止。実行可能な変更SQLファイルは作らない。以下のSQL例はすべてコメント化した未完成ひな型であり、コピーして実行する手順ではない。UNKNOWNを埋めた実行版と復旧版は、非公開環境での確認・レビュー・適用の個別承認後に別途作成する。

## 1. 適用前チェックリスト（全項目未完了）

S01〜S06の過去報告を、適用直前の状態や変更後の安全性の確認に流用しない。個別ロール名・OID・ACL一覧は非公開台帳で管理し、ここには安全な要約と判断だけを残す。

| ID | 適用前に必要な確認 | 現在/停止条件 |
|---|---|---|
| P01 | 正規手段によるdev-sandboxのプロジェクト確認、実行者・時間枠・試験範囲・停止担当の承認 | 直前確認は未実施。本番・接続先不明は停止 |
| P02 | 第2章の4完全署名の存在/種別/owner、未知overload・依存・同時DDLの有無 | 過去は存在確認済み。現在のowner識別と変更権限はUNKNOWN |
| P03 | 関数別の明示ACL、NULL/空ACL、既定展開、付与者/付与先/EXECUTE/Grant Optionを保全 | 個別全内訳はUNKNOWN。復旧情報不足なら停止 |
| P04 | PUBLIC・anon・authenticatedの直接付与、継承/SET経路、実効EXECUTE、schema USAGE | 過去は許可あり。変更直前の全経路と変更後残存はUNKNOWN |
| P05 | 各RPC owner、補助owner、表owner、CHECK/index評価・保守主体の必要EXECUTEを非公開対応表で確定 | 主体・必要範囲はUNKNOWN。所有者/管理者だから足りると仮定しない |
| P06 | 必要内部主体の許可がクライアントに継承されないこと、既存8RPC ACL・表ACL/RLSを維持できること | 未検証。不一致なら権限を広げず設計へ戻る |
| P07 | 変更前ACLの保存先・閲覧者・保持期限・破棄担当、復旧手順・実行権限・照合手順 | 未確定なら適用不可。非公開CSV等を今回のAI作業では開かない |
| P08 | 合成データ専用の変更前後試験E01〜E11、呼出し/変更件数・時間上限・後片付け範囲を承認 | 実試験未完了。権限不足や未知応答で後続書込を停止 |
| P09 | 変更版/逆操作版を同時レビューし、適用直前一致確認、commit判断者、commit後停止/復旧条件を承認 | 実行版は未作成。自動commit/自動復旧は認めない |

P01〜P09の未完了・UNKNOWNが1件でもあれば適用しない。R02対応を理由にA17のdefault privileges、所有者、DEFINER属性、schema、8RPC、CHECK/index定義、表権限、RLSを変更しない。

## 2. 対象と必要主体の非公開対応表

対象は以下の4署名のみ。関数名ワイルドカード、全関数への操作、将来オブジェクト向けdefault privileges変更は対象外。

- `public.memo_edge_spaces()`
- `public.memo_trim_edges(pg_catalog.text)`
- `public.memo_valid_text(pg_catalog.text, pg_catalog.text)`
- `public.memo_tag_key(pg_catalog.text)`

| 対応表の項目 | 値/設計方針 |
|---|---|
| 署名ごとのowner・ACLを操作できる主体 | UNKNOWN。実ロール名やOIDは公開しない |
| RPCの有効主体→valid_text→trim_edges→edge_spaces | 必要なEXECUTEを各段で照合。権限集合・内部主体はUNKNOWN |
| タグindexのtag_key、CHECK評価、表/保守主体 | 対象別に必要権限を照合。実評価主体と保守経路はUNKNOWN |
| 既に必要権限を持つ内部主体 | 不要な重複GRANTを追加しない。PUBLIC撤回後も許可が残るかを確認 |
| 不足する内部主体 | 必要な署名だけのEXECUTE、原則Grant Optionなし。確定前は実行版作成不可 |
| クライアントからの継承/SET経路 | 内部許可が波及する場合は停止。共有ロールの会員関係を無断変更しない |

PUBLICからの撤回は全ロールへ影響する。anon/authenticatedの直接付与だけを消してもPUBLICや継承由来の許可は消えず、PUBLICだけを消しても直接付与が残る。今回の設計は両方を対象とし、残存経路は適用前後の実効権限と実呼出しで確認する。

## 3. 変更SQLのレビュー用ひな型（非実行）

このブロックは全行コメントで、処理を実行しない。UNKNOWNは内部対応表の未確定箇所を示し、実ロール名を推測した代替値ではない。1つのplaceholderで全経路の必要主体が同じと仮定しない。

```sql
-- 非実行の静的レビュー案。P01〜P09未完了。全行コメントを維持する。
-- BEGIN;  -- 将来の承認済み適用用。READ ONLY監査transactionとは別。
-- SET LOCAL statement_timeout = <UNKNOWN:承認する変更時上限>;
-- SET LOCAL lock_timeout = <UNKNOWN:承認する変更時ロック待ち上限>;
-- 適用直前の4署名/owner/ACL/継承と、非公開の承認済みスナップショットを照合。
-- 必要な内部許可を先に確保。不足がない署名はGRANT不要。
-- GRANT EXECUTE ON FUNCTION public.memo_edge_spaces() TO <UNKNOWN:この署名の必要内部主体>;
-- GRANT EXECUTE ON FUNCTION public.memo_trim_edges(pg_catalog.text) TO <UNKNOWN:この署名の必要内部主体>;
-- GRANT EXECUTE ON FUNCTION public.memo_valid_text(pg_catalog.text, pg_catalog.text) TO <UNKNOWN:この署名の必要内部主体>;
-- GRANT EXECUTE ON FUNCTION public.memo_tag_key(pg_catalog.text) TO <UNKNOWN:この署名の必要内部主体>;
-- 以下は既定RESTRICT。CASCADEで下流付与を自動取消ししない。
-- REVOKE EXECUTE ON FUNCTION public.memo_edge_spaces() FROM PUBLIC, anon, authenticated RESTRICT;
-- REVOKE EXECUTE ON FUNCTION public.memo_trim_edges(pg_catalog.text) FROM PUBLIC, anon, authenticated RESTRICT;
-- REVOKE EXECUTE ON FUNCTION public.memo_valid_text(pg_catalog.text, pg_catalog.text) FROM PUBLIC, anon, authenticated RESTRICT;
-- REVOKE EXECUTE ON FUNCTION public.memo_tag_key(pg_catalog.text) FROM PUBLIC, anon, authenticated RESTRICT;
-- 非公開の許可/拒否行列と照合。残存継承・必要内部主体の不許可なら停止してROLLBACK。
-- COMMIT / ROLLBACK は承認済み判断者の明示判断。自動続行しない。
```

実行版では適用前スナップショット不一致時の停止を実装/運用で確認し、上記の説明コメントだけをガードとして信用しない。RESTRICTで付与連鎖の問題が判明すれば停止し、CASCADEや広範なロールREVOKEへ切替えない。既存の第三者付与者からのgrantを適用主体が撤回できるかもUNKNOWNであり、無警告・成功表示だけで権限が消えたと判定しない。

同一transactionでACL変更をまとめ、途中失敗は取消す。ACL操作のためのtransactionはREAD ONLYではないため、既存の読取監査承認とは別。SQL Editorのセッション維持・接続経路の自動再試行・中断後の状態確認を事前に決める。別HTTPセッションが未commitのACLを見るとは仮定せず、commit前の限定確認とcommit後の実HTTP試験を分ける。

## 4. 変更前ACLの保全と復旧SQLのレビュー方針

変更前・予定変更後・復旧後の3状態を非公開で比較できる台帳を準備する。完全署名・owner・ACLがNULLか空か明示か・明示/展開の付与者/付与先/Grant Option・実効権限・継承・取得時刻を保存する。アプリデータや本文は取得しない。保全の完全性を別の担当が確認できなければ適用しない。

| 状態 | 復旧の考え方・停止条件 |
|---|---|
| NULL ACL | 組込既定の展開と元のNULLという事実を別々に保全。GRANTで意味上同等でもproaclのNULL表現まで元通りになると保証しない。表現差を許容するかは適用前のオーナー判断。厳密NULL復元が必要で手段未確定なら適用停止。カタログ直接更新や関数再作成で回避しない |
| 明示ACL | 元の付与者・付与先・EXECUTE・Grant Optionを保全し、変更差分に対する正確な逆操作を設計。付与連鎖の順序と実行権限を確認し、第三者変更を上書きしない |
| 空ACL | 元が権限なしであることを維持。NULL既定と同一視せず、新たなPUBLIC付与をしない |
| 同一transaction内の失敗 | 未commitならROLLBACKでACLと同transactionの試験変更を取消す。接続/transactionの存続を確認し、別sessionのROLLBACKを代用にしない |
| commit後の失敗 | 後続試験書込を停止し、現状態と承認済み変更後状態の一致を読取確認してから、別途承認された逆操作版を適用。復旧後に元ACL/実効権限/機能を照合 |
| 第三者変更・commit結果不明 | 自動復旧/再適用禁止。未適用・成功を推測せず、安全な読取確認の範囲を別承認。競合するgrantor/ACL等があれば復旧案を再レビュー |

復旧SQLは次の形を満たす必要があるが、正確な4署名ごとの元ACLがUNKNOWNのため、今回は命令列を完成させない。

```sql
-- 非実行の復旧設計。復旧実行者/正確な元ACL/付与順序はUNKNOWN。
-- BEGIN;
-- 現状態が承認済み変更後状態と一致しない、またはcommit結果不明なら停止。
-- 対象集合は次の4署名に固定する：
-- public.memo_edge_spaces()
-- public.memo_trim_edges(pg_catalog.text)
-- public.memo_valid_text(pg_catalog.text, pg_catalog.text)
-- public.memo_tag_key(pg_catalog.text)
-- 各署名の変更前/変更後差分だけを逆転する（下記は構文説明であり実行不能）。
-- REVOKE <UNKNOWN:今回追加した権限またはGrant Option> ON FUNCTION <UNKNOWN:上記の対象署名> FROM <UNKNOWN:今回追加した主体> RESTRICT;
-- GRANT EXECUTE ON FUNCTION <UNKNOWN:上記の対象署名> TO <UNKNOWN:元の付与先> <UNKNOWN:元のGrant Option有無>;
-- 元の付与者での再現可否と元の権限連鎖は非公開で事前レビューする。
-- 復旧前後の比較が不成立ならCOMMITせず停止する。
-- COMMIT / ROLLBACK は明示承認された復旧判断に従う。
```

上記を文字列置換だけで生成・適用しない。実際には今回追加した許可の取消し、元の付与の復元、必要ならGrant Optionだけの差分処理を区別し、grantorと連鎖順序を含めて別レビューする。PUBLICへの単純再付与は復旧完了ではない。元からPUBLIC許可があった場合の復元もリスクを戻すため承認が必要。ACL復旧は試験データや別transactionの変更の復元ではない。自動削除/データ初期化はしない。

## 5. E01〜E11との対応・合否条件

既存のベクトルと期待値は[R02設計第6章](../HELPER-EXECUTE-DESIGN.md)を再利用する。全行未実施であり、過去S監査の成功でチェック済みにしない。実行許可・環境・対象ID・回数上限・非公開証跡保管を個別に承認する。

| 既存項目 | 今回設計との対応 | 変更後/復旧後に確認すること |
|---|---|---|
| E01 ACL/実効権限 | P02〜P07、非公開3状態台帳 | 全4署名で最小許可。復旧後は元の明示/展開・実効許可と照合し、NULL表現差を別記 |
| E02 直接拒否 | PUBLICと直接付与の制限、残存継承点検 | anon/authenticatedの実直接呼出し拒否。SQLとHTTPを区別し、RPC未公開エラーだけで代用しない |
| E03 8RPC正常 | 内部主体の必要許可確保、8RPC ACL維持 | 全8RPCの合成正常系。復旧後も正常。削除試験は対象固定・別承認 |
| E04 メモ/関連更新 | CHECKを通る書込と有効主体 | 作成・更新・状態変更・タグ削除で必要内部許可を維持。他ユーザー/非対象の不変 |
| E05 タグ一意性 | tag_keyのindex評価 | タグ作成/改名、ASCII同値の拒否・非ASCII区別。復旧後も一致 |
| E06 入力制約 | valid_text/trim/edgeチェーン | タイトル/本文/タグの正常・不正・境界値を維持。権限不足を入力不正と混同しない |
| E07 CHECK直接経路 | 承認された内部DML主体の隔離試験 | RPC事前検証で隠れるCHECKを検証。一般クライアントにDML権限を追加しない |
| E08 index保守 | 評価主体と保守担当の対応表 | 隔離再現で必要許可を確認。稼働indexの無断再作成・REINDEXなし |
| E09 権限不足 | 未確定/不足主体での停止・取消し | 想定外42501等で後続停止、部分変更なし。未知応答/通信断を確定失敗にしない |
| E10 不変性 | 対象4署名のACL差分限定 | データ・本文・所有者・他ACL・RLS・CHECK/index定義の非変更。合成データの対象外不変 |
| E11 失敗/復旧 | 第4章の状態別分岐 | 未commit取消し、commit後の承認済み復旧、競合/結果不明停止、復旧後の権限と動作一致 |

変更後の直接拒否と内部経路正常が両立しなければB案を採用しない。復旧が必要な状態では機能の再開を自動判断しない。SQLSTATE/HTTPの期待値は既存CLOUD-RPC契約と実版・出所確認に従い、既存アダプターの分類を変更して試験を通さない。

## 6. 未解決事項と停止条件

- 実owner・必要内部主体・全grantor/Grant Option・継承の正確な対応：UNKNOWN。
- 変更直前状態、非公開保全の完全性、NULL表現と意味上同等復旧の受入条件：未確定。
- 変更/逆操作の実行版、適用主体・順序・制限時間・commit/停止判断者：UNKNOWN。今回は作らず、適用前の別承認へ残す。
- E01〜E11の変更前後・復旧後の実試験、実Auth/RLS/HTTP/並行性：未実施。
- 未知依存、必要許可のクライアント継承、CHECK/index経路の権限不足、第三者変更、結果不明、対象環境不明は停止条件。CASCADE、権限拡張、所有者変更、DEFINER化で回避しない。

参照する仕様は[PG17 GRANT](https://www.postgresql.org/docs/17/sql-grant.html)、[REVOKE](https://www.postgresql.org/docs/17/sql-revoke.html)、既存監査/設計資料。公式仕様と照合した設計であり、実DBでの適用可能性・負荷・ロールバック成功の保証ではない。

本資料とPRのマージはB案の採用・DB操作・公開の承認ではない。A17を混在させず、R02は未解決のまま先生・オーナーレビューを待つ。
