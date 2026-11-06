# 補助4関数のEXECUTE権限制限設計（R02・未採用）

作成日：2026-11-06。基準main：`349c29213cfe77e100417165abb72382f87248c4`。今回は設計文書のみ。DB接続・SQL実行・権限変更・非公開監査成果物へのアクセスは行っていない。**R02は未解決。B案は第一候補であり、安全性の実測確認とオーナー承認までは採用確定しない。** A17（将来オブジェクトのdefault ACL）の判断とは別課題で、既存の監査履歴を変更しない。

## 1. 根拠と確認範囲

- [Review8 schema SQL](../doc/v1.1.0/memo_v1_1_schema_review8.sql)：補助4関数、CHECK、一意index、8RPCの原本。
- [6関数パッチ](../doc/v1.1.0/memo_v1_1_conflict_patch_review8.sql)：save/state/個別削除/一括削除/save_tag/delete_tagの最終比較元。補助関数や権限を再作成しない。
- [監査手順・結果](DEV-DB-AUDIT.md)、[チェックリストR02/B14](DEV-DB-AUDIT-CHECKLIST.md)。8RPC本文の改行正規化後一致はオーナー報告であり、補助4関数の実DB本文・所有者・全実効権限の検証ではない。
- PostgreSQL 17の[関数定義](https://www.postgresql.org/docs/17/sql-createfunction.html)、[権限](https://www.postgresql.org/docs/17/ddl-priv.html)、[式インデックス](https://www.postgresql.org/docs/17/sql-createindex.html)。SECURITY INVOKERは呼出し側、DEFINERは所有者の権限で動くという仕様と、実DBでの実行主体確認を区別する。所有者は通常権限を自ら取り消せるため、「所有者だから必ずEXECUTE可能」と断定しない。

関数本文・ACL生値・ハッシュ・実データを転載しない。以下は公開された正式原本の静的読取りに限る。

## 2. 正式SQL上の依存関係

| 呼出し元 | 直接の補助関数参照 | 間接・条件付き参照 |
|---|---|---|
| memo_trim_edges(text) | memo_edge_spaces() | なし |
| memo_valid_text(text,text) | memo_trim_edges(text)（title/tag条件） | memo_edge_spaces()。body検証で常に呼ぶとは限らない |
| memo_edge_spaces() / memo_tag_key(text) | 補助関数相互の参照なし | 組込関数を使用 |
| memo_save | memo_valid_text（title/body） | trim/edge。memos DMLに伴うCHECK |
| memo_save_tag | memo_valid_text（tag） | trim/edge。tags DMLに伴うCHECK・一意index式のtag_key |
| memo_change_state | 本文に補助関数の直接参照なし | memos更新に伴うCHECK評価の可能性。実際の評価・権限チェックは対象版で検証 |
| memo_delete_tag | 本文に補助関数の直接参照なし | 関連memosのrevision等更新に伴うCHECK評価の可能性。tags削除/FK処理も回帰確認 |
| memo_delete_permanently / memo_empty_trash | 本文に補助関数の直接参照なし | memos削除/FK処理。正式本文から補助関数呼出しを追加で推定しない |
| memo_load_snapshot / memo_resolve_request | 本文に補助関数の直接参照なし | 通常のSELECTでCHECKを再評価すると仮定しない |
| memos.memo_title_check / memo_body_check | memo_valid_text | title側はtrim/edgeに依存 |
| tags.tag_name_check | memo_valid_text | trim/edgeに依存 |
| tags_name_per_user一意index式 | memo_tag_key | (user_id, ASCII限定キー COLLATE C)の一意性 |

補助4関数は原本でSECURITY INVOKER（DEFINER指定なし）、IMMUTABLE、PARALLEL SAFE、空search_path。8RPCはDEFINER。RPC内部からINVOKER補助関数を呼ぶ場合の必要主体はその時点の有効な実行主体を調べる。補助関数所有者へ一括GRANTすれば全経路を満たすとは限らない。

実DBの追加トリガー/ルール/ビュー/他関数/管理ジョブ/直接DML、テーブル・関数所有者と継承、CHECKやindex作成・保守時の主体はUNKNOWN。過去の非内部トリガー・ルール0件報告を将来や全依存の証明にしない。pg_depend等の登録依存だけでは文字列本文の動的解決を網羅できないため、別承認でカタログと本文/運用経路を突合する。式の計画時・実行時・保守時の権限評価が同一だとも仮定しない。

## 3. 主体別の現在値とB案の期待値

現在値はオーナー監査報告と実効権限を区別する。PUBLICはログイン主体ではなく全ロールへの付与先。PUBLICのEXECUTEが残れば、anon/authenticatedへの直接付与だけを取り消しても実効拒否にはならない。

| 主体 | 現在の補助4関数EXECUTE | B案の期待状態 | 将来の確認方法（別承認） |
|---|---|---|---|
| PUBLIC | 公開EXECUTEありとの既存監査報告。関数別の生ACL詳細はUNKNOWN | 対象4完全署名へのEXECUTE付与なし | NULL ACLのdefault展開を含めACLを確認 |
| anon | PUBLIC由来の利用経路あり。個別直接付与・継承等はUNKNOWN | 直接付与なし、継承/PUBLIC由来を含め実効EXECUTE false、直接実行拒否 | 関数別実効権限＋実anon経路での拒否確認 |
| authenticated | PUBLIC由来の利用経路あり。個別直接付与・継承等はUNKNOWN | 補助直接実行は拒否、8RPCの既存EXECUTEは維持 | 実効権限＋補助直接拒否＋8RPC実行 |
| 8RPC各所有者 | ロール名・補助EXECUTE実効値はUNKNOWN | 必要な補助チェーンを有効主体として実行可能。所有者一致を前提にしない | 全8署名owner/継承/実効権限とRPC試験を突合 |
| 補助4関数各所有者 | ロール名・通常EXECUTE・Grant Optionの実値はUNKNOWN | 所有・再付与権は変更しない。必要実行権限は用途ごとに確認 | 各ownerと明示/実効権限、RPC ownerとの関係 |
| 表所有者・DDL/index保守担当・管理ジョブ等 | 主体・依存・実効値はUNKNOWN | 承認された必要経路のみ動作。クライアントへの直接DML追加なし | CHECK/index/保守の有効主体と権限、専用試験 |

権限不足がRPC所有者の変更や認証ロールへの広い再付与を要求する場合は停止して設計を再レビューする。管理者・superuserでの成功を一般ロールの安全性証明にしない。

## 4. A/B/C案の比較

| 案 | セキュリティ | 既存RPC | CHECK・index | コスト | ロールバック |
|---|---|---|---|---|---|
| A 現状維持 | 不要な直接呼出し面が残る。現時点のデータ漏えいを断定するものではない | 変更影響なし | 変更影響なし | 小。リスク継続 | 変更なし |
| B 必要主体限定 | PUBLIC/anon/authenticatedの直接・継承経路を抑える。RPC自身の認証/所有者検証は別途必要 | DEFINER ownerと依存先権限の不足で失敗し得る | CHECK/index評価・作成/保守の主体を実測して必要権限を確保 | 中。ACL設計と全経路回帰が必要 | 本文/OIDを変えず、事前の正確なACLへ復旧する案。未commitならtransaction取消し |
| C 内部schema分離 | 公開schemaから分離可能だが、schema USAGEとEXECUTEの制御は依然必要 | public修飾の本文参照を点検・修正する必要 | OID依存の追従と文字列参照を区別。CHECK/indexの再定義要否を実DBで判断 | 大。SQL・公開schema設定・移行/依存の別設計 | schema/本文/依存の整合を戻す必要があり複雑 |

Bを第一候補とする。現在の4署名と本文・属性・schema・CHECK/index定義を維持してACLだけで制限できる可能性があり、Cより変更範囲が小さいため。ただしUNKNOWNを解消し、下記試験が成立するまでは採用しない。Cでは既存OIDに結び付いた参照が追従しても、関数本文中のpublic修飾名は自動で書換わるとみなさない。Supabaseの公開schema設定とschema USAGEも要調査で、今回変更しない。A17のdefault privilegesはどの案でも別課題。

## 5. 将来の変更・復旧計画（実行禁止・SQL未作成）

1. 開発専用環境・対象4完全署名・各owner・既存ACL/NULL/default・Grant Option・全継承・実効権限・schema USAGE・呼出し経路を別承認で確認。復旧用の変更前ACLは非公開保管する。未確認が残れば適用しない。
2. 必要主体を経路ごとに確定し、対象4署名への最小EXECUTEを設計する。所有権/DEFINER化/スーパーユーザー化で回避しない。GRANTを必要主体へ確保したうえでPUBLIC・anon・authenticatedの直接付与をREVOKEする方針。継承による残存は別ロールへの広範REVOKEで勝手に解消せず相談する。
3. 正確なGRANT/REVOKEと逆操作案を別PRで静的レビューし、適用・試験・復旧をそれぞれ承認する。default privileges、8RPC ACL、表ACL・RLSは今回の変更対象に含めない。
4. 承認された時間帯に同時DDL/権限変更を避け、対象の直前一致を確認する。ACL変更は可能な範囲で同一transactionにまとめ、同一セッションで可能な事前試験を行う。失敗はcommitせず取消す。別HTTPセッションは未commitのACLを見られないため、全HTTP試験をcommit前に完了できるとは記載しない。
5. commit後、実効権限とHTTP/RPC試験を実施する。想定外の拒否・成功・影響があれば後続書込を停止。承認済み復旧計画に従い、現ACLに第三者変更がないことを確認して変更前の明示付与/Grant Optionを復元する。PUBLICへ単純再付与するだけを復旧完了としない。競合差分があれば自動復旧しない。
6. 復旧後もACL・RPC・CHECK/index動作を再確認する。ACL復旧は試験中のデータ変更の取消しではない。合成データの隔離、試験transactionの取消し、後片付けは別承認・対象固定で行い、自動削除しない。適用失敗、接続断、commit結果不明は再接続等の承認済み読取確認を先に行い、自動再適用しない。

## 6. 検証計画（全件未実施）

変更前後を同じ合成ベクトルで比較する。新規の開発専用合成ユーザーA/Bと固定IDを使い、本番・実ユーザーデータは使わない。実行回数・変更件数・時間上限・秘密を含まない証跡を事前承認する。SQL原本の再適用や管理キー使用を前提にしない。

| ID | 手順・対象 | B案の期待結果/停止条件 |
|---|---|---|
| E01 | 対象4署名の明示ACL・各主体の実効権限を変更前後照合 | 必要内部主体のみ実効許可、anon/authenticatedはfalse。未知owner/継承/余分なoverloadなら停止 |
| E02 | anon/authenticatedから各補助へ正しい引数で直接呼出し | 変更後は全4件拒否。DB EXECUTE不足は42501を確認。HTTPの経路/認証エラーと混同せず、RPC非公開で見つからないだけならEXECUTE拒否の証明にしない |
| E03 | authenticatedから8RPCすべてを合成データで正常呼出し | load/save/state/個別削除/一括削除/resolve/save_tag/delete_tagの正式応答。RPC自体の権限も維持。削除は専用対象・明示確認・別承認 |
| E04 | メモ作成・更新、状態変更、タグ削除による関連メモ更新 | CHECK経路含め内部権限不足なし。revision/台帳/タグ関連/他ユーザー不変を既存契約どおり確認 |
| E05 | タグ作成・改名、同名/ASCII大小同値名、区別する非ASCII名 | 正常名は保存。一意indexで重複は23505、同一ユーザー範囲のtagKey規則を維持。index式の権限失敗なら停止 |
| E06 | タイトル100/101、本文10000/10001、タグ30/31、Unicode空白/制御文字の既存ベクトル | 正常を受理・不正を拒否。入力値をログに残さない。RPCの22023とCHECKの23514を区別 |
| E07 | RPCの先行検証で隠れるCHECKそのものを専用試験で確認 | 承認された内部DML主体の隔離transactionで合法/違反値を試験し取消す。CHECKを直接通る不正値が拒否される。一般クライアントへDMLをGRANTしない |
| E08 | index作成/保守の有効主体と運用経路を確認 | 調査後に承認された隔離再現で必要権限を検証。稼働indexの無断REINDEX/再作成・関数実行による調査は禁止 |
| E09 | 必要内部主体の権限不足を隔離fixtureで模擬 | 42501等を記録し、後続書込停止・全体取消しを確認。既存アダプターを変更せず、未検証経路の書込失敗を確定拒否へ格上げしない |
| E10 | 非対象データ・既存定義/ACL/index有効性の前後確認 | ACL変更だけで本文/データを再書換えしない。実データ走査なし。合成データの不変とカタログ状態を確認 |
| E11 | transaction中の失敗、commit後の検証失敗、変更競合・結果不明 | 第5章どおり停止/承認済み復旧。復旧後のACLと機能を再確認し、データの復元と混同しない |

SQL直呼出しとPostgREST経由は両方を区別して記録する。HTTPの42501→401/403等の分類は認証状態・実版・応答の出所を別検証し、関数権限だけで断定しない。成功/失敗判定は既存の正式RPC/アダプター契約を使い、未知応答・通信断は自動再送しない。

## 7. 採用ゲートと残課題

- UNKNOWNの所有者、実効権限、追加依存、CHECK/index/保守時の主体を安全な要約で確認する。
- B案の正確なACL変更/復旧案を承認し、E01〜E11の結果と未検証範囲を先生・オーナーが判断する。直接拒否と内部経路正常の両方が必要。
- 権限制限を採用する場合は正式契約への反映を別承認する。今回は原本を変更しない。
- 実行経路が安全に限定できない、必要ロールへの許可がクライアントへ継承される、CHECK/indexが維持できない場合はB案を強行しない。
- R02は設計提出後も未解決。A17、戻り値型OID、実RLS/Auth/HTTP/並行性等の継続課題を解消済みにしない。

今回の文書検証はリンク・依存表と正式SQLの対応・差分・変更範囲のみ。DB試験、SQL実行、権限変更、実データ/非公開CSV・抽出SQL・本文へのアクセスは未実施。テスト成功や本設計のマージを将来の適用・公開承認として扱わない。
