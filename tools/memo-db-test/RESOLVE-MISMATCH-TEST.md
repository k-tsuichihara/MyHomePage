# ケース29：要求照合時の内容不一致拒否

2026-10-25に新規採用。[採用計画](TEST-PLAN-2026-10-25.md)参照。ケース30は新Authユーザーでの正常一括削除として実装待ちであり、今回は未着手。実DB接続・実行は行わない。

## SQL・HTTP契約

対象：tools/memo/doc/v1.1.0/memo_v1_1_schema_review8.sql。

- 161〜164行：memo_resolve_request(p_id uuid,p_request_id uuid,p_title text,p_body text,p_tag_ids uuid[],p_expected_revision bigint) RETURNS jsonb。JSONの引数名で渡す。
- 168〜175行：認証・null・配列・revision範囲を検証。本ケースはすべて有効な引数を使う。
- 176〜181行：本文を含むpayloadから、保存時と同じユーザー/requestId/save/対象を結び付けたハッシュを再計算。
- 182〜185行：ユーザー/requestIdが一致する台帳を検索し、対象・操作・ハッシュが異なれば **22023 / request mismatch**。
- 186〜189行：一致時は削除済みreceiptまたは{status:'saved',result:保存結果}。
- 関数本体と呼び出すdigest/convert_to/JSON処理はデータ更新を行わない。SECURITY DEFINERであることやHTTP POSTであることを、書き込み実行と混同しない。実行時の内部状態は直接未検証。

期待HTTPは **400**。[PostgREST 14公式エラー変換](https://docs.postgrest.org/en/v14/references/errors.html#http-status-codes)では22023は個別分類に該当せずother→400。2026-10-25に公開資料を確認した根拠であり、今回の稼働DB応答を観測した値ではない。HTTP400・JSON code 22023・message `request mismatch`の3条件を厳密要求する。HTTP400でもinvalid argumentなど別メッセージはFAIL。

統合仕様memo_v1_1_implementation_review8.md 36行の凍結送信内容を用いた読み取り専用照合に対応。ケース4のmemo_saveでのrequestId混用拒否とは別RPCの検証。

## 準備・既存データ保護

固定された次の識別記録と最終PASSを認証前に照合する。

- ケース26：27027609-0196-4590-8b96-4183a948a23e（empty-trash-conflict）
- ケース27：3f13bccc-a95c-4a7a-b7ea-978286bf5110（deleted-replay）
- ケース28：4f502bf4-1184-4e2a-b6f5-d41bf9934109（deleted-id）

参照runId・ユーザーID・対象ID・projectHost・PASS・既存データ不変フラグを照合し、認証ユーザーIDが一致しなければDB RPC前に停止。欠落・破損・不一致を推測で補わない。

初期0件は要求しない。初期snapshotからケース26のゴミ箱メモ2件/関連2件/タグ1件、ケース27・28の残存タグ各1件と、それらの削除済みメモ/関連の不在を確認する。初期全データをメモリ内に保持し、各操作後は今回の差分以外を全フィールド比較する。履歴実行当時から今回開始までの全フィールド不変の証明ではない。

Node.js 22以上、追加依存なし。既存.env.localのdev-sandbox URLとPublishable keyのみ使用し、認証前と各RPC前に固定Project Refと照合する。service_role/secret・本番k-life-logは禁止。メール/非表示パスワードは対話入力、トークンはメモリ内。ユーザー自動作成/削除・logout/refresh/admin APIなし。Authセッション・認証ログは残り得る。同ユーザーを他端末/CLIで並行使用しない。

## 実行

```powershell
node tools/memo-db-test/resolve-mismatch-read.mjs
```

1. 記録・認証照合後、新規runId/memoId/tagId/requestIdを発行。過去runs全JSON内UUIDと重複しないことを確認し、識別記録をwxで新規保存する。
2. 初期全snapshotと保護対象を検証。
3. **TAG**確認：専用タグ1件作成。全snapshot照合。
4. **CREATE**確認：専用メモ1件と関連1件作成。所有者、本文/タイトル、revision=1、last_request_id、created_at=updated_at、ピン/ゴミ箱null、タグ一致を確認。全snapshot照合。
5. 元の保存要求を一度確定したJSON文字列でメモリ保持。正しい全引数でmemo_resolve_requestを呼び、{status:'saved',result:初回保存結果}と厳密一致を確認。
6. 不一致照合直前の全snapshotを再取得し期待状態と比較、メモリ内で保持。
7. 本文だけに固定文字列 ` / mismatch` を追記した照合引数を構成。requestId・memoId・タイトル・タグ・expected_revision=nullは変更しないことをコードで検証する。元payloadの書き換えはしない。
8. memo_resolve_requestを1回呼び、HTTP400/22023/request mismatchを厳密確認。これは読み取り専用試行であり保存要求の再送ではない。
9. 全snapshotを取得して直前からの完全不変を検証。
10. 元の引数で再度memo_resolve_requestを呼び、初回保存結果と日時・revision・内容・タグまで完全一致することを確認。
11. 最終全snapshotも期待状態と一致し、専用メモ/タグ/関連と全既存データが保持されていることを検証。

手動確認は書き込みの **2回**。対象ID・requestId・expectedRevision・影響範囲を表示しTAG/CREATEの大文字完全一致を要求。読取専用の照合には書き込み確認を追加しない。

最大 **11 RPC**：snapshot6（初期・タグ後・作成後・不一致直前・不一致後・最終）＋save_tag1＋memo_save1＋memo_resolve_request3（正常前後2＋不一致1）。認証1回は別でHTTP総数最大12回。

## 安全対策・結果・限界

- CLIの通常経路はsnapshot/save_tag/resolveのみを許可。初回memo_saveは既存の専用送信関数を使い1回だけ実行。不一致試行の送信先はmemo_resolve_requestに固定し、保存・状態変更・削除RPCは呼ばない。
- 全リクエスト15秒タイムアウト、redirect:error。通信/HTTP/本文受信/JSON解析/取得後検証を区別。想定外成功・別エラー・タイムアウト・差異・確認キャンセル・記録失敗は即停止。自動再送・削除・復旧なし。
- 比較はケース18の順序非依存・全フィールド比較器を再利用。メモ/タグはID、関連はmemo_id+tag_idで対応付け、欠落・余分・重複・フィールドの有無・値・型を検査する。
- runs/<runId>.resolve-mismatch.jsonと進捗/最終結果/失敗はそれぞれwx新規作成。過去記録を上書きしない。ID・時刻・安全な項目名・合否以外の本文/タイトル/タグ名実値/全payload/認証情報/トークン/キー/レスポンス全文は保存しない。
- 正常時、既存がメモ2・タグ3・関連2件なら最終は **メモ3・タグ4・関連3件**。既存メモ2件はゴミ箱のまま、専用メモ1件は通常状態revision=1。今回の専用データ各1件を保持し、後片付けしない。
- 内部要求台帳の行/ハッシュそのものの不変は直接未検証。公開APIで確認する範囲は、拒否応答・全snapshot不変・元要求に対応する保存結果の前後一致。
- HTTP期待値は公開PostgREST契約に基づく。稼働DBで異なる応答ならFAILとして停止し、条件を自動で緩めない。

## ローカル検証

```powershell
node --check tools/memo-db-test/resolve-mismatch-read.mjs
node --check tools/memo-db-test/resolve-mismatch-contract.mjs
node --check tools/memo-db-test/resolve-mismatch-contract.test.mjs
node --test tools/memo-db-test/resolve-mismatch-contract.test.mjs tools/memo-db-test/deleted-id-contract.test.mjs tools/memo-db-test/deleted-replay-contract.test.mjs tools/memo-db-test/empty-trash-conflict-contract.test.mjs tools/memo-db-test/delete-conflict-contract.test.mjs tools/memo-db-test/permanent-delete-contract.test.mjs tools/memo-db-test/tag-delete-contract.test.mjs tools/memo-db-test/unauthenticated-contract.test.mjs tools/memo-db-test/isolation-contract.test.mjs
```

実ネットワークは禁止。正しい照合の前後一致、本文だけ変更、拒否、通常成功/別HTTP/別code/別message、null/変化した元保存結果、snapshot差異・欠落・重複・余分・未知フィールドの有無・順序だけ異なる正常値、通信/本文/JSON異常、各段階失敗・確認中断・記録失敗・回数上限・自動再送なしを模擬確認する。実DB確認ではない。
