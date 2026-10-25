# ケース11：不正な操作・状態の拒否

## SQL契約の静的調査

review8本体 memo_v1_1_schema_review8.sql:193–226 とパッチ memo_v1_1_conflict_patch_review8.sql:60–93 は同じmemo_change_state本体。
引数はp_id uuid、p_expected_revision bigint、p_request_id uuid、p_action text。戻り値はメモ行。

| 契約 | 本体行 / パッチ行 |
|---|---|
| 認証→ユーザー単位ロック | 199–200 / 66–67 |
| null ID/revision/requestId/action、revision<1または>9007199254740991、未知actionを拒否 | 201–202 / 68–69 |
| ハッシュ作成→同一ユーザーrequestId台帳照合。一致すれば履歴返却、不一致なら22023 | 203–210 / 70–77 |
| 対象FOR UPDATE、存在確認、revision確認 | 212–214 / 79–81 |
| pin/unpin/trashは通常状態のみ、restoreはゴミ箱内のみ | 215–217 / 82–84 |
| 更新→台帳INSERT→返却 | 218–225 / 85–92 |

引数拒否はHTTP400/code22023/message invalid argument。
状態拒否はHTTP400/code22023/message invalid memo state。
古いrevisionはHTTP409/PT409/revision conflictで状態検査より先（ケース10）。
存在しない対象はP0002/memo not found。requestId混用は22023/request id reused with different operation or content。
新規requestIdなら、ピン済みへのpin・未ピンへのunpinは拒否されない。どちらもrevision・updated_at・last_request_idが更新される。
pin再実行ではpinned_atも更新される。これらは状態が同じでも書き込みを伴い、冪等な成功とは扱わない。
同一内容・同一requestIdの履歴返却は別の冪等性分岐（ケース10）。

拒否例外はUPDATEと台帳INSERTより前で、トランザクション内の変更は成立しない設計。
拒否要求が台帳に記録されないことは静的評価であり、公開APIから内部台帳の実データは直接確認できない。
last_request_idを含むメモ全列・タグ・関連はmemo_load_snapshotで比較できる。
本体90–99でmemo_requests/memo_id_registryは内部専用。311–319のsnapshotは自分の通常・ゴミ箱メモを同じmemos配列で返す。
memo_resolve_request（161–190）はsave専用で状態変更照合には使用しない。

## 実際に試す13要求

各要求は独立した新規requestIdを予約する。request-nullだけは送信値を意図的にnullにする。
他の引数は専用メモ・現在revision・有効actionで固定し、拒否理由を混同しない。

| 段階 | 試行 | 期待message（いずれもHTTP400/code22023） |
|---|---|---|
| 通常revision1 | action=null / 空文字 / invalid-test-action | invalid argument |
| 通常revision1 | memoId=null / expected_revision=null / requestId=null | invalid argument |
| 通常revision1 | revision=0 / -1 / 9007199254740992 | invalid argument |
| 通常revision1 | restore | invalid memo state |
| ゴミ箱revision2 | pin / unpin / trash | invalid memo state |

上限超過revisionはbigint範囲内の10進文字列で送り、JavaScriptの精度丸めを避ける。
UUID不正文字列、bigint型変換不能・bigint範囲外、引数省略は関数到達前の型変換／API層エラーであり、
このSQL本体だけでは正確な応答messageを固定できないため今回対象外。
認証・他ユーザー・requestId混用・完全削除履歴・競合の別分岐も今回対象外。

## 実行と操作範囲

Node.js 22以上・対話ターミナル、リポジトリルートから：

```powershell
node tools/memo-db-test/invalid-state-read.mjs
```

共通CLIでdev-sandbox固定Project Ref・Publishable key形式を通信前に検証。非表示パスワードで認証する。
既存runsのUUIDを避けて専用memo/要求IDを生成。wxによる識別記録保存成功後のみ書き込みへ進む。
作成→snapshot→通常状態の拒否10件（各直後にsnapshot）→準備用trash→snapshot→ゴミ箱内の拒否3件（各直後にsnapshot）。
最後に作成要求のみ照合し、履歴上の作成結果と一致を確認。状態変更照合・内部台帳読取は検証対象外と記録する。
未ピン・タグなしの専用メモのみ。全snapshotで対象全列と対象外メモ・タグ・関連の不変を確認する。

最大32 RPC：save1、change_state14（拒否13＋正常trash1）、snapshot16、resolve1。別途認証1回。
確認入力は15回（作成1＋拒否13＋準備trash1）。確認文字列は画面表示の各操作名を大文字にしたもの。
各書き込み前に対象・状態操作全引数・影響範囲を表示。作成本文・タイトルは表示しない。
誤成功は即FAIL、取り消さない。通信失敗・タイムアウト・予期しないHTTP/JSON/状態・キャンセル・記録失敗で停止。
全通信は15秒期限・リダイレクト拒否。自動再送・削除・復旧・ロールバック操作は実装しない。
クライアント中断はサーバー処理終了の保証ではない。

正常時は専用メモ1件がゴミ箱内・revision2・未ピン留めで残る。作成/trash台帳・使用済みIDも残る。
既存コード・SQL・過去PASS対象／記録は変更しない。失敗後は再実行せず、別途読み取り専用確認を行う。

runs/<runId>.invalid-state.jsonを識別記録、各.<操作名>.result.jsonを段階結果、.result.jsonを総合結果、.failure.jsonを失敗記録として新規作成。
すべてwx。段階PASSは総合PASSではない。preparedは未送信の証明ではない。
記録はID・時刻・段階名・判定概要のみ。本文・認証情報・レスポンス全文・任意のサーバーエラー文字列は保存しない。

## ローカル検証

```powershell
node --check tools/memo-db-test/invalid-state-read.mjs
node --check tools/memo-db-test/invalid-state-contract.mjs
node --check tools/memo-db-test/invalid-state-contract.test.mjs
node --test tools/memo-db-test/invalid-state-contract.test.mjs
```

模擬テストはネットワーク禁止。実DBの型変換・返却形式・権限・通信は未検証。実DB実行には別途判断が必要。
