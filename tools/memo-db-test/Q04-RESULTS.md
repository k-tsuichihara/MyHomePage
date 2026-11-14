# Q04 実行記録（サニタイズ済み）

記録日：2026-11-14（Asia/Tokyo）。情報源はオーナーの実施報告と、提示されたrunner最終JSON。AIによる再接続・実行・非公開runsの独立照合ではない。実行時刻・実run識別子はここでは記載しない。

## Step 1：S04適用 — 成功（オーナー報告）

- 対象：既に確認済みのdev-sandbox。
- 対象SQL：承認済み新規runの生成済み `s04-apply.sql` 全文。PR #79のS04原文をPR #80の生成器で15s/3sのtransactionへ包んだもの。
- 実行：オーナーがSQL Editorで1回実行し、`Success. No rows returned` を確認したとの報告。
- 判定：この報告に基づきS04適用成功。AIによる追加SQL・再適用なし。
- 限界：SQL内の既定ガードが成功したことと、8 RPCの実機能・CHECK/index・RLS全体の実証を区別する。完全ACL復元可能性を証明したものではない。

## Step 2：Q04-READ — PASS（限定範囲）

オーナーが個別承認後、承認済み手順で1回実行したと報告。最終JSONを改変せず記録する。

```json
{"schema":"memo-q04-read-v1","scope":"db-cli-read-only","state":"passed","reason":"read-checks-only","stage":"snapshot","target":"memo_load_snapshot","authCalls":1,"rpcCalls":9,"writeRpcCalls":0,"verifiedDenials":8,"retryCount":0,"httpStatus":200,"responseCode":"other","singleRpc":"unverified"}
```

| 観測 | 評価できる範囲 |
|---|---|
| authCalls=1 | DB CLIのpassword Auth 1回。製品SDKのsession復元/refresh成功とは別 |
| rpcCalls=9 / verifiedDenials=8 | runnerの固定順序に従い4 helper × anon/authenticatedの8拒否確認を完了し、最後にsnapshotへ到達 |
| helper拒否の意味 | 既存runnerはanon HTTP401 / authenticated HTTP403、SQLSTATE42501、対象関数の権限拒否文一致を要求する。汎用unauthenticated/404を拒否PASSへ置き換えていない |
| stage=snapshot / HTTP200 / passed | snapshotを受信し、既存比較器による形式・重複検査と、返却rowがある場合のAuth owner照合を通過 |
| responseCode=other | 最後のsnapshot応答に42501/PGRST202がない場合の固定分類。これ自体は異常ではなく、8拒否結果を上書きしない |
| writeRpcCalls=0 / retryCount=0 | このrunnerの送信境界で書込0・retry0。provider/中継での実行回数までの独立証明ではない |
| singleRpc=unverified | 未認定を維持。Q04成功による自動昇格なし |

今回のJSONにはsnapshot件数・各rowは含まれない。空/非空や内容を推測しない。RLSのA/B所有者分離、直接表DML拒否、残り7 RPCの動作、CHECK/index実書込、障害/競合、製品Auth/session/Storage/ブラウザ経路の検証はこのPASSに含めない。

## Step 3：ケース13 タグ作成・改名・revision競合 — PASS

オーナーが承認済み試験を1回実行し、既存runnerの総合PASSを確認したとの報告。過去のケース13 PASSとは別の、S04変更後の実行結果として追記する。

| 段階 | 報告結果 |
|---|---|
| CREATE | PASS、revision=1 |
| RENAME | PASS、revision=2 |
| CONFLICT | PASS、revision=2維持 |
| 総合 | PASS |
| 残置データ | 新規専用タグ1件、revision=2で保持。削除・cleanupは行わない |
| 今回の対象外 | 名前重複・関連付きメモへの影響 |

情報源はオーナー報告であり、AIは実結果ファイル・対象タグを読み直していない。実時刻や個別通信数のJSONは未提示のため補完しない（既存runnerの正常経路上限はAuth1/RPC7/書込RPC3）。既存判定器の総合PASSは作成/改名の所有者・日時・revision等、各snapshotの対象外不変、期待競合HTTP409/PT409/固定文一致と不変を要求する。

これによりタグRPCの正常書込時に必要なhelper/CHECK/indexの権限経路が成立した範囲を確認できる。名前重複規則や非ASCII比較、他RPC、RLS分離、製品経路、single-rpcを今回のPASSへ含めない。同じケースを再実行しない。

## 現在の状態と承認境界

- S04：repository準備完了 + dev-sandbox適用成功報告 + helper直接拒否PASS + タグ作成/改名/競合PASS。メモ側の変更後書込は未実証。
- Q04：**進行中**。Step 1/2およびStep 3のケース13のみ完了。残りケース・cleanupは未承認。Q04全体をPASSへ昇格しない。
- A17/S05保留、過去の監査PASS、Human Gate専用経路の既知課題は変更しない。
- 次の推奨単位は[Q04準備書の残ケース差分選定](Q04-PREPARATION.md)：既存ケース6のメモ作成/並行更新/照合を1回、新規専用メモ1件だけで行う候補。未承認・未実行。
- 今回の記録整理中は、追加SQL・Auth/RPC通信・DB操作・再試行を実施していない。過去記録・準備manifestは上書きしない。生成manifestの`applied:false`は生成時の値として保存し、この実施報告と区別する。
