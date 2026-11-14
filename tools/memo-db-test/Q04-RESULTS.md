# Q04 実行記録（サニタイズ済み）

Step 4第6単位のAI Gate：通常cloudメモ1件のゴミ箱移動を既存C04 changeStateへfake製品接続した。操作確認、要求構成、成功/競合/拒否/UNKNOWN、旧応答/二重操作拒否を製品Chromiumで確認。成功は要求単位のみ、snapshot全体を失効させ明示再読取を案内する。UNKNOWNは元要求/C04結果を保持し独自resolve・自動再送なし。実通信/DB操作/cleanupは0。第5単位までの未接続記述は履歴として保持する。Q04全体は進行中、single-rpc未認定。[製品UI契約](../memo/tests/PRODUCT-UI-INTEGRATION.md)を参照。

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

## Step 3：ケース6 メモ作成・並行更新・保存照合 — PASS

オーナーが承認済み既存ケース6を1回実行し、runnerの総合PASSを確認したとの報告。過去の同ケースPASSやケース13を上書きせず、S04変更後の実行結果として追記する。

| 観測 | オーナー報告 |
|---|---|
| 作成 | 新規専用メモ1件 |
| 並行更新A | success / HTTP200 |
| 並行更新B | http / HTTP409 |
| A/B通信期間重複 | 確認 |
| 勝者 | A |
| 最終revision | 2 |
| 全状態・要求照合 | PASS |
| 競合側resolve | null |
| 総合 | PASS |
| retry / cleanup / rollback | なし |
| 残置 | 専用メモ1件、revision=2で保持 |

AIは実結果ファイル・対象メモを読み直していない。実時刻・個別通信数のJSONは未提示のため補完しない（既存正常経路上限はAuth1/RPC8/書込要求3）。総合PASSは既存判定器の所有者・要求ID・日時・最終snapshot不変・勝敗要求照合等の成立を含むが、独立した生結果再検証ではない。

**通信期間重複をDB内部の同時実行/ロック待ちの証明にしない。競合側resolve=null単独を未実行の証明にしない。single-rpcは未認定のまま。** 専用タグと専用メモは削除せず保持し、このケースを再実行しない。

## Step 3のS04差分確認 — 完了

PR #83のレビューPASS・マージ後、オーナーがStep 3の「S04差分確認」を完了として確定した。**S04差分のための追加実試験は不要**。理由と後続Q04条件の切分けは[準備書](Q04-PREPARATION.md)の再評価節を参照。既実施の監査/ケースを再実行しない。

1. S04適用成功報告と内蔵ガードに加え、Q04-READでクライアントの4 helper直接拒否8件を確認。
2. ケース13でタグ作成/改名のhelper/CHECK/index実行とrevision競合を確認。
3. ケース6で未実証だったメモ作成/更新・memo側CHECK/helper経路・競合・保存照合を確認。
4. S04ではRPC本文、CHECK/index式、RLS、表権限、入力/名前比較規則を変更していない。これらの過去PASSを理由なく全件再実行する必要はない。その他RPCを変更後の新実測PASSへ昇格する意味でもない。

これは限定したS04差分の完了であり、**Q04全体のPASS/完了ではない**。製品Auth/session、controller/sender/UI接続、実製品のAuth/所有者/RLS境界、障害/競合/古い応答の受入、応答出所・single-rpc等はStep 4の後続条件として残す。

## 現在の状態と承認境界

- S04：repository準備完了 + dev-sandbox適用成功報告 + helper直接拒否PASS + ケース13/6総合PASS。Step 3のS04差分確認はオーナー確定により完了。
- Q04：**進行中**。S04差分として次の実試験候補は追加しない。実環境操作・cleanupは未承認。Q04全体をPASSへ昇格しない。
- A17/S05保留、過去の監査PASS、Human Gate専用経路の既知課題は変更しない。
- Step 4第1〜第4単位（PR #84〜#87の修正を含む）に続き、第5単位で同じcloud editorによる新規メモ1件の作成/save/明示resolveをfake sender/合成StorageのChromiumで確認した。新規UUIDは既存createId、expectedRevision=nullから開始。成功は要求適用の確認であり現在snapshotへ楽観反映しない。conflict/rejected/UNKNOWN・旧応答の保持、明示resolve/確定結果回収、busy/pending終了契約も共通。[製品UI契約](../memo/tests/PRODUCT-UI-INTEGRATION.md)を参照。通常entryは未注入local-only。実SDK生成・実Storage・実sender・cloud状態変更等の残りwrite・実製品経路は未接続。実環境PASSやsingle-rpcへ昇格しない。追加の旧DB CLI実行を要求しない。
- 今回の記録整理中は、追加SQL・Auth/RPC通信・DB操作・再試行を実施していない。過去記録・準備manifestは上書きしない。生成manifestの`applied:false`は生成時の値として保存し、この実施報告と区別する。
