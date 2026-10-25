# ケース26：一括完全削除のrevision競合時の全件保持

2026-10-25のユーザー承認による新規定義。[採用計画](TEST-PLAN-2026-10-25.md)を参照。実DB接続・実行は未実施。

## 根拠と期待結果

`tools/memo/doc/v1.1.0/memo_v1_1_schema_review8.sql`：

- 244〜245行：memo_empty_trash(p_ids uuid[],p_revisions bigint[]) RETURNS integer。
- 248〜256行：認証、配列次元/件数/null/revision範囲の検証。
- 249・257行：ユーザー単位のトランザクションロック。
- 258〜261行：自分のゴミ箱全件数と要求件数/重複数の検査。不一致はPT409 / trash snapshot conflict。本ケースではこのエラーを受け入れない。
- 262〜266行：IDごとの所有者・ゴミ箱状態・revisionを検査。1件でも不一致なら **PT409 / trash revision conflict**。
- 267〜269行：全件検査後に要求台帳を削除済みにし、**そのユーザーのゴミ箱全件**を削除する。任意の部分集合を削除するRPCではない。
- 337行：authenticatedへEXECUTE付与。管理キーは不要。

6関数パッチ `memo_v1_1_conflict_patch_review8.sql` 111〜138行も同じ処理。統合仕様 `memo_v1_1_implementation_review8.md` 41行の全ID/revision一致時のみ原子的削除、76〜77行のエラー分類を根拠とする。

期待応答はHTTP409・JSON code PT409・message `trash revision conflict`の3条件。[PostgRESTのPT系SQLSTATE契約](https://docs.postgrest.org/en/v14/references/errors.html#raise-errors-with-http-status-codes)に従う。単なる409、旧40001、trash snapshot conflict、HTTP200の削除件数応答はPASS不可。

## 専用ユーザーの準備・取り違え防止

1. dev-sandbox DashboardのAuthentication → Usersで、今回作成したケース26専用ユーザーのUUIDとメールを確認する。既存A/Bや過去テスト用アカウントは使わない。Project Refが既存CLIの固定値と一致することも確認する。本番k-life-logは開かない。
2. Email/Passwordでログイン可能なユーザーを手動準備する。CLIは作成・削除・権限変更・メール確認処理を行わない。
3. CLIへDashboardの専用ユーザーUUIDを入力する。過去runsの全JSON内UUIDに一致すれば認証前に停止。認証後も返却user.idとの一致を必須とする。
4. UUID履歴の照合は保守的に全UUIDを対象とする。過去runで使用したユーザーは、データが空でも使用できない。記録の削除・変更で回避しない。
5. 履歴に存在しないことだけではAuthユーザーが新規作成された事実を証明できない。Dashboardでの専用性確認はユーザーの事前責任範囲。Authユーザー一覧・作成日時は管理APIで取得しない。
6. 認証成功後の最初のmemo_load_snapshotで、メモ・タグ・関連がすべて0件でなければ、確認入力も書き込みRPCも実行せず停止する。空にするための削除/復元は一切しない。

## 実行と確認入力

Node.js 22以上、追加パッケージ不要。同じdev-sandbox .env.localを使用する。キーはPublishable形式のみ、接続先を認証前と各RPC送信前に固定ホストと照合する。パスワードは非表示入力、トークンはメモリ内のみ。ログアウト/refresh/admin APIなし。認証セッション/認証ログは残り得る。

```powershell
node tools/memo-db-test/empty-trash-conflict-read.mjs
```

専用ユーザーID、メール、非表示パスワードを入力する。認証結果のユーザー照合後、今回の新規識別記録をwxで作成する。runId・tagId・memoId2件・作成requestId2件・trash requestId2件は過去記録のUUIDと重複しない。

1. 初期snapshotの完全空状態・所有者・形状を検証。
2. **TAG**：専用タグ1件作成、snapshot照合。
3. **CREATE-0 / CREATE-1**：それぞれ専用メモを作成し同じタグに関連付ける。revision=1、last_request_id、日時、初期状態、関連を確認し、毎回snapshot照合。
4. **TRASH-0 / TRASH-1**：各メモをゴミ箱へ移動。revision=2、updated_at増加（マイクロ秒）、deleted_at=updated_at、last_request_id更新、本文等保持を確認し、毎回snapshot照合。
5. **EMPTY-CONFLICT**：p_ids=[A,B]、p_revisions=[2,1]で一括削除を1回試すことを確認。誤成功すると専用ユーザーのゴミ箱全件が消える危険を明示する。
6. 確認入力の**後**に直前snapshotを再取得。期待する全データとの厳密一致に加え、全メモ2件・タグ1件・関連2件、ゴミ箱の全ID集合=[A,B]、各所有者・revision=2・trash要求IDを確認。不一致なら一括RPCを送らない。
7. 直前snapshotはメモリ内だけで凍結保持。追加の確認入力・ファイルI/Oを挟まず、一括RPCを1回送る。
8. 期待する3条件を厳密照合し、拒否後snapshotとの全フィールド不変を確認。メモ2件がどちらもゴミ箱内revision=2、タグ1件・関連2件の保持を再確認する。

各書き込み前に操作・対象ID・期待revision・影響範囲を表示し、対応する大文字の完全一致入力を要求する。書き込み確認は **6回**。認証情報入力は別。

最大 **14 RPC**：snapshot8（初期、準備5操作後、直前、拒否後）＋save_tag1＋save2＋change_state2＋empty_trash1。認証1回は別でHTTP総数最大15回。

## 安全条件・結果・限界

- 通常通信はsnapshot/save_tag/save/change_stateだけを許可。一括要求は専用通信判定からのみ送信し、2つの異なるUUIDとp_revisions=[2,1]以外は送信前に拒否する。
- 15秒タイムアウト、redirect:error。通信/HTTP/本文受信/JSON解析/取得後検証を区別。誤成功/想定外応答/差異/確認キャンセル/記録失敗は即停止する。自動再送・復旧・後片付け・正しいrevisionでの再削除は禁止。
- 順序非依存比較はケース18の共通比較器を再利用。メモ/タグはID、関連はmemo_id+tag_idで対応付け、全フィールドの有無・値・型、欠落・余分・重複を検査する。
- runs/<runId>.empty-trash-conflict.jsonと進捗/結果/失敗を別々のwx新規ファイルに保存。過去記録は変更しない。ID・時刻・安全な分類・合否だけを記録し、本文/タイトル/タグ名実値/メール/パスワード/トークン/キー/レスポンス全文を保存しない。
- 正常終了時は専用タグ1件、ゴミ箱メモ2件（各revision=2）、関連2件を保持。作成/trashの台帳・使用済みID記録も残る設計。
- 内部台帳の不変は公開snapshotだけでは直接証明できず、未検証と記録する。本ケースは削除前の検証拒否による全件保持であり、削除途中の障害注入ロールバック実証ではない。
- 直前取得と一括RPCは別トランザクション。専用ユーザーを他端末・他CLIで並行利用しない。直前取得後の外部操作を完全に排除した証明はできない。
- 初期読取失敗でも識別記録が作られていればそのユーザーは履歴照合で再利用を拒否する。失敗後は元runを残し、読み取り専用調査と次の判断を先に行う。記録を消して再実行しない。
- 誤成功時はそのユーザーの全ゴミ箱メモ・関連が削除され、台帳resultも消去される可能性がある。専用タグ本体はこのRPCの削除対象ではない。自動復旧しない。

## ローカル検証

```powershell
node --check tools/memo-db-test/empty-trash-conflict-read.mjs
node --check tools/memo-db-test/empty-trash-conflict-contract.mjs
node --check tools/memo-db-test/empty-trash-conflict-contract.test.mjs
node --test tools/memo-db-test/empty-trash-conflict-contract.test.mjs tools/memo-db-test/delete-conflict-contract.test.mjs tools/memo-db-test/permanent-delete-contract.test.mjs tools/memo-db-test/tag-delete-contract.test.mjs tools/memo-db-test/unauthenticated-contract.test.mjs tools/memo-db-test/isolation-contract.test.mjs
```

通信はすべて模擬しネットワークは禁止。初期非空3種、ユーザー不一致/過去ユーザー、直前の余分なメモ/復元/revision/所有者/関連変更、誤成功、エラー契約違い、通信/受信/解析失敗、拒否後の欠落/余分/重複/値変更/フィールド追加欠落、各段階失敗・確認キャンセル・記録失敗、回数上限・再送なしを検証する。実DBの認証・空状態・権限・動作は未検証。
