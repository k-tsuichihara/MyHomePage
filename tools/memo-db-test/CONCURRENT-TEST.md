# ケース6：同一revisionからの同時更新

実行（リポジトリルート・Node.js 22以上・対話ターミナル）：

```powershell
node tools/memo-db-test/concurrent-read.mjs
```

共通CLIの `.env.local` と固定dev-sandbox Project Ref照合、Publishable key制限を利用する。
CREATEで専用メモ1件の作成、PARALLELでA/B各1回の更新試行を確認する。
正常経路の上限はsave3・snapshot3・resolve2の計8 RPC、別途認証1回。
既存PASS対象は使わず、正常時は新規専用メモ1件がrevision=2で残る。
予期しない成功・途中失敗でも自動再送・削除・復旧はしない。

A/Bは異なるrequestId・本文、expected_revision=1。同じターンに開始しallSettledで両結果を回収する。
HTTP200の成功が一方だけ、他方がHTTP409/code PT409/message memo revision conflictの完全一致であることが必須。
旧40001は拒否。通信例外・タイムアウト・解析失敗は、DB状態にかかわらずPASS不可。
最終revision=2、成功応答・本文・requestId・日時・状態、対象外メモ・タグ・関連の不変を検査する。
成功要求のresolveは過去の成功結果と一致、競合要求はnullを要求する。null単独は未実行の証明ではない。

各送信は独立した15秒のAbortSignalで、fetch開始から本文処理までを対象とする。
クライアントの中断はサーバー処理の終了を保証しない。
UTC開始・ヘッダー受信・完了時刻と単調時計の期間を記録し、A/B期間の厳密な重なりを必須とする。
非重複はresponses記録のunconfirmed-redesign-requiredで区別しPASSにしない。
ユーザー単位のDBロックで処理は直列化される。期間重複からDB内部の同時実行やロック待ちは証明できない。

runs/にprepared識別記録、created、responses、resultまたはfailureをすべてwxで新規作成する。
保存するのはID・時刻・安全な分類・一致フラグのみ。本文・認証情報・応答全文は保存しない。
失敗時は再実行せず、識別記録のIDで読み取り専用調査を行う。識別記録は未送信の証明ではない。
並行送信の異常時は両方の開始済み結果を回収して停止し、追加の状態確認は別途判断する。
このテスト実装はSupabase接続・実DB実行を行わずにローカル模擬検証する。

```powershell
node --test tools/memo-db-test/concurrent-contract.test.mjs
```
