# ケース24：個別メモの完全削除

2026-10-25にユーザーが新規採用したケース。採用記録は [TEST-PLAN-2026-10-25.md](TEST-PLAN-2026-10-25.md)。実装・模擬検証は実DBの動作確認ではない。

## 根拠と期待結果

review8 SQLは `tools/memo/doc/v1.1.0/memo_v1_1_schema_review8.sql` を参照。

| 処理 | 根拠・期待値 |
|---|---|
| 専用タグ作成 | 275〜292行：memo_save_tag(p_id UUID,p_name text,p_expected_revision bigint)。新規はexpected_revision=null、所有者一致、revision=1 |
| 関連付き専用メモ作成 | 102〜157行：memo_saveへ新規memoId/requestId、expected_revision=null、専用tagIdを送る。返却は{memo,tagIds}、revision=1、last_request_id=作成要求、deleted_at/pinned_at=null、created_at=updated_at |
| ゴミ箱へ移動 | 192〜225行：memo_change_stateへaction=trash、expected_revision=1、新規requestId。revision=2、deleted_at=updated_at、updated_atは増加、last_request_idはtrash要求。タイトル・本文・作成日時・ピン・所有者・タグ関連は不変 |
| 個別完全削除 | 228〜240行：memo_delete_permanently(p_id UUID,p_expected_revision bigint) RETURNS void。自分のゴミ箱内専用メモ・取得済み最新revision=2を指定。メモ行削除と台帳result消去は同じトランザクション。対象不在/不一致はPT409だが、この正常系では成功だけを許容 |
| 関連行の削除 | 78〜82行：メモへの複合FKのON DELETE CASCADEで対象memo_idの関連が消える。タグ本体は削除対象でない |
| 削除後の照合 | 161〜190行：memo_resolve_requestへ凍結した元作成payload全体を送る。同じ所有者/requestId/対象/ハッシュが一致し、deleted_redactedなら厳密に{status:'previously-applied-deleted'}。null/saved/余分なフィールドはFAIL |
| 全取得データ | 310〜320行：memo_load_snapshotは通常・ゴミ箱双方のメモとタグ・関連を取得。削除前から対象メモ・関連のみ除いた結果と全フィールド比較 |

6関数パッチのdelete_permanently（96〜109行）は同じ引数・所有者条件・revision条件・void返却。照合RPCはパッチ対象外で、本体を参照する。

統合仕様 `memo_v1_1_implementation_review8.md` 34〜41行も参照。保存要求の凍結・読み取り専用照合・完全削除のデータ最小化・応答不明時の再取得原則を維持する。

API成功形式は削除が **HTTP204・空本文**、ほか5種類はHTTP200・JSON。SQLのvoidをJSON nullとして受信する想定ではない。ラッパー内で検証後nullへ変換する。[PostgREST 14.18公式ソース Response.hs](https://github.com/PostgREST/postgrest/blob/v14.18/src/PostgREST/Response.hs#L162-L183) のfuncReturnsVoid分岐が204・空本文を返すことを根拠とする。

## 準備・実行

- Node.js 22以上。追加パッケージ不要。
- dev-sandboxの既存テスト専用ユーザー1名を使用する。自動ユーザー作成/削除なし。service_role/secretは不可。
- 隣接.env.localは既存のProject URL/Publishable key設定を使用。cli.mjsの固定Project Ref検証を認証前に実施し、各RPC送信前にも完全一致の接続先を検証する。本番k-life-logには接続しない。
- ほかの端末・CLIから同ユーザーのデータを変更しない。既存runを引数で指定する機能はない。毎回新規専用IDを発行する。

```powershell
node tools/memo-db-test/permanent-delete-read.mjs
```

メールは対話入力、パスワードは非表示。トークンはメモリ内のみ。認証に伴うセッション/認証ログは残り得るが、logout/refresh/admin APIは呼ばない。

識別記録をwxで排他新規作成後に限り書き込みへ進む。過去runsの全JSON内UUIDと重複しないrunId/memoId/tagId/作成requestId/trashRequestIdを発行する。

1. 初期の全スナップショットを取得。
2. **TAG**：新規専用タグ1件作成。全snapshotを比較。
3. **CREATE**：新規専用メモ1件と関連1件作成。初期revision=1等を検証し、全snapshotを比較。
4. **TRASH**：専用メモをゴミ箱へ移動。revision=2・日時・状態の応答検証後、削除直前の全snapshotを比較。
5. **DELETE**：最新revision=2で専用メモを完全削除。専用メモ・関連が消えることは意図した正常操作。全snapshotでタグ本体・対象外データの保持を検証。
6. 凍結した元作成payloadでmemo_resolve_requestを1回だけ呼び、削除済みreceiptを検証。元のmemo_saveは再送しない。

各書き込み前に対象ID・操作・影響範囲を表示し、対応する大文字入力の完全一致を要求する。タイトル・本文・タグ名実値は表示しない。

最大 **10 RPC**（snapshot5、save_tag1、save1、change_state1、delete_permanently1、resolve1）。認証は別途1回、HTTP総数最大11回。手動確認は**4回**。削除RPCは最大1回。

成功応答・全snapshot比較・削除済みreceiptすべてを満たした場合だけPASS。比較は既存ケース18のcompareTagDeleteSnapshotsを再利用し、メモ/タグはID、関連はmemo_id+tag_idで対応付ける。配列順・キー挿入順は無視し、全フィールドの有無・値・型・行の欠落/重複/余分を厳密に検査する。所有者も全取得行で検査する。

## 記録・停止・残存データ

- runs/<runId>.permanent-delete.jsonは識別用。進捗・最終結果・失敗は別ファイルにwxで作成。既存識別記録・PASS/FAIL結果を上書きしない。
- 記録はID・時刻・既定の操作名・安全な診断項目・合否のみ。本文・タイトル・タグ名実値・パスワード・トークン・キー・レスポンス全文は保存しない。
- fetch通信/HTTP応答/本文受信/JSON解析/取得後検証を区別。15秒タイムアウト、リダイレクト禁止、自動再送なし。異常・確認キャンセル・進捗保存失敗は即停止。削除失敗や結果不明でも自動再送・復旧・後片付けしない。
- 正常時：今回の専用メモ0件・関連0件、専用タグ1件を保持。メモの使用済みIDと処理済み要求の最小限記録はDBに残る設計。
- 削除済み応答の確認は内部台帳result=nullの直接証明ではない。trash履歴を含む全台帳の消去・バックアップ・監査ログの内容は未確認。trash要求をresolveしない。
- 競合拒否、保存要求の削除後リプレイ、ID再利用、他人のデータ、一括削除は本ケース対象外。
- 途中FAIL時は専用タグ・メモ・関連が残る/削除済みの可能性がある。元識別記録とFAILを保持し、次の操作前に読み取り専用で状態を確認する。FAILを後からPASSへ改変しない。

## ローカル検証

```powershell
node --check tools/memo-db-test/permanent-delete-read.mjs
node --check tools/memo-db-test/permanent-delete-contract.mjs
node --check tools/memo-db-test/permanent-delete-contract.test.mjs
node --test tools/memo-db-test/permanent-delete-contract.test.mjs tools/memo-db-test/tag-delete-contract.test.mjs tools/memo-db-test/unauthenticated-contract.test.mjs tools/memo-db-test/isolation-contract.test.mjs
```

全通信は模擬し実ネットワーク利用は禁止。正常削除、残存メモ/関連、タグ消失・変更、対象外変化、欠落・余分・重複、順序だけ異なる正常値、revision・マイクロ秒日時・requestId不一致、削除receipt/照合receipt不一致、HTTP/通信/受信/解析異常、各段階停止、確認キャンセル、結果記録失敗、RPC回数・再送禁止を検証する。
