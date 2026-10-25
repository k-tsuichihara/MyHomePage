# ケース9：ゴミ箱から復元

Node.js 22以上・対話型ターミナルからリポジトリルートで実行する。

```powershell
node tools/memo-db-test/restore-read.mjs
```

実装段階ではローカル検証のみ。実DB実行は利用者が報告を確認してから判断する。
共通CLIの固定dev-sandbox Project Ref検証とPublishable key制限を通信前に適用する。
認証はcli.mjs、RPCはケース7のpinRpcを再利用（HTTP200必須、独立した15秒期限、リダイレクト拒否、再送なし）。
既存入口のimportでは認証・通信を開始しない。追加パッケージなし。

## SQL契約と手順

review8 SQLのmemo_change_state(p_id uuid,p_expected_revision bigint,p_request_id uuid,p_action text)を使用。
戻り値はメモ行そのもの。trashはdeleted_at=now()、restoreはdeleted_at=null。
両操作ともupdated_at=now()、revision+1、last_request_id更新。pinned_at・タグ関連は保持。
restoreは現在ゴミ箱内であることが必要。memo_load_snapshotは通常・ゴミ箱メモを同じmemos配列で返す。

1. 認証後、runsの既存UUIDを避けてrun/memo/作成/trash/restoreの新規IDを生成。
2. prepared識別記録をwxで新規保存。失敗したら書き込みに進まない。
3. 作成前snapshotで対象が不在であることを確認。
4. 対象・影響範囲を表示しCREATE入力後、専用メモ1件を作成。
5. 作成応答とsnapshotを比較：revision=1、deleted_at=null、pinned_at=null、空タグ、本文・日時・要求ID一致。
6. TRASH入力後、expected_revision=1・新規requestId・action='trash'を1回実行。
7. 応答とsnapshotを比較：revision=2、deleted_at=updated_at。変更対象外の列と対象外データは不変。
8. RESTORE入力後、expected_revision=2・別の新規requestId・action='restore'を1回実行。
9. 応答とsnapshotを比較：revision=3、deleted_at=null。pinned_atはnullを維持。
10. 作成時の凍結入力でmemo_resolve_requestを1回実行し、作成時の保存結果と完全一致を確認。

各状態変更の更新日時は直前より後であることをマイクロ秒精度で確認する。
各RPC直後のsnapshotで対象・対象外メモ（既存ゴミ箱メモも含む）・タグ・関連を比較する。
作成照合結果のrevision=1は履歴であり、現在状態revision=3とは区別する。
trash/restore要求の読み取り専用照合は現行SQLで検証不可・PASS条件外。
結果にstateRequestResolution=not-verified-no-readonly-apiを明記し、状態変更RPCの再送で代替しない。

## 回数・残存データ・安全性

最大8 RPC：memo_save 1、memo_change_state 2、memo_load_snapshot 4、memo_resolve_request 1。別途認証1回。
正常時は専用メモ1件が通常状態・revision=3・未ピン留めで残る。使用済みIDと要求台帳も残る。
タグなし・未ピン留めのメモのみを検証。タグ付きメモの使用件数増減やピン留め済みメモの往復は実証しない。
既存コード・本体・SQL・過去PASS対象／記録は変更しない。

通信失敗・タイムアウト・HTTP異常・JSON解析失敗・状態不一致・確認キャンセル・記録失敗は停止する。
段階PASSは総合PASSではない。自動再送・削除・復旧なし。
中断はサーバー側の処理終了を保証しない。失敗時には未作成／通常revision1／ゴミ箱revision2／通常revision3／状態不明があり得る。
再実行せず、識別記録のIDで別途読み取り専用確認を行う。

runs/<runId>.restore.jsonはprepared識別記録。
.restore.create.result.json／.restore.trash.result.json／.restore.restore.result.jsonは段階結果。
.restore.result.jsonは総合結果、.restore.failure.jsonは失敗記録。すべてwxで新規作成し上書きしない。
記録はID・時刻・安全な段階名・判定概要のみ。本文・タイトル・認証情報・レスポンス全文は記録しない。
prepared記録は未送信の証明ではない。

## ローカル検証

```powershell
node --check tools/memo-db-test/restore-read.mjs
node --check tools/memo-db-test/restore-contract.mjs
node --check tools/memo-db-test/restore-contract.test.mjs
node --test tools/memo-db-test/restore-contract.test.mjs
```

模擬テストでは実ネットワーク禁止。実DBの返却表現・権限・通信動作は未検証。
