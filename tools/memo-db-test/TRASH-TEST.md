# ケース8：メモをゴミ箱へ移動

Node.js 22以上・対話型ターミナルからリポジトリルートで実行する。

```powershell
node tools/memo-db-test/trash-read.mjs
```

実装段階ではローカル検証のみ。実DB実行は利用者が報告を確認してから判断する。
設定・認証は共通cli.mjsを再利用し、固定dev-sandbox Project Refとsb_publishable_形式を通信前に検証する。
RPC通信はケース7のpinRpcを再利用（HTTP200必須、15秒期限、リダイレクト拒否、再送なし）。
既存の入口のimportでは実行を開始しない。新しい依存パッケージはない。

## SQL契約と手順

- review8 SQLのmemo_change_state(p_id uuid,p_expected_revision bigint,p_request_id uuid,p_action text)を使用。
- ゴミ箱移動はaction='trash'、expected_revision=1、新規requestId。戻り値はメモ行そのもの。
- deleted_atとupdated_atは同一SQL文のnow()、revisionは2、last_request_idは移動要求ID。
- pinned_atは維持。本ケースは未ピン留めなのでnullのまま。タイトル・本文・作成日時・タグ関連も維持。
- memo_load_snapshotは通常・ゴミ箱メモを同じmemos配列で返す（削除日時による除外なし）。

1. 認証後、runs内の既存UUIDを避けて専用run/memo/作成要求/移動要求IDを生成。
2. prepared識別記録を新規保存。失敗時は書き込みに進まない。
3. 作成前snapshotを取得。対象IDが存在しないことを確認。
4. 対象ID・影響範囲を確認しCREATEを入力。専用メモ1件を作成。
5. revision=1、deleted_at=null、pinned_at=null、内容・日時・空タグを検証し、snapshotと一致を確認。
6. 対象ID・ゴミ箱移動の影響を確認しTRASHを入力。状態変更を1回実行。
7. 応答全列と移動後snapshotを比較。対象メモがmemos内に残り、変更列以外と対象外データが不変であることを確認。
8. 作成時の凍結入力でmemo_resolve_requestを1回実行。履歴上の作成結果と完全一致を確認する。

作成照合が返すrevision=1は履歴であり、現在はゴミ箱内revision=2である。
ゴミ箱移動要求の読み取り専用照合は現行SQLで検証不可・PASS条件外。
結果にstateRequestResolution=not-verified-no-readonly-apiと記録し、状態変更RPCの再送で代替しない。
更新日時は直前より後であることをマイクロ秒精度で確認。deleted_atはupdated_atと完全一致を要求する。

## 範囲・回数・安全性

正常経路の最大RPCは6回：save1・change_state1・snapshot3・resolve1。別途認証1回。
正常終了時は新規専用メモ1件がゴミ箱内にrevision=2・未ピン留めで残る。使用済みIDと要求台帳も残る。
対象外メモ（既存ゴミ箱内も含む）・タグ・関連を各snapshotで比較する。
今回はタグなしメモのみ。タグ付きメモの関連保持・使用件数減少や、ピン留め済みメモの移動は実証しない。
タグ使用件数は通常メモだけを数える既存仕様を変更しない。

通信失敗・HTTP異常・JSON解析失敗・状態不一致・確認キャンセル・記録失敗は停止し、総合PASSにしない。
自動再送・削除・復旧なし。中断はサーバー処理終了の保証ではない。
途中失敗では未作成／通常revision=1／ゴミ箱revision=2、または状態不明となり得る。
再実行せず、識別記録のIDで別途読み取り専用確認を行う。

runs/<runId>.trash.jsonが識別記録、.trash.create.result.json／.trash.trash.result.jsonが段階結果、
.trash.result.jsonが総合結果、.trash.failure.jsonが失敗記録。すべてwxで新規作成し元記録を上書きしない。
段階PASSと総合PASSを区別。preparedは未送信の証明ではない。
記録はID・時刻・安全な段階名・判定概要のみ。本文・タイトル・認証情報・レスポンス全文は保存しない。
本体・SQL・既存コード・過去PASS記録は変更しない。

## ローカル検証

```powershell
node --check tools/memo-db-test/trash-read.mjs
node --check tools/memo-db-test/trash-contract.mjs
node --check tools/memo-db-test/trash-contract.test.mjs
node --test tools/memo-db-test/trash-contract.test.mjs
```

模擬テストは実ネットワーク禁止。実DBの返却表現・権限・通信動作は未検証。
