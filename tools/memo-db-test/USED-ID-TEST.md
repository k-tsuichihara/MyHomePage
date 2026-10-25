# ケース5：存在する使用済みメモIDへの別要求作成

```powershell
node tools/memo-db-test/used-id-read.mjs
```

Node.js 22以上。共通CLIの固定dev-sandbox接続先、Publishable key制限、非表示認証、15秒タイムアウトを使用します。作成前にCREATE、同ID別要求作成前にREUSEの完全一致確認を要求し、各対象ID・操作・影響を表示します。

既存runsのUUIDと重複しないrunId・memoId・初回requestId・別requestIdを生成し、既存ケース3/4のデータは一切使用しません。初期snapshotでmemoId不在を確認し、新規メモ1件を作成・再読込してから、同じ内容・同じmemoId・expectedRevision=null・別requestIdで作成を1回試みます。
期待拒否はHTTP 409、JSON code PT409、message `previously used memo id` の3条件です。revision競合や23505はPASSにしません。その後、拒否直前とsnapshot全体が一致した場合のみPASSです。

最大RPC回数はmemo_saveが2回、memo_load_snapshotが4回。認証は別途1回。正常時は専用メモ1件と初回保存台帳・使用済みIDが残ります。予期しない成功・HTTP不一致・通信失敗・状態変化・記録失敗は即停止し、自動再試行・削除・復旧を行いません。完全削除後のID再利用は対象外です。

識別記録はruns/<UUID>.used-id.json、各操作結果と最終結果は別ファイルへwxで新規作成します。既存記録を上書きせず、本文・認証情報・エラー全文は表示・保存しません。記録が読取不能なら停止します。他テストと並行実行しないでください。FAILでも作成済みの可能性があり、再実行前に記録IDを確認してください。

SQLのmemo_id_registryは(user_id,memo_id)を保持し、登録競合時にPT409を返します。既存メモが残る場合と完全削除後の両方を防ぐ設計ですが、このケースで検証するのは存在するメモだけです。公開RPCでは拒否と公開データ不変を確認でき、registry行や内部台帳全体は直接参照できません。拒否だけでは内部の全状態不変を直接証明できません。

模擬テスト：`node --test tools/memo-db-test/used-id-contract.test.mjs`。実DB接続は未実行です。
