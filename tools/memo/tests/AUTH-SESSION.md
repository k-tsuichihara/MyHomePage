# C03：Auth・セッション接続契約と試験方針

## v1.1.0の現行方針：SDK標準Auth＋製品用adapter

Q05のオーナー承認により、読書管理と同様にSupabase SDK標準Authを利用する。SDKは2.119.0を維持する。[Review8 §1.1](../doc/v1.1.0/memo_v1_1_implementation_review8.md)が製品仕様の正本。今回の実装は実Auth通信・UAT再開・公開の承認ではない。

- メールアドレス＋パスワードでSDKのsignInWithPasswordを呼ぶ。
- sessionの永続化・自動更新・復元とonAuthStateChangeはSDK標準動作を利用する。
- メモ専用storageKeyは `myhomepage.memo.auth.v1`。persistSession/autoRefreshTokenはtrue。email/password方式のためdetectSessionInUrlはfalse、debugはfalse。
- logoutは既存どおり `signOut({ scope: 'local' })`。他アプリのセッション保存先へ統合しない。
- Auth用safeFetch、Auth Response再構築、Auth独自URL/redirect/status/JSON/timeout処理は撤去する。SDKへ注入fetchを直接渡す。実製品ではブラウザfetch、offline試験では合成fetchを使用する。
- login/restore成功の追加getUser照合、SDK通知のtoken/期限厳密一致、通知後の再確認連鎖を撤去する。SDKのsessionを製品用状態へ反映する。
- SDK内部Storageキーallowlistとsticky停止は撤去し、SDKへ設定済みの専用Storageを直接渡す。Auth sessionの通常永続化は維持するが、cloudメモ/draftをlocalへ保存しない。
- 一時診断のobserver/パネル/通信予算/専用build/runner/scriptと、それだけを検証する試験は撤去する。`preview:auth-diagnostic`は使用しない。

## 製品用adapterが維持する安全境界

`createMemoAuthSession`は既存getState/subscribe/login/restore/logout/getContext/isCurrent/prepareRpc/requireReauthentication/disposeの接続契約を維持する。新しいAuthサーバー検証を実装しない。

- 公開state/contextはuser・generation・期限・固定の失敗分類だけ。password/token/session本体やprovider例外をUI・ログへ渡さない。
- SDK sessionのuser ID・期限・token有無を、context/送信準備に必要な最小限の型として読む。追加getUser・JWT独自検証・通知token比較は行わない。
- SDK通知はuser/期限だけを受け取り、新しいgenerationへ反映する。callbackからSDKを再呼出ししない。TOKEN_REFRESHED等の同一userの更新も旧contextを無効化する。
- 処理中に来た通知は最後のuser/期限だけを保留する。token・session本体を保留しない。同一userなら期限/tokenの厳密一致を要求しない。後続通知が別user/session消失なら、古いlogin/restore完了でD05へ進めない。
- 既存ownerの認証失効・別user通知では旧draft/snapshotを新userへ引き継がない。同一user再認証まで操作停止する。明示logout成功でowner対応を解除する。
- 操作開始時は旧contextを無効化し、SDK待機中の二重操作はbusyとする。dispose後の遅い完了・通知は反映しない。
- getState/getContext/isCurrentで期限切れを検出した場合と、現在のC04要求が失効を認定した場合は操作を停止する。独自refresh/retry/pollingを追加しない。
- prepareRpcはSDK getSessionで現在の資格情報を取得し、owner/generation/期限を送信前に再確認する。1回限りのtransport、wasSent、古いcontext拒否を維持する。ここでもgetUserは呼ばない。
- 表示購読は非同期・解除可能。低いgeneration、購読例外、dispose後の通知を製品操作の許可として利用しない。

RLS・auth.uid()・RPC内所有者確認・直接DML禁止はDB側の既存契約を維持する。SQL/RLS/GRANTは変更しない。C04の正式8 RPC・引数・HTTP/schema/owner/要求照合・revision/requestId/conflict/UNKNOWN・自動再送禁止も維持する。Auth側の簡素化をRPC側へ拡張しない。

## 製品UIとD05/C05

- 未ログイン→local、login成功→既存D05/C05を通ってcloud、logout→local。
- dirty/UNKNOWN/保存中の離脱保護、cancel時のtarget/draft保持、busy時の操作抑止を維持する。
- 通常review2製品UIのloginは一覧限定。新規・保存済み編集ではdirty/cleanを問わず非活性表示し、古いclick/form送信も現在画面から拒否する。認証画面とlogout回復は維持する。自動restore等のcancel後に必要なcloud再開は一覧でのみ表示・実行する。常設のlocal/cloud選択・手動restoreボタンは復活させない。
- 保存先表示は「現在の保存先：ローカル（未ログイン）」「現在の保存先：クラウド（ログイン中）」「現在の保存先：ローカル（ログイン中）」。
- Auth失効時は既存C05契約どおりcloud選択とdraftを保持し、cloud操作を停止する。通常の明示logoutとの違いを維持する。
- local/cloud同期・転送・暗黙fallbackを追加しない。UNKNOWNを成功扱いしない。

## SDK生成・build・終了

`product-cloud-app.ts`が1つのSDK/sessionを所有し、同じsessionをC04/C05/製品UIへ注入する。通常local/保守buildはAuth/cloud混入拒否を維持する。dev-sandboxのcloud候補は実行時publishable key入力後にだけSDKを生成し、自動restoreが通信を開始し得る。通常起動は `npm run preview:product-cloud`、実通信の個別承認前には起動/接続しない。

Browser Auth専用入口のloopback＋Permit制約は維持し、製品へ転用しない。既存のHTTPS/top-level/page検査、固定接続設定、秘密キー拒否も維持する。

SDK 2.119.0の型・既存の限定locks debugパッチ・生成物検証は変更しない。debug/logの安全性を維持し、バージョン変更は行わない。終了はsessionのcontextと購読を直ちに失効させ、SDK initialize後のdisposeを冪等なPromiseで所有する。Storageデータを独自に巻き戻したり削除したりしない。

## 取得済みHuman診断証拠とtransportのoffline切り分け

旧Auth方式でHumanが承認済みの1回の診断から得た証拠：

`login-start → checking → transport-exception → password-auth-rejected → blocked`

旧safeFetchのpassword要求境界で停止し、追加session/getUser/owner照合には未到達。通信上限超過のコードはなく、password誤り・HTTP status・ネットワーク原因のどれとも断定しない。

旧方式のoffline合成83件では、通信例外/timeout、redirect/応答URL、本文/JSON失敗で同じ列を再現した。正常JSONの400/401等、SDK側schema拒否だけではこの列にならなかった。具体的実原因は未確定のまま、オーナー判断で追加細分化を停止しSDK標準方式を採用した。旧方式専用試験は現行Authの成功条件として残さない。

診断欄がPCフッターに隠れる問題もあった。固定コードは回収済みで、一時診断自体を撤去する。実施日時・ブラウザ・応答内容は推測しない。旧診断の承認は今回の実Auth/RPC/DB/cloud writeの承認へ流用しない。UAT-05はFAIL/停止中を維持する。

## offline AI Gate

新仕様では、SDK標準login/session復元/refresh/local logout、user変更・失効・旧generation・遅い完了・購読解除、D05/C05とC04のデータ保護、秘密値非混入を検証する。旧safeFetch/Storage allowlist/token厳密照合を守るだけの試験は整理する。

今回の結果：全Vitest59ファイル1,972件、Playwright83件、typecheck、local/cloud buildはPASS。詳細は[UAT正本](HUMAN-UAT-v1.1.0.md)の今回のAI Gate記録を参照。実通信・Human UATは実施していない。SDK標準へ変更したことだけを根拠に実ログイン成功やUAT-05 PASSとはしない。
