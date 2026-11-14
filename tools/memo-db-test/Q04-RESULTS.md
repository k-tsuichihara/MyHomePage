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

## 現在の状態と承認境界

- S04：repository準備完了 + dev-sandbox適用成功報告あり + helper直接拒否確認PASS。正式8 RPC正常性の実証は継続課題。
- Q04：**進行中**。Step 1/2のみ完了。Step 3以降の実行は未承認。
- A17/S05保留、過去の監査PASS、Human Gate専用経路の既知課題は変更しない。
- 次の推奨単位は[Q04準備書 Step 3の次回承認候補](Q04-PREPARATION.md#step-3の次回承認候補未承認)。新規専用タグ1件でhelper4件の通常経路を確認する既存ケース13を先行候補とする。
- 今回の記録整理中は、追加SQL・Auth/RPC通信・DB操作・再試行を実施していない。過去記録・準備manifestは上書きしない。生成manifestの`applied:false`は生成時の値として保存し、この実施報告と区別する。
