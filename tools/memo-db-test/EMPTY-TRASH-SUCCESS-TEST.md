# ケース30：ゴミ箱一括完全削除・正常系

2026-10-25新規採用。[採用計画](TEST-PLAN-2026-10-25.md)参照。今回の作業は実装・ローカル検証のみで、実DB実行は別途判断する。

## SQL・API契約

tools/memo/doc/v1.1.0/memo_v1_1_schema_review8.sql：

- 244〜245行：memo_empty_trash(p_ids uuid[],p_revisions bigint[]) RETURNS integer。
- 248〜256行：認証と一次元配列・件数・null・revision範囲を検証。
- 249・257行：同ユーザーのメモ操作をトランザクションロックで直列化。
- 258〜266行：ゴミ箱全件数、ID重複、各ID/所有者/ゴミ箱状態/revisionの一致を検証。不一致なら正常系PASSにはしない。
- 267〜268行：対象メモのすべての要求resultをnull化して削除済み印を設定。
- 269行：認証ユーザーのゴミ箱**全件**を削除。任意部分集合の削除ではない。通常メモは対象外。
- 270行：削除前のゴミ箱件数を整数返却。本ケースはHTTP200・JSON数値の整数2を厳密要求する。文字列"2"、配列[2]、オブジェクト、null、小数、別件数はFAIL。
- 81行：メモ削除に伴い関連をFK CASCADEで削除。タグ本体は保持。

統合仕様memo_v1_1_implementation_review8.md 41行の全ID/revision一致時だけ原子的削除・応答不明時の元対象再確認の原則を維持する。6関数パッチの111〜138行も同契約。ケース26の拒否経路と異なり、正常削除と件数返却まで検証する。

## ユーザー準備

1. dev-sandbox DashboardのAuthentication → Usersで**ケース30専用の新しいユーザー**を本人が手動作成。Email/Passwordでログイン可能・メール確認済み状態を準備する。CLIはユーザー作成/削除や設定変更をしない。
2. Project Refが既存cli.mjsのdev-sandbox固定値と一致すること、新しいユーザーのUUID・メールを確認する。本番k-life-logには接続しない。
3. 起動時にDashboardの新規ユーザーUUIDを入力。過去runsの全JSON内UUIDに含まれていれば認証前に停止。ケース26〜29のユーザーも使用不可。記録の削除/変更で回避しない。
4. 認証結果user.idと入力UUIDの一致も確認する。UUID一致と履歴照合だけではユーザーの作成日時まで証明できないため、新規専用ユーザーであることはDashboardでも本人が確認する。
5. 最初のsnapshotでメモ/タグ/関連がすべて0件でなければ、書き込み・確認入力前に停止。削除/復元で空にする処理はない。

Node.js 22以上、追加依存なし。既存.env.localのProject URLとPublishable keyだけ使用する。認証前・各RPC送信前のdev-sandbox固定ホスト検証、非表示パスワード、メモリ内トークンを維持。service_role/secretは禁止。auth管理・logout・refresh APIは呼ばない。認証セッション/ログは残り得る。

## 実行と7回の確認

```powershell
node tools/memo-db-test/empty-trash-success-read.mjs
```

専用ユーザーUUID、メール、非表示パスワードを入力。新規runId/tagId/memoId3件/作成requestId3件/trash requestId2件を発行し、過去記録と重複しないことを検証。識別記録のwx新規保存成功後だけ実行する。

1. 初期全snapshotの形状・所有者・完全空状態を確認。
2. **TAG**：専用タグ1件作成、全snapshot比較。
3. **CREATE-0 / CREATE-1 / CREATE-2**：タグに関連する専用メモを各1件作成。作成時revision=1、last_request_id、本文/タイトル、created_at=updated_at、ピン/ゴミ箱null、所有者、関連を確認し、毎回全snapshotを比較。
4. **TRASH-0 / TRASH-1**：メモ0と1だけをゴミ箱へ。revision=2、updated_at増加（マイクロ秒）、deleted_at=updated_at、last_request_id変更と他フィールド保持を検証し、毎回全snapshotを比較。メモ2は通常状態revision=1で維持する。
5. 確認前snapshotを取得し、全期待データと比較して対象2件の最新revisionを取得。
6. **EMPTY**：対象全ID・最新revision・件数2・requestId=nullを表示。RPCがそのユーザーのゴミ箱全件を完全削除すること、通常メモを保持することを明示して承認を得る。
7. 承認後、直前全snapshotを再取得し、期待状態および承認したrevisionと一致することを検証。全メモ3/タグ1/関連3件、ゴミ箱全IDがメモ0/1だけ、両revision=2・所有者・trash requestId一致、通常メモrevision=1を確認する。不一致なら送信しない。
8. そのID順に対応するrevision配列でmemo_empty_trashを1回だけ呼ぶ。HTTP200・JSON整数2以外は即FAIL。
9. 削除後snapshotを取得。直前snapshotから対象メモ2件・関連2件だけを除いた期待値と順序非依存・全フィールド厳密比較する。通常メモ1件・タグ1件・関連1件が保持されていることを確認。

各書き込み前に操作・対象ID・requestId・expectedRevision（配列の場合はexpectedRevisions）・影響範囲を表示。requestIdのないタグ作成/一括削除はnull。手動確認は **7回**。

最大 **17 RPC**：snapshot10（初期・準備6操作後・確認前・承認後直前・削除後）＋save_tag1＋save3＋change_state2＋empty_trash1。認証1回は別でHTTP総数最大18回。

## 停止・記録・残存データ

- 通常経路はsnapshot/save_tag/save/change_stateのみ。一括削除は専用経路からのみ送信し、重複しないUUID2件・revision2件（双方2）を送信前に検証。個別削除・照合・任意SQL/DMLは呼ばない。
- 各HTTP要求は15秒制限・redirect:error。通信/HTTP/本文受信/JSON解析/取得後検証を区別。初期非空・過去ユーザー・ユーザー不一致・直前差異・誤HTTP・誤件数・部分削除・保持データ変化・確認中断・記録失敗は停止してFAIL。
- タイムアウトや通信失敗は適用結果不明の可能性を残す。クライアント中断はサーバー処理中断の証明ではない。自動再送・復旧・後片付けはせず、識別記録とFAILを保持して元対象の読み取り専用調査を先に行う。
- 後から対象2件の不在を確認できても、正常HTTP応答を観測したPASSと混同しない。元runを書き換えない。
- 一括削除要求にrequestIdはなく、SQL台帳にこの操作の要求記録は作らない。内部要求台帳のresult消去や削除済み印、通常メモの台帳保持は直接未検証。公開snapshotと正常応答で確認できた範囲のみ報告する。
- 正常時は通常メモ1件（revision=1）・タグ1件・関連1件を保持。削除2件の使用済みIDと最小限の要求履歴は残る設計。後片付けしない。
- 比較器はケース18のものを再利用し、メモ/タグをID、関連をmemo_id+tag_idで対応付ける。全フィールドの有無・型・値、欠落・重複・余分な行を検査する。配列順・キー挿入順だけは無視する。
- runs/<runId>.empty-trash-success.jsonと進捗/最終結果/失敗は別々にwx新規作成。本文/タイトル/タグ名実値/メール/パスワード/トークン/キー/レスポンス全文は記録しない。既存記録を上書きしない。
- 専用ユーザーを他端末/CLIで並行使用しない。直前取得と削除は別トランザクションであり、その間の外部操作を完全に排除した証明はできない。
- 初期読取失敗でも識別記録が残れば、そのユーザーの再利用は履歴検査で拒否する。記録を消して再実行せず、安全な次の手順を別途判断する。

## ローカル検証

```powershell
node --check tools/memo-db-test/empty-trash-success-read.mjs
node --check tools/memo-db-test/empty-trash-success-contract.mjs
node --check tools/memo-db-test/empty-trash-success-contract.test.mjs
node --test tools/memo-db-test/empty-trash-success-contract.test.mjs
$memoTestFiles = Get-ChildItem -LiteralPath tools/memo-db-test -Filter '*.test.mjs' -File | ForEach-Object { $_.FullName }
node --test $memoTestFiles
```

模擬では実ネットワークを禁止。整数2の成功、文字列/配列/オブジェクト/null/小数/別件数、旧ユーザー/認証不一致/初期非空、直前の集合・revision・通常メモ差異、部分削除、通常メモ/タグ/関連の不正変更、欠落・重複・余分・未知フィールド、順序差だけの正常データ、通信/受信/解析異常、全段階の失敗・確認中断・記録失敗、上限回数と再送禁止を検証する。実DB確認とは区別する。
