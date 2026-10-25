# ケース25：完全削除のrevision競合拒否

2026-10-25のユーザー承認で新規定義したケース。[採用計画](TEST-PLAN-2026-10-25.md)を参照。ケース26〜30は未定義。本手順の実装・模擬確認は実DBの動作確認ではない。

## SQL・仕様の根拠

対象SQLは `tools/memo/doc/v1.1.0/memo_v1_1_schema_review8.sql`。

| 契約 | 根拠 |
|---|---|
| 新規タグ | 275〜292行：memo_save_tag、expected_revision=null、所有者=auth.uid()、revision=1 |
| 関連付き新規メモ | 102〜157行：memo_save、expected_revision=null、新規requestId、専用tagId。応答{memo,tagIds}、revision=1、last_request_id=作成要求、deleted_at/pinned_at=null、created_at=updated_at |
| ゴミ箱へ移動 | 192〜225行：memo_change_stateのaction=trash、expected_revision=1、新規requestId。revision=2、deleted_at=updated_at、updated_at増加、last_request_id=trash要求。ほかの全フィールドとタグ関連は保持 |
| 全取得データ | 310〜320行：memo_load_snapshotは所有者の通常/ゴミ箱内メモ・タグ・関連を返す |
| 古いrevisionで完全削除 | 228〜240行：memo_delete_permanently(p_id uuid,p_expected_revision bigint)。235〜236行で所有者・ゴミ箱状態・revision一致を要求。237行の未検出例外はPT409 / not found or revision conflict。台帳の削除済み更新は238行以降で、拒否時には到達しない |

パッチ `memo_v1_1_conflict_patch_review8.sql` 96〜108行も同じ契約。統合仕様 `memo_v1_1_implementation_review8.md` 75行はエラー分類をdelete-not-found-or-revisionとし、メッセージだけで原因を断定しない。

期待応答は厳密に **HTTP409＋JSON code PT409＋message `not found or revision conflict`**。[PostgRESTのカスタムHTTP SQLSTATE契約](https://docs.postgrest.org/en/v14/references/errors.html#raise-errors-with-http-status-codes)に従う。40001・別メッセージ・単なる409はPASS不可。削除が誤成功した204も即FAIL。

## 準備と実行

- dev-sandboxのテスト専用ユーザー1名。既存のテスト専用アカウントは使用可能。ユーザー自動作成/削除なし。service_role/secretは不可。
- Node.js 22以上。追加パッケージ不要。
- .env.localのProject URL/Publishable keyとcli.mjsの固定Project Ref検証を再利用する。認証前に設定検証し、各RPC送信前もdev-sandboxの固定ホストと照合する。本番k-life-logは対象外。
- 同ユーザーで他のテスト・アプリ更新を並行実行しない。

```powershell
node tools/memo-db-test/delete-conflict-read.mjs
```

メールは対話入力、パスワードは非表示。トークンはメモリ内のみ。認証セッションや認証ログは残り得る。logout/refresh/admin APIは呼ばない。

既存runsの全JSON内UUIDと重複しないrunId/memoId/tagId/作成requestId/trashRequestIdを新規発行する。識別記録のwx新規作成に成功した後だけ書き込みへ進む。既存PASS対象の再利用・引数での対象指定は不可。

1. 初期の全snapshot取得。
2. **TAG**入力：専用タグ1件作成、revision=1と全snapshotを検証。
3. **CREATE**入力：専用メモ1件・関連1件作成。初期状態と全snapshotを検証。
4. **TRASH**入力：専用メモをゴミ箱へ移動。応答と全snapshotでrevision=2、日時、last_request_id、保持フィールドを検証。
5. **DELETE-CONFLICT**入力：同じ専用memoIdにexpected_revision=1で完全削除を試みることを確認。誤成功すると専用メモと関連が消える危険を表示する。
6. 入力完了後、削除直前の全snapshotを再取得。期待状態との全フィールド比較に加え、対象メモが1件、所有者一致、ゴミ箱内、revision=2、last_request_id=trash要求であることを確認する。
7. その全snapshotを**メモリ内だけ**で凍結保持。本文・タイトル・タグ名実値をファイルに保存しない。
8. expected_revision=1でmemo_delete_permanentlyを**1回だけ**呼ぶ。HTTP/code/messageを厳密検証。
9. 拒否後の全snapshotを取得し、直前のsnapshotと完全不変を検証。対象メモがゴミ箱内・revision=2のまま残ることも確認する。

全書き込み前に操作・対象ID・expectedRevision・影響範囲を表示する。新規作成はexpectedRevision=nullと表示。確認入力は大文字の完全一致が必要。

## 回数・安全条件・記録

- 最大 **10 RPC**：snapshot6（初期、タグ作成後、メモ作成後、trash後、確認入力後の直前、拒否後）＋save_tag1＋save1＋change_state1＋完全削除試行1。認証1回は別で、HTTP総数最大11回。
- 手動確認は **4回**。正しいrevisionによる削除や要求照合は行わない。
- ケース24の通常通信処理を再利用するが、通常経路ではsnapshot/save_tag/save/change_stateの4種類だけを許可。削除はケース25専用の拒否判定経路だけを通り、expected_revision=1以外は送信前拒否。
- 各リクエストは15秒タイムアウト、redirect:error。通信/HTTP/本文受信/JSON解析/取得後検証を区別し、原文エラー・レスポンス全文は出力しない。
- 想定外成功・FAIL・タイムアウト・確認中断・記録失敗は即停止。自動再送・復旧・削除・後片付けは禁止。正しいrevisionでの削除し直しも禁止。
- 全取得データは既存ケース18の順序非依存比較器で照合。メモ/タグはID、関連はmemo_id+tag_idで対応付け、全フィールドの有無・型・値、欠落・重複・余分な行を検査する。
- runs/<runId>.delete-conflict.jsonは識別用。進捗/結果/失敗は別ファイルへwxで新規作成する。既存run/PASS/FAILを上書きしない。保存項目はID・時刻・既定の操作名・安全な診断・合否だけ。本文/タイトル/タグ名実値/メール/パスワード/トークン/キーは記録しない。

## 残存データ・限界

正常時は専用メモ1件（ゴミ箱・revision=2）・タグ1件・関連1件を保持。準備の作成/trash要求台帳と使用済みID記録も残る設計。内部要求台帳全体の不変は公開snapshotだけでは直接確認できず、結果にもnot-directly-verifiedと記録する。

エラー単独でrevision競合とは断定しない。直前状態・送信した古いrevision・厳密な拒否・拒否後不変を組み合わせて検証する。直前取得と削除要求は別トランザクションであるため、その間の他端末操作まで排除できない。並行操作を止めることが前提。

異常時は専用データが途中まで作成済み、または誤削除済みの可能性がある。識別記録とFAILを保持し、読み取り専用で状態確認してから次の判断を行う。元runをPASSに書き換えない。

## ローカル確認（実ネットワーク禁止）

```powershell
node --check tools/memo-db-test/delete-conflict-read.mjs
node --check tools/memo-db-test/delete-conflict-contract.mjs
node --check tools/memo-db-test/delete-conflict-contract.test.mjs
node --test tools/memo-db-test/delete-conflict-contract.test.mjs tools/memo-db-test/permanent-delete-contract.test.mjs tools/memo-db-test/tag-delete-contract.test.mjs tools/memo-db-test/unauthenticated-contract.test.mjs tools/memo-db-test/isolation-contract.test.mjs
```

正常拒否、確認入力中の状態変更、メモ/タグ/関連の欠落・余分・重複、本文/日時/revision/状態/requestId/未知フィールドの変化、順序だけ異なる正常データ、HTTP/code/message不一致、誤成功、通信/受信/解析異常、各段階の失敗・確認キャンセル・記録失敗・RPC上限・再送禁止を模擬検証する。実DB接続・実行は別途判断。
