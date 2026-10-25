# ケース7：ピン留め・解除

Node.js 22以上の対話型ターミナルで、リポジトリルートから実行する。

```powershell
node tools/memo-db-test/pin-read.mjs
```

実装時はローカル検証のみ。Supabase接続・実DB実行は行わない。
共通CLIの固定dev-sandbox Project Ref検証とPublishable key制限を使う。
`.env.local`は既存のテスト用設定を使用し、値や認証情報を記録しない。
ログイン後、runs内の既存UUIDを避けてrun/memo/作成/pin/unpin用の新規IDを生成する。
識別記録の新規保存が失敗した場合は書き込みRPCに進まない。

## 操作と判定

1. スナップショット取得。対象IDが存在しないことを確認。
2. 対象・影響範囲を表示し、CREATE入力後にmemo_saveで専用メモ1件作成。
3. revision=1、pinned_at=null、日時・requestId・内容・空タグを検証。
4. 直後のスナップショットと正常応答の一致、対象外データ不変を確認。
5. memo_resolve_requestを作成時と同じ入力で1回実行し、作成結果と一致を確認。
6. PIN入力後、memo_change_state(p_id, p_expected_revision=1, p_request_id=新規ID, p_action='pin')を1回実行。
7. メモ行の戻り値とスナップショットを比較。revision=2、pinned_at=updated_at、last_request_idを検証。
8. UNPIN入力後、同RPC(expected_revision=2、別の新規requestId、action='unpin')を1回実行。
9. メモ行とスナップショットを比較。revision=3、pinned_at=null、last_request_idを検証。

状態操作の戻り値はメモ行そのもの。{memo,tagIds}形式ではない。
更新日時はSQLのnow()更新に従い直前より後、pin日時は同じSQL文のupdated_atと完全一致を要求する。
更新日時の前後比較はPostgreSQLのマイクロ秒精度を保持し、JavaScriptのミリ秒丸めによる誤判定を避ける。
タイトル・本文・作成日時・ゴミ箱状態・その他の列を変えず、対象外メモ・タグ・関連も各段階で不変を要求する。
全RPCはHTTP200とJSON解析成功を必須とし、異常・タイムアウト・応答不明・確認キャンセル・記録失敗は停止する。

**pin/unpinの読み取り専用要求照合は現行SQLでは検証不可。PASS条件から除外。**
結果記録にstateRequestResolution=not-verified-no-readonly-apiを明記する。
memo_change_stateの再送を照合の代替にしない。作成照合は履歴結果であり現在状態の証明ではない。

## 回数・残存データ・記録

最大8 RPC：memo_save 1、memo_change_state 2、memo_load_snapshot 4、memo_resolve_request 1。別途認証1回。
正常時は専用メモ1件がrevision=3・未ピン留めで残る。使用済みIDと要求台帳もDBに残る。
途中失敗では作成前／revision1／ピン留めrevision2／解除revision3のいずれか、または状態不明となる。
自動再送・削除・復旧はしない。クライアント中断はサーバー処理終了の保証ではない。
失敗後は識別記録のIDを使い、別途読み取り専用確認を行う。

runs/<runId>.pin.jsonはprepared識別記録。
各操作の.pin.create.result.json／.pin.pin.result.json／.pin.unpin.result.jsonと総合.pin.result.jsonは別ファイル。
異常時は.pin.failure.jsonを新規作成。すべてwx指定で上書きしない。
記録はID・時刻・安全な段階名・判定概要のみで、本文・タイトル・認証情報・応答全文を含めない。
prepared記録は未送信の証明ではなく、段階PASSも総合PASSとは区別する。
既存PASS対象・本体・SQL・過去記録は変更しない。

## ローカル検証

```powershell
node --check tools/memo-db-test/pin-read.mjs
node --check tools/memo-db-test/pin-contract.mjs
node --check tools/memo-db-test/pin-contract.test.mjs
node --test tools/memo-db-test/pin-contract.test.mjs
```

模擬テストはネットワークを禁止し、注入したRPC/fetchだけを使用する。
実DBのJSON表現、権限、実通信の時間制限は未検証。
