# ケース15：メモ本文とタグの一括更新

## 契約と範囲

review8本体memo_v1_1_schema_review8.sqlのmemo_save（104–157）と差分パッチの対応定義を使用する。
引数はp_id/p_title/p_body/p_tag_ids/p_expected_revision/p_request_id。戻り値は{memo,tagIds}。
131–133行で所有するタグの存在と文字入力を検証し、141–147行でrevision一致・ゴミ箱外の場合だけ本文を更新する。
149–151行でタグ関連を全置換、154–155行で要求台帳を記録し、同じトランザクションで結果を返す。
仕様書クラウドRPC契約も同じ。SQL・本体の変更は不要。

正常系として本文変更・revision増加・タグA解除とB追加の最終的な一貫性を確認する。
故障時の原子性、無効タグで失敗した場合の本文/関連維持はケース16で別途扱う。本ケースのPASSでロールバック検証済みとは扱わない。
稼働DB構成は未接続のため未確認。SQL資料と公開RPC契約を調査した設計上の実装である。

## 実行

Node.js22以上・対話ターミナルでリポジトリルートから：

```powershell
node tools/memo-db-test/memo-tags-read.mjs
```

共通CLIでdev-sandbox固定Project RefとPublishable key形式を通信前に検証。非表示パスワードで認証する。
既存runs内のUUIDを避けてrun/memo/作成要求/更新要求/タグA/Bを新規発行。
prepared識別記録をwxで保存してからだけ書き込みへ進む。
タグ名はT15A-/T15B-とrun UUID先頭24桁hexの29文字。作成前にID/ASCIIキーが既存タグと衝突しないことを確認する。

1. 全snapshot取得。
2. TAG-A確認→専用タグA作成→応答・snapshot比較。
3. TAG-B確認→専用タグB作成→応答・snapshot比較。
4. CREATE確認→専用メモをタグA付きで作成→revision1・本文・作成日時・requestId・A関連を応答とsnapshotで確認。
5. UPDATE確認→新規requestId・expected_revision1で本文を変更しタグ集合を[B]へ置換。
6. revision2・本文更新・更新日時増加（マイクロ秒精度）・作成日時/タイトル/ピン/ゴミ箱状態保持・last_request_idを確認。
7. snapshot全体でA関連がなくB関連のみ存在し、タグマスター/対象外メモ/タグ/関連が不変であることを確認。
8. 作成・更新の凍結要求それぞれをmemo_resolve_requestで照合し、各履歴結果と完全一致を要求する。

最大11 RPC：memo_save_tag2、memo_save2、memo_load_snapshot5、memo_resolve_request2。確認入力4回、別途認証1回。
正常時は通常状態の専用メモ1件（revision2・タグB関連1件）とタグA/B各1件を残す。タグAは未使用でも削除しない。
メモ使用済みID・保存要求台帳もDBに残る。

通信失敗・タイムアウト・不正HTTP/JSON・状態不一致・確認キャンセル・記録失敗で停止。
自動再送・削除・復旧なし。各通信15秒期限、リダイレクト拒否。途中失敗でも自動修復しない。
既存PASS対象・本体・SQL・過去記録は変更しない。ケース16の実装・実行は行わない。
同一ユーザーで他操作を並行しない。失敗時は再実行せず識別IDで読み取り専用確認する。

記録はruns/<runId>.memo-tags.json、各.tag-a/.tag-b/.create/.update.result.json、総合.result.json、失敗.failure.json。
すべてwxで新規作成。本文・タイトル・タグ名実値・認証情報・応答全文は記録しない。
段階PASSは総合PASSではない。preparedは未送信の証明ではない。識別記録には後続調査用IDだけを保持する。

## ローカル検証

```powershell
node --check tools/memo-db-test/memo-tags-read.mjs
node --check tools/memo-db-test/memo-tags-contract.mjs
node --check tools/memo-db-test/memo-tags-contract.test.mjs
node --test tools/memo-db-test/memo-tags-contract.test.mjs
```

実ネットワークは禁止した模擬検証のみ。実DBでの実行・SQL/RPC呼出しはレビュー後に別途判断する。
