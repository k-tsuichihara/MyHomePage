# ケース28：完全削除済みメモIDの別requestIdによる再作成拒否

2026-10-25のユーザー承認により新規採用。[採用計画](TEST-PLAN-2026-10-25.md)を参照。ケース29〜30は未定義。実DB接続・実行は別途判断する。

## 契約と期待結果

根拠はtools/memo/doc/v1.1.0/memo_v1_1_schema_review8.sqlとmemo_v1_1_implementation_review8.md。

- SQL59〜62行：memo_id_registryは(user_id,memo_id)を保持。メモ行への削除連鎖はなく、使用済みIDが完全削除後も残る。
- SQL123〜128行：同一requestIdの再送は要求台帳で照合される。ケース27はこの分岐。本ケースは新規requestIdであり、この履歴一致分岐を使わない。
- SQL130〜133行：タグ存在・文字入力を検証。本ケースは残存する専用タグと初回作成と同じ有効な文字列を送り、別の入力エラーをPASSにしない。
- SQL134〜137行：expected_revision=nullの新規作成ではregistryへ登録。競合すると **PT409 / previously used memo id** でメモ作成前に拒否。
- SQL235〜239行：所有者・ゴミ箱状態・revision一致で個別完全削除するがregistryは削除しない。要求台帳は削除済みへ更新。
- 統合仕様34・38行：初回のみ使用済みID登録、完全削除後も最小限記録を保持。72行：used-memo-idはrevision競合とは区別する。
- 6関数パッチのmemo_save（4行以降）とdelete_permanently（96行以降）も同じ条件。

再作成試行の期待値は **HTTP409＋JSON code PT409＋message `previously used memo id`**。[PostgRESTのPT系HTTP契約](https://docs.postgrest.org/en/v14/references/errors.html#raise-errors-with-http-status-codes)に従う。通常保存結果・削除済みreceipt・memo revision conflict・23505・旧40001はFAIL。

## 認証・既存データ保護

CLIは次の固定runの識別記録と最終PASS結果を読み、欠落・不一致なら認証前に停止する。

- ケース26：27027609-0196-4590-8b96-4183a948a23e（empty-trash-conflict）
- ケース27：3f13bccc-a95c-4a7a-b7ea-978286bf5110（deleted-replay）

ケース27が参照するケース26のrunId、両runのuserId、projectHost、各対象ID、PASSと不変フラグを照合する。認証後user.idがこのユーザーと違えばDB RPC前に停止。

初期0件は要求しない。最初の全snapshotでケース26のメモ2件（ゴミ箱・revision=2・各trash requestId一致）・タグ1件・関連2件と、ケース27の残存タグ1件（revision=1）・削除済みメモ/関連の不在を検証。既存全データをメモリ内基準として保持し、各操作後に今回の意図した差分以外がないことを比較する。ケース26/27以外の初期データがあっても同様に保護する。

ケース28は今回発行のmemoIdだけを完全削除する。memo_empty_trashやタグ削除、既存メモへの更新は呼ばない。認証・固定接続・非表示パスワード・UUID発行・比較・通常RPCは既存処理を再利用する。

## 実行手順

Node.js 22以上、追加依存なし。既存.env.localのdev-sandbox URL/Publishable keyを使用する。固定Project Ref検証は認証前と各RPC前に実施。service_role/secretは禁止。本番k-life-logには接続しない。同ユーザーをほかの端末/CLIで並行利用しない。

```powershell
node tools/memo-db-test/deleted-id-read.mjs
```

1. 記録照合・認証後、新規runId/memoId/tagId/作成requestId/trashRequestId/再作成requestIdを発行。過去runs全JSON内UUIDと重複させず、識別記録をwx新規作成。
2. 初期全snapshotとケース26/27の既知状態を検証。
3. **TAG**：専用タグ1件作成、全snapshot比較。
4. **CREATE**：専用メモ・関連を作成。revision=1、所有者、本文/タイトル、作成要求ID、初期ピン/ゴミ箱状態、日時、タグを検証。全snapshot比較。
5. **TRASH**：今回のメモだけをゴミ箱へ移動。revision=2、updated_at増加（マイクロ秒）、deleted_at=updated_at、last_request_idを検証し、ほか全フィールドと全snapshot保持を確認。
6. **DELETE**：最新revision=2で今回のmemoIdだけを個別完全削除。HTTP204・空本文と、全snapshotでメモ/関連不在・専用タグ/既存データ保持を確認。
7. **RECREATE**：同じmemoId・別の新規requestId・expected_revision=nullを表示し個別確認。誤成功時にメモ/関連が復活する危険を明示する。
8. 確認入力後に直前全snapshotを再取得し、削除後期待状態と一致し、今回のメモ/関連が不在であることを確認。比較用snapshotはメモリ内のみで保持。
9. 元作成payloadからrequestIdだけ変更し、タイトル・本文・専用タグは同じ有効値のままでmemo_saveを1回送る。
10. 期待するHTTP/code/messageを厳密照合し、試行後の全snapshotが直前と完全不変、最終が初期全データ＋今回の専用タグ1件だけであることを確認。

書き込み前は操作・対象ID・requestId・expectedRevision・影響範囲を表示し、各大文字入力の完全一致を要求する。requestIdのないタグ作成/完全削除はnullと表示。手動確認は **5回**。

最大 **12 RPC**：snapshot7（初期・タグ後・作成後・trash後・削除後・再作成直前・再作成後）、save_tag1、save2（初回1＋再作成試行1）、change_state1、delete_permanently1。認証1回は別でHTTP総数最大13回。読み取り専用照合RPC・元requestIdの再送は行わない。

## 判定・記録・残存データ

- 既存の順序非依存比較器を利用し、メモ/タグはID、関連はmemo_id+tag_idで対応付ける。全フィールドの有無・型・値、欠落・余分・重複を検査する。
- 15秒タイムアウト、redirect:error。通信/HTTP/本文受信/JSON解析/取得後検証を区別。想定外成功・別エラー・タイムアウト・差異・確認中断・記録失敗は即停止。自動再送・削除・復旧・後片付けなし。
- runs/<runId>.deleted-id.jsonは識別用。進捗/最終結果/失敗は別のwx新規ファイルとし、過去記録は上書きしない。ID・時刻・安全な項目名・合否だけを記録。本文/タイトル/タグ名実値/メール/パスワード/トークン/キー/レスポンス全文は記録しない。
- 正常終了後、初期がケース26/27の2メモ・2タグ・2関連なら、**2メモ（ゴミ箱・各revision=2）・3タグ・2関連**。今回のメモ/関連は不在で、今回のタグだけを追加保持。resultのmemosRetained/tagsRetained等は今回の専用データの件数、baselineCounts/finalCountsはユーザー全取得件数。
- 誤成功すると今回の専用メモ/関連が復活し、内部記録も変わる可能性がある。自動で消さず、識別記録とFAILを保持して読み取り専用で調査する。
- 内部registry/要求台帳を直接確認する権限は使わず、その内容・不変は未検証。API拒否と公開snapshotの保持を確認できた範囲だけを報告する。
- 初期snapshotからの不変を検証するもので、ケース26/27実行当時から今回開始までの全フィールド不変を証明しない。直前取得と要求は別トランザクションのため外部並行更新を止める。

## ローカル検証

```powershell
node --check tools/memo-db-test/deleted-id-read.mjs
node --check tools/memo-db-test/deleted-id-contract.mjs
node --check tools/memo-db-test/deleted-id-contract.test.mjs
node --test tools/memo-db-test/deleted-id-contract.test.mjs tools/memo-db-test/deleted-replay-contract.test.mjs tools/memo-db-test/empty-trash-conflict-contract.test.mjs tools/memo-db-test/delete-conflict-contract.test.mjs tools/memo-db-test/permanent-delete-contract.test.mjs tools/memo-db-test/tag-delete-contract.test.mjs tools/memo-db-test/unauthenticated-contract.test.mjs tools/memo-db-test/isolation-contract.test.mjs
```

全通信を模擬し実ネットワークは禁止。記録連鎖不一致、初期保護データ不一致、新旧requestId区別、正常拒否、誤成功、HTTP/code/message違い、復活、既存本文/revision/状態/タグ/関連の差異、欠落/余分/重複/未知フィールド、順序だけ異なる正常値、通信/受信/解析異常、途中失敗・確認キャンセル・記録失敗・回数上限・自動再送禁止を検証する。
