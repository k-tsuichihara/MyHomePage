# ケース17：タグ使用件数

## 仕様・SQL調査

review8統合仕様書10行：使用件数は通常メモのみ。ゴミ箱メモは除外し、関連は維持。移動で件数が減り復元で増える。未使用タグも保持。
SQL本体memo_load_snapshot（311–319）はmemos/tags/memoTagsだけを返し、件数プロパティや集計専用RPCは存在しない。
通常/ゴミ箱メモは同じmemos配列に入り、deleted_atで区別する。
memo_change_state（193–226）はtrashでdeleted_at=now()、restoreでnull、両方でrevision+1/updated_at/last_request_id更新。
ピン・本文・作成日時・タグ関連は維持。タグ使用件数そのものはDBに保存されない。

本ケースはsnapshotの実データから、deleted_at=nullのメモだけを関連経由で数える**テスト用ローカル集計**を検証する。
アプリ本体の集計コードやサーバー集計値との比較ではない。参照不正・関連重複・所有者不一致・deleted_at欠落は停止する。
全snapshotを期待状態と比較し、対象外メモ・タグ・関連とタグマスターが不変であることを要求する。
状態変更の読み取り専用要求照合は現行SQLにないため実施しない。ケース15/16の対象は使用しない。

## シナリオ

使用タグA、未使用タグUの専用2タグと、Aを持つ新規通常メモ2件を使う。

| 段階 | Aの期待件数 | Uの期待件数 |
|---|---:|---:|
| タグだけ作成 | 0 | 0 |
| メモ1作成 | 1 | 0 |
| メモ2作成 | 2 | 0 |
| メモ2をゴミ箱へ移動 | 1 | 0 |
| メモ2を復元 | 2 | 0 |

ゴミ箱内でも関連2件は残る。復元後のメモ2はrevision3、メモ1はrevision1。
各応答のID・所有者・本文・名前・日時・revision・状態・requestIdを検証し、直後のsnapshotと完全一致を要求する。
件数の期待値は集計関数から生成せず上表の固定値と比較する。

## 実行・安全性

Node.js22以上・対話ターミナルでリポジトリルートから：

```powershell
node tools/memo-db-test/tag-usage-read.mjs
```

共通CLIで固定dev-sandbox Project Ref・Publishable key形式を通信前に検証し、パスワードは非表示入力。
既存runs記録のUUIDを避けて専用IDを生成し、識別記録をwxで保存した後だけ書き込みへ進む。
タグ名はT17A-/T17U-とrun UUID先頭24桁hexの29文字。開始snapshotでID/ASCIIキー衝突を拒否する。
TAG-USED/TAG-UNUSED/MEMO-1/MEMO-2/TRASH/RESTOREの6回、各書き込み前に対象と影響を表示して個別確認する。

最大13 RPC：memo_save_tag2・memo_save2・memo_change_state2・memo_load_snapshot7。別途認証1回。
正常終了時は通常メモ2件、タグ2件、関連2件が残る。未使用タグUは0件のまま削除しない。
失敗途中では作成済みの専用データやゴミ箱内メモが残り得る。自動再送・削除・復旧・ロールバック操作なし。
通信失敗・タイムアウト・HTTP/JSON/状態不一致・確認キャンセル・記録失敗で停止し、総合PASSにしない。
各通信15秒期限・リダイレクト拒否。中断はサーバー処理終了の保証ではない。
失敗後は再実行せず識別IDで読み取り専用確認。同一ユーザーの他操作を並行しない。

記録はruns/<runId>.tag-usage.json、各操作.result.json、総合.result.json、失敗.failure.jsonをすべてwxで新規作成。
requestIds[0/1]は各メモ作成、[2/3]はメモ2のtrash/restore。tagIds[0/1]はA/U。
本文・タイトル・タグ名実値・認証情報・応答全文は記録しない。段階PASSは総合PASSとは区別し、preparedは未送信の証明ではない。
既存コード・SQL・過去PASS対象/記録は変更しない。

```powershell
node --check tools/memo-db-test/tag-usage-read.mjs
node --check tools/memo-db-test/tag-usage-contract.mjs
node --check tools/memo-db-test/tag-usage-contract.test.mjs
node --test tools/memo-db-test/tag-usage-contract.test.mjs
```

実ネットワーク禁止のローカル検証のみ。稼働DBの定義・権限・実通信、アプリ本体の表示件数は未検証。実DB実行は別途判断後。

## エラー診断の改善

新規runではスナップショット失敗をfetch通信・HTTP応答・応答本文受信・JSON解析に分類する。
取得後は全体比較・集計入力検証・件数照合を区別し、memo-1などの操作名と固定の項目名を表示する。
例：memo-1: 取得後検証 / 項目=snapshot.memos.body。本文の実値は表示しない。
HTTPステータスと許可リストに含まれる例外名/cause.codeのみを診断に使用し、URL・任意のエラー本文・スタックは出力しない。
新しいfailure記録には安全なdiagnostic概要を追加する。旧runや過去結果は更新しない。
最初に見つかった差分を報告するため、表示項目だけが唯一の差分とは限らない。
未知の追加列や重複も従来の全体完全一致でFAILとなる。成功条件・RPC回数・確認回数は変更しない。
今回の変更は元runの直接原因を特定したものではなく、元runはFAILのまま保持する。

```powershell
node --check tools/memo-db-test/tag-usage-diagnostics.mjs
node --check tools/memo-db-test/tag-usage-diagnostics.test.mjs
node --test tools/memo-db-test/tag-usage-contract.test.mjs tools/memo-db-test/tag-usage-diagnostics.test.mjs
```
