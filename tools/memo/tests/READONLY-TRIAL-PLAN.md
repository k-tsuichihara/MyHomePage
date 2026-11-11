# `memo_load_snapshot` 初回読み取り試験計画

## 1. 位置付け

PR #58 の `PRELIVE-RPC-AUDIT.md` と `SINGLE-RPC-ACCEPTANCE.md` に基づく、開発用Supabaseでの初回読み取り試験の計画である。本書は承認手順を定めるもので、実環境への接続・Auth・HTTP・SQL実行を含まない。

試験成功は読み取り経路の観測結果に限る。senderが返す `unverified` を `single-rpc` に昇格させない。

## 2. 実施前ゲート

オーナーが各項目を確認し、未確認の項目があれば停止する。

- [ ] Dashboardの表示名が `dev-sandbox` であることを確認する。
- [ ] DashboardのProject Refが固定設定値 `yohoppqflnhhvqypwhfv` と一致し、固定 `MEMO_RPC_ORIGIN` がそのRefに対応することを確認する。表示名だけで合格にしない。
- [ ] HTTPS origin がリポジトリの固定 `MEMO_RPC_ORIGIN` と一致する。
- [ ] Review8 SQLの適用状態、`memo_load_snapshot()` の存在・署名・`authenticated` EXECUTE、対象テーブルのRLSをDashboardで確認する（実測値は非公開記録）。
- [ ] PostgREST設定とAPI到達先が対象Projectのものだと確認する。
- [ ] 合成テストユーザー、合成データ、専用ブラウザプロファイルを準備する。service role・管理キー・実ユーザーデータは使用しない。
- [ ] 証跡の保存先をオーナーの非公開領域に決め、トークン、パスワード、メール、本文、UUID、生レスポンスを保存しない。
- [ ] 失敗時は停止し、自動再送・自動削除・自動後片付けを行わないことを確認する。

## 3. 通信と上限

Auth SDKのセッション復元・refresh・ユーザー確認と、RPCを別の通信群として記録する。

| 区分 | 提案上限 | 計測方法 | 超過時 |
| --- | --- | --- | --- |
| Auth | 初期化・必要なrefreshを含め1試験1回の認証経路。自動refreshの追加発生は記録し停止 | SDK境界の呼出しカウンタ、ブラウザのネットワーク記録（秘密値は保存しない） | 後続RPCを実行せず停止 |
| RPC | `memo_load_snapshot` 1回のみ。書込・resolve・他RPC 0回 | sender/fetch境界の呼出しカウンタとRPC名 | 即時停止、再送なし |
| 画面待機 | 30秒（最終承認待ち） | 実行開始から結果表示までの経過時間 | 結果不明として停止 |

上限値はこの計画の提案であり、最終的なオーナー承認が必要である。SDKの内部refreshを外部から正確に制御できない場合は、Auth通信回数を確定値として扱わずUNKNOWNとする。

## 4. 実施順序（未実施）

1. オーナーがProject Ref、origin、ブラウザプロファイル所有権を再確認する。
2. 合成ユーザーでログインし、ユーザーIDが試験対象と一致することだけを確認する。資格情報はログ・証跡に残さない。
3. セッション復元または必要なrefreshを完了させ、認証世代が安定していることを確認する。
4. 許可RPCを `memo_load_snapshot` に固定し、1回だけ読み取る。書込系RPC、削除系RPC、`memo_resolve_request` は実行しない。
5. status、応答URL一致、JSON形状、呼出し回数を確認する。本文は保存せず、件数などの最小限のサマリーだけを非公開記録する。
6. 結果をオーナーが確認し、成功・拒否・結果不明を区別する。結果不明では再実行しない。

## 5. 停止条件

次のいずれかで即時停止し、後続操作を行わない。

- Project Ref、origin、ユーザー所有者、環境ラベルの不一致。
- 許可外RPC、想定外メソッド、redirect、応答URL不一致、追加のネットワーク呼出し。
- timeout、通信断、非JSON、未知のHTTP分類、RLS/GRANT拒否、認証失効。
- 画面待機30秒超過、応答出所・実行完了の判断不能、結果不明。
- 実データ・秘密情報・生Bearerがログや証跡に現れた疑い。

停止後は自動再送・ロールバック・データ削除を行わず、オーナーが非公開診断を行う。

## 6. 記録と判定

Gitには手順とサニタイズ済み結果だけを置く。記録項目は環境ラベル、実施時刻、RPC名、呼出し回数、status分類、結果種別、件数サマリー、停止理由に限定する。

`unverified`、応答URLや中継の出所を確認できない場合は、読み取り試験の観測結果を記録するだけで、`single-rpc`認定・SDK再送なし・DB実行完了を確定しない。

## 7. 承認チェックリスト

- [ ] 開発環境・origin・専用プロファイルの確認を承認
- [ ] 合成ユーザーと合成データの利用を承認
- [ ] Auth通信上限と計測方法を承認
- [ ] `memo_load_snapshot` 1回、その他RPC 0回を承認
- [ ] 30秒待機上限と結果不明時の停止を承認
- [ ] 非公開証跡の保管・破棄担当を承認
- [ ] 試験後も `single-rpc` 未認定、C04進行中を維持することを確認

## 8. オフライン実施状況と人間試験の可否

`readonly-trial-boundary.test.ts` で、C03のAuthContextを模した注入境界からC04 controllerを通して、`memo_load_snapshot`のみを呼ぶこと、他RPCを呼ばないこと、`unverified`・通信断後に自動再送しないことを検証する。このテストは実Auth・実HTTPを使わない。

`src/readonly-trial.ts` を追加し、既存C04 controllerを再利用した読み取り専用ゲート、RPC名・回数のサニタイズ済み観測、Auth通信がこの境界では未観測であることの明示を実装した。`createBrowserReadonlyTrial` がBrowser Auth→Auth session→controller→senderを結ぶcomposition rootとなる。`readonly-trial.test.ts` と既存の境界テストで通信なしに検証する。

`tests/readonly-trial-browser/preview.html` と `build:readonly-trial-browser` を追加し、Auth開始・読み取り開始を明示操作に分離した合成ブラウザ入口を用意した。`src/readonly-trial-runner.ts` はProject Ref/originの事前検査、Auth/RPC回数観測、STOP/disposeを注入値で制御する。ページ表示では初期化・通信を行わず、表示はサニタイズ済み観測値だけである。専用Persistence Permitをテストrunnerから注入する前提で、既存Browser Auth→composition root→readonly trial経路を確認できる。

`startAuth(credentials)` は注入境界として資格情報を受け取れるが、Auth完了後にrunnerが資格情報参照を継続保持しないことだけを契約とし、JavaScriptメモリ消去を保証しない。専用loopbackのオフラインrunnerは`tests/readonly-trial-browser/run.ts`で合成transportを検証し、Human Gate本番runnerは`scripts/run-human-gate.mjs`で既存sender/fetchへ接続する。

2026-11-11に初回Human Gate実地試験を1回実施した。開始前は`idle / authCalls: 0 / rpcCalls: 0 / writeRpcCalls: 0`、資格情報入力後も通信0件だった。Auth開始は1回のみで、サニタイズ済み観測は`state: stopped / authCalls: 1 / rpcCalls: 0 / rpcNames: [] / otherRpcCalls: 0 / writeRpcCalls: 0 / stopReason: auth-blocked`。読み取り開始・再Auth・再試行は行わず、入力欄はクリア後に終了した。この記録は実通信の結果であり、Auth提供側の応答本文や資格情報は保存しない。`auth-blocked` の詳細原因はサニタイズ境界の外にあるため、追加通信なしでは特定不能であり、失敗として扱う。

実Auth/RPCの成功結果、refresh挙動、応答出所、single-rpc認定は未検証として残る。停止後の自動再送は禁止し、再試験には別途人間承認を要する。

Auth失敗時は、セッション層が保持する固定分類（`unavailable`、`invalid-session`、`expired`、`different-user`、`credentials-rejected`）をHuman Gateの`auth-*`停止理由へ反映する。生HTTP本文・providerメッセージ・資格情報は分類対象にも表示対象にも含めない。安全な既知コードに一致しない場合のみ`auth-unavailable`または`auth-blocked`へフォールバックする。

`npm run human-gate:offline` はdead proxyと`connect-src: none`を使う合成回帰入口であり、実Auth/RPCへ接続しない。`npm run human-gate` はheaded専用profile、owner.runId由来のPermit、trusted origin限定CSP/route/transportを使う本番試験入口で、起動・表示・入力だけでは通信しない。Auth開始と読み取り開始は別の明示操作である。

## 9. 未確認事項

実Authのrefresh回数、Hosted版SQL Editor/API設定、PostgRESTの実応答、プロキシ/CDNの再送・redirect、RLS/GRANTの実効動作、実ブラウザのStorageとTLSは未確認である。これらを確認するには、本書とは別にオーナーの実接続承認が必要である。
