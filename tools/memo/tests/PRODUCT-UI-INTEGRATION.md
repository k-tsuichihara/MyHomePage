# TypeScript製品UI統合：最初のlocal接続単位

R02の最初の実装単位として、公開切替前に製品用composition rootとブラウザ保存境界を整備する。正式根拠はReview8、既存の移行・保存・編集契約、`RELEASE-TRANSITION.md`である。

## 今回接続する範囲

- `product-local-app.ts`は、既存の移行controller、local store/controller、移行UI、メモUIだけを組み立てる。移行診断がreadyで、通常loadにも成功するまで操作UIを接続しない。
- `product-browser-local.ts`はHTTPS・top-level・secure context・既存`tools/memo/memo.html`パスを確認してからブラウザAPIを取得する。旧キーは読取専用、新キーだけを書込可能とし、他のStorageキーへアクセスしない。
- `build:product`はlocal製品入口を`.product/memo-app.js`へ生成する。Auth、Supabase、cloud、readonly trial、外部依存がbundleへ混入した場合は成果物を書かず失敗する。

## 今回は切り替えないもの

公開`memo.html`は引き続き旧`js/memo.js`を参照する。旧タブ併用、実ユーザーデータ移行、公開資産の版固定、停止保守版、音声入力の未達を解消・承認する前に公開入口を差し替えない。生成した`.product`はGit管理・Pages配信対象にしない。

C03の実Auth、C04の実HTTP・single-rpc認定、C05の製品UI切替も未結線のままとする。local/cloud間の自動同期・転送・fallbackは追加しない。

## AI Gate

- 製品ブラウザ境界が不正URL・非secure・frameをStorage取得前に拒否すること。
- project siteのpath prefixを許容しつつ、旧新2キー以外を読まず、旧キーを一切書かないこと。
- 移行readyと通常load成功後だけUIを接続し、disposeを伝播すること。
- product bundleにAuth／cloud／Supabase等が含まれないこと。
- typecheck、全Vitest、`build:product`、`git diff --check`を実行する。実Storage、実Auth、実RPC、DB、Pages公開は行わない。

## 次の統合単位：未公開の製品HTML候補

`build:product`は`.product/site/tools/memo/memo.html`と相対参照のJS/CSSも生成する。公開HTMLのheader/footer・共通資産を保持し、main内部だけ既存メモUIのDOM契約へ接続する。現在は既存`tests/browser/preview.html`のmainを再利用し、DOM契約を重複管理しない。製品レイアウトの最終受入ではなく、将来の切替用候補である。通常の公開HTMLは変更しない。

追加CSSは`.memo-product`内だけに適用する。共通CSS/JSは元の相対参照を維持し、候補ディレクトリだけを単独デプロイできる完成パッケージとは扱わない。build成果物は引き続きGit除外である。

`product-html.test.ts`では生成HTMLの外枠・相対参照・ID重複・旧JS排除を検査し、Chromiumで実製品entry→composition→controller→合成Storageによる新規保存を検証する。全requestはrouteで合成応答または遮断し、実Storage/外部通信は使わない。

公開前の残条件は既存RELEASE-TRANSITION契約を維持する。未更新の旧タブは強制停止できず、旧キー変化の恒久照合方針は未確定。実移行前の原値保護・バックアップ・旧タブ終了案内、版固定/保守版、音声入力、Auth/cloud/UI接続は後続単位で扱う。旧公開版の個別/全削除と新版のゴミ箱/完全削除は同義ではない。音声は旧公開版にはなく、v1.1.0正式仕様の未達として残す。

## 製品候補の資産整合性

buildは製品JS・専用CSS2件のSHA-256を計算し、内容ハッシュ付きファイル名とSRIをHTMLへ設定する。同じHTMLが異なる内容の資産を受け取った場合はブラウザのSRI検証で拒否する。product entryは専用CSS2件のsheetと非空ルールをStorage取得前に確認する。CSS欠落・不一致では起動を停止し、JS欠落・不一致ではHTMLの「起動前」表示を維持する。共通CSS/JSはこの検査の対象外で、既存の相対参照を保持する。

Chromiumの合成応答で正常起動・CSS404・JS内容不一致・CSS内容不一致を検証し、異常ケースのStorage読取0件を確認する。buildは古いハッシュ資産を削除しないが、公開時の旧資産保管期間・配信手順・保守版は未確定である。SRIは配信元自体の侵害や正規の旧HTML再利用を防ぐ保証ではない。既に動作中の旧タブ停止、実データ移行承認、バックアップ/復旧を代行しない。

## 製品候補の読取専用バックアップ

通常load成功後、既存`createLocalBackup`と`mountBackupPreview`を製品compositionへ接続する。形式検証・共通ロック・全体出力・10 MiB・正常v3限定・旧キー/migration/ドラフト除外は[既存出力契約](LOCAL-BACKUP-EXPORT.md)を再利用する。起動や通常保存だけではバックアップを準備せず、準備とダウンロードはそれぞれ明示操作とする。v2は既存のv3-required表示で停止し、自動更新しない。

appのdisposeはバックアップUIへ伝播し、Blob URL解放・DOM除去・以後の準備拒否を行う。既に開始した読取の取消やOSへの保存完了は保証しない。Chromiumの合成Storageで製品entryから保存→バックアップ準備→ダウンロード→JSON内容/Storage無変更を検証する。移行前の旧原値バックアップ、v3導入、復元/回復UI、停止保守版は未接続であり、この出力だけで公開・実移行の保護完了とはしない。

## 新規利用のv3導入

2026-11-13の承認を受け、製品compositionは既存保存層に`initialVersion: 3`を渡す。両キー不在で初回の明示保存をした時だけv3を生成し、削除履歴を空配列で開始する。初回loadは無書込。既存v2は通常保存でもv2のままとし、旧キーがある場合は既存のmigration-required判定を維持する。不正値・pendingを新規領域と扱わない。

製品ブラウザ試験を空の合成Storage起点に変更し、初回保存v3→バックアップ取得を検証する。既存v2の明示更新・原値保護・移行後旧キー変更時停止は、承認済み方針に基づく次の実装単位であり未完了。新規利用対応を実ユーザー移行や公開承認と解釈しない。

## 既存v2導入の第一段階：原値退避

正常v2を読める製品候補では、v3バックアップの代わりに`createV2OriginalExport`を既存ダウンロードUIへ接続する。共通Web Locks、既存v2検証器、10 MiB制限、Blob検証・寿命・dispose処理を再利用する。新旧キーを取得して同じ値か再照合し、新キー原文字列と旧キー原文字列/nullを無加工でJSON文字列値として出力する。保存先の書込能力は持たない。pending・不正・v3は拒否する。

形式は`myhomepage.memo.v2-original`、exportVersion=1。通常バックアップとは異なる退避原本で、既存復元へ取り込めない。本文・旧値・migration情報を含む平文のため非公開保管を案内し、DOM/ログには原値を表示しない。準備・利用者のダウンロードクリックはOS保存完了の証明ではない。旧タブを閉じる案内も表示する。

これは明示v3更新の前提となる退避経路だけで、更新許可や保全完了フラグを発行しない。準備後の原値変化に対する更新直前再照合、更新確認・書込/読戻し・unknown、移行後旧キー変更時停止は次の結合した実装範囲。既存v2通常操作は現契約のままであり、移行完了とは扱わない。

## 既存v2導入の明示更新

`product-v3-upgrade.ts`が退避サービスの観測対象を内部に固定する。準備は保存完了認定ではない。利用者がファイル保存確認・旧タブ終了のチェックを入れて更新ボタンを押したときだけ、共通ロック下で新旧原値を再照合する。通常画面の離脱可否には既存navigation契約を使い、保存/確認/未解決要求中は開始しない。

既存v2検証器で再検証し、メモ・タグ・関連・migrationを保持、version=3と空deletedMemoIdsを既存v3検証器で構築する。書込直前と直後に新旧値を照合し読戻しを検証する。書込前拒否は再退避が必要。書込試行後例外/不一致はUNKNOWNで停止し、自動再送・自動巻戻しは行わない。現在値の明示再診断は過去要求の成功認定とは分離する。

成功後は同じ製品app寿命中のStorage読書き境界で旧キーを更新時の基準と比較し、変化が観測されたらstickyなlegacy-changedとして停止・要確認を表示する。常駐ポーリングや旧タブ封鎖は追加しない。操作がない間の即時検出、ABA、ブラウザ終了をまたぐ基準の永続保持は保証しない。UNKNOWNは通常Storage操作を拒否し再診断だけ可能。退避ファイルはv2原値の回収元として残し、既存新キーへ自動書戻ししない。

成功後は通常loadとv3バックアップへ接続する。実ユーザーでの更新・公開切替は未承認。AI Gateは合成Storageの二重更新/更新前変更/成功/書込後例外/読戻し不一致/UNKNOWN診断/旧キー変更停止と、製品Chromiumの退避→明示更新→v3確認を検証する。

退避再準備の開始時に更新UIの保存確認チェックを解除し、以前の退避対象への確認を引き継がない。明示更新開始から成功後の通常load・バックアップUI切替が終わるまでは、compositionのメモUI操作ポートが通常コマンドを拒否する。UIのfinallyで排他を解除し、更新成功後の再読込と通常保存の競合を防ぐ。

排他中もdraftコマンドは既存controllerへ通し、編集可能な欄への入力を保持する。保存・遷移の排他は維持する。バックアップ切替は通常コマンド後と更新後loadで共通化し、read=readyかつversion=3を確認したとき一度だけ行う。更新直後loadが失敗しても、後続loadの成功で復旧する。

## 製品候補の音声入力

Review8 §5の未達機能を`voice-input.ts`と製品UIへ接続する。一覧は新規音声メモ（端末日時の`音声メモ-YYYYMMDD-HHmm`）、詳細は既存edit操作へ移り、編集画面は現在のドラフトへ追記する。navigation/controllerとnormalizeMemoInputを再利用し、自動保存・RPCを行わない。ゴミ箱のedit拒否、確認中/書込中の開始抑止も既存境界に従う。

認識器は明示クリック後だけ生成し、日本語・非continuous・確定結果だけを扱う。一回の結果を一度だけ最新ドラフトへ追記し、編集セッション不一致・dispose/停止後の結果は捨てる。非対応・権限拒否/認識失敗・上限/入力条件違反は固定メッセージで通知し、元入力を保持する。認識失敗の自動再試行なし。録音や認識結果をログへ保存しない。

Web Speech APIのstart/abort/result/end契約は[公開仕様](https://webaudio.github.io/web-speech-api/)を参照。ブラウザの認識サービスが外部へ音声を送る場合があるため製品候補に案内する。AI Gateはfake認識器のみでマイク・実認識サービスを使用しない。非対応/失敗/超過/古い結果・二重開始と、Chromiumの製品詳細→音声追記→無書込→手動保存を検証する。実マイク・権限UI・実認識精度・OS IMEとの組合せは未検証でQ05へ引き継ぐ。既存隔離メモリUIには音声を接続しない。

製品の音声結果は編集UIの追記ポートへ渡す。フォーカス中も最新DOM本文へ追記してカーソル位置を保持し、通常のdraft通知でcontrollerと同期する。IME変換中は確定まで待ち、compositionendの最新入力を基準に再検証して追記する。編集セッション変更/dispose時は反映しない。合成compositionイベントで変換中結果→確定→追加手入力→保存の保持を回帰検証する。

## 製品候補のv3復元・単件回復

正常v3の通常load成功後（v2更新後のloadも含む）、既存`createLocalRestoreController`/`createDeletedRecoveryController`を製品の同一storeへ接続する。既存の追加型復元・単件回復UIを使用し、新しい復元形式・判定・状態機械は追加しない。ファイル解析・上限・行別診断・タグ変化・結果分類は[追加復元](LOCAL-RESTORE.md)と[単件回復](DELETED-RECOVERY.md)を正本とする。

単件回復は読取専用プレビューから1件ずつ新UUID・復元時刻・revision=1・lastRequestId=null・非ピン・通常メモとして作る。タグは既存storeが直前のID集合を照合し、不在タグを復活させない。書込後の再診断は新UUIDの作成確認を使い、タイトル等の完全一致へ戻さない。UNKNOWN/未保存確定などの既存判定、自動再試行なし、作成後の通常詳細と一時的な元プレビュー戻りを維持する。

製品compositionは通常編集/保存/確認中の開始を既存のcanStart契約で拒否し、復元と回復の処理・確認中は相互および通常操作を抑止する。UIのinert状態は既存値を保存して戻す。disposeで両UIを除去し、回復UIの描画監視を解除、以後のコマンド受付を止める。既に開始した保存の取消は保証しない。

Chromiumで製品の実entry→通常保存/バックアップ→完全削除→ファイルプレビュー（無変更）→単件回復/属性確認→通常詳細/元プレビュー→不正JSON拒否→追加型復元を合成Storageで検証する。タグ変化/未保存確定/UNKNOWN/再診断/上限/再試行なしは変更しない既存unit/integrationを全件回帰する。保存領域喪失時の初期復元、停止保守版、実ユーザー受入は今回の接続対象外。

## R02完了条件の棚卸しと最終local接続

2026-11-13時点で、正式仕様のlocal作成/編集/検索/タグ/ピン/ゴミ箱/複製/完全削除、音声、v3新規保存/v2明示導入、バックアップ、追加復元/単件回復は製品候補へ接続済み。残っていた初期復元と停止保守版を以下のとおり接続し、R02のlocal製品候補実装をCOMPLETEとする。旧版全削除とゴミ箱一括完全削除の意味の差は既存仕様どおりで、同じ操作へ置換しない。

- 初期復元：空として正常loadできた起動時に既存controller/UIを接続する。新旧キー両方不在の検査、原ID/日時/削除履歴、専用確認、UNKNOWN履歴・手動再診断・自動再送なしは既存store/controllerを再利用する。確認/処理/UNKNOWN中は通常操作と他復元を抑止。成功後は通常loadとv3機能へ接続。disposeでUI/inertを解放し以後の受付停止。既に開始した書込取消は保証しない。
- 停止保守候補：`build:product`が`.product/maintenance/tools/memo/memo.html`を別途生成する。同じ公開パスへ切り替える場合の候補であり、今回配信しない。ビルド時定数で保守entryに固定し、実行時URL等から通常版へ切り替えられない。既存ブラウザ/資産境界と`createLocalDataStore.load`を再利用し、書込を拒否するStorageで正常v2/v3件数または停止案内だけを表示する。移行/復元/編集/自動修復は提供しない。

AI Gate：製品Chromiumの両キー不在→プレビュー/確認まで無書込→明示初期復元→正常v3、保守候補の表示/操作ボタンなし/無書込を検証。失敗/UNKNOWN/履歴保持/競合等は既存初期復元unit/integrationの全回帰を再利用する。

R02 COMPLETEは製品候補の実装・オフライン確認の範囲であり、公開完了ではない。R03の実データ導入・旧タブ案内、R04の公開構成/本番設定確認、R05の実切替・保守版配信/再開承認、C03〜C05のAuth/cloud製品接続、S04/Q04/Q05の権限/実環境/受入は未完了。旧資産を今回削除せず、公開時の保管・停止先・再開判断は既存RELEASE-TRANSITION契約に従う。

## Q04 Step 4 第1単位：注入sessionの製品候補UI接続

`createProductLocalApp(doc, deps, views, session?)`の第4引数へ既存sessionを注入できる。`product-session-ui.ts`はAuth型だけを参照し、SDK/Storage/fetch/RPCを生成しない。通常の`product-entry.ts`はsessionを渡さないためlocal-onlyのままで、Auth/cloud/SDKのbundle混入拒否は変更しない。R02の追加hardeningではなく、後続の製品Auth接続単位である。

- 注入時だけAuth sectionを作成し、初期restoreを1回要求。ログイン/明示復元/logoutを既存sessionへ委譲し、通知payloadではなく`getState()`の現在値から固定文言を描画する。低いgenerationは反映しない。表示はcloud書込許可ではない。
- logoutは現在/保持中editorへ既存`requestNavigation`を適用。editor外のタグ操作等のrejected/unknown/unresolvedも、既存controllerのnavigateと共有する`appDepartureReason`で確認対象にする。dirtyだけでなくrejected/unresolved/savingを既存契約へ委譲し、確認時に現在app参照・Auth generation・`confirmNavigation`を再検査する。通常保存や移行/復元の処理中も確定しない。cancelはAuthを呼ばず、local状態・ドラフトを変更しない。続行しても、このlocal-only単位はlocal editorを自動破棄しない。
- appは注入sessionを所有し、disposeでUI購読解除→session.disposeを一度だけ実行する。共有sessionを二重所有させない。遅い完了・通知やdispose後操作ではDOMを復活させない。非同期終了例外もログへ出さない。実SDK所有物の終了は後続factory接続時に合わせる。
- email/passwordは入力欄以外のDOM本文/属性/ログ/結果へ転記せず、操作開始時とdispose時に欄を空にする。UIはawait中も資格情報参照を継続保持しない。JavaScriptメモリの完全消去は保証しない。user ID/token/期限/生理由/例外は描画せず、秘密値を生成物へ埋め込まない。
- 保存先表示は常に「ローカル（クラウド未接続）」。認証成立をcloud利用可能と表示しない。cloud切替・RPC・転送・fallbackなし。正式仕様§1.1のログイン/復元時の切替はC05の次接続単位に残す。

AI Gateは既存製品候補HTMLを生成し、scriptだけを試験用注入entryへ差し替える。既存`createMemoAuthSession`＋合成MemoAuthApi、メモリStorage、実製品composition/default viewsを使い、外部requestはroute拒否。通常entryの安全条件・SRI/資産拒否は既存product-html回帰で維持する。実SDK生成・実Storage・実fetchは使わない。

追加Chromium11件：復元/ログイン/失効案内、古い通知、scope local logout、dirty cancel/状態不変、編集/保存開始/Auth世代変更後の古い確認拒否、clean rejected/unresolvedでの確認、二重操作、購読失敗、解除/dispose/遅い完了、secret非出力、Auth未注入と注入時のlocal保存。既存controller/navigation/Auth回帰を再実装せず、UI/hostの接続を検証する。

P2回帰として、editorなしのタグ保存rejected/unknownの2件を追加（Chromium計13件）。両ケースでcancel後のapp全体不変、確認後reloadによる古い確認拒否、再確認続行時だけlogout、追加Storage書込/実fetchなしを確認する。

追加P2では初回migrationの`running`もlogout抑止に含めた。既存controllerの状態を正本とし、移行・復元・単件回復・初期復元・通常操作の非同期開始/終了（例外終了を含む）でAuth UIを再描画する。v3更新のbusy通知でも再描画し、別の処理状態は複製しない。合成ロック待ちによる旧移行/pending復旧・追加型復元/単件回復・初期復元の診断/確認/cancelの5件を追加（Chromium計18件）し、処理中のlogout拒否と終了後のボタン復帰を確認した。実Storage・実通信は使わない。

第1単位時点の未結線：製品SDK生成・Auth専用実Storage/環境設定/通信境界、C04 controller/senderの製品操作接続、C05保存先反映、実Auth/実RPC・single-rpc。第2単位の接続範囲は以下を参照。loopback＋Permit境界、SDKパッチ、製品build拒否、公開memo.htmlは変更しない。

## Q04 Step 4 第2単位：注入C04 load / C05保存先選択

`createProductLocalApp(doc, deps, views, session, cloud?)`の第5引数に、生成済みの`StorageTargetController`と、同じsessionに結び付けた既存C04 controllerの`load/dispose`だけを注入する。sessionは既存の`getContext/isCurrent`を提供する。同じ所有者のsession/C04と初期localのC05を、このapp専用に生成済みであることが注入側の契約。採用後はappが所有し、外部から保存先を変更したりcontrollerを他操作と共有したりしない。sessionまたはcloud hostが未注入（context APIなしを含む）の場合は従来local-onlyを維持し、未採用のhostは呼び出さない。

- 保存先の正本はC05の`current()`だけ。製品compositionはその値を直接見てlocal操作を許可/拒否する。別のtarget状態機械は作らない。
- 認証成立だけでは切替・RPCを開始しない。この読取接続単位は明示的な保存先選択を扱い、`request/confirm/logout`へ既存navigationの判定を渡す。dirtyは既存`isDirty`、editor外のrejected/unknown/unresolvedは共有`appDepartureReason`、saving等は既存controllerの状態を参照する。確認はapp参照・Auth世代・navigation ticketとC05のrevisionに結び付け、cancelでは変えず、編集/保存開始/認証更新後の旧確認を拒否する。
- cloudへ変更された場合だけ、現在の`getContext/isCurrent`を通じたcontextを既存C04 `load`へ1回渡す。同じ保存先の再選択や状態通知で再送しない。再読取はlocalへ明示的に戻してから再選択する。処理中の再cloud選択は拒否し、local選択/logoutによる離脱は既存確認後に可能。
- C04の所有者照合・世代検証・送信能力・C01応答検証を再実装しない。製品表示への反映だけを、選択時のC05状態オブジェクトと現在contextに結び付け、切替前/旧認証世代/終了後の応答を表示しない。Auth通知はgetState再取得の契機であり、RPC認可ではない。
- 同じuserの検証済みcontext更新は`acceptAuthenticatedGeneration`へ委譲し、cloud選択とdirtyを保持。失効や異なるuserの認証ではcloudのまま同一user再認証を案内し、localへfallbackしない。内部のuser IDは照合にだけ使いDOM/ログへ出さない。再認証で自動loadしない。
- cloud選択中はlocalメモ/移行UIをinertにし、viewのdispatch・復元/回復・backup準備・upgrade入口でもlocal操作を拒否する。local draftはメモリに保持するがcloudへ渡さない。cloud選択はlocal成功を意味せず、UNKNOWNでもlocalへ書き込まない。明示logoutだけは既存離脱確認後にC05でlocalへ戻し、session.logoutへ委譲する。
- cloud表示は読取中、成功時のメモ/タグ件数、停止、UNKNOWNの固定文言だけ。raw例外/応答、資格情報、token、user IDを表示しない。cloudのメモ一覧/詳細/編集やwrite RPCはまだ接続しない。
- disposeでUIのイベント/購読を解除し、sessionを終了。load待機中は結果を捨て、既存C04のbusy契約に従ってPromise終了後にcontrollerをdisposeする（強制終了/追加通信なし）。

AI Gateは既存の製品候補Chromium fixtureへC03 session・C04 controller・C05を注入し、RPC senderだけを合成化する。15件を追加（session関連Chromium計33件）：初期local/明示cloud/load1回、未認証拒否、未注入local、cancel保持、古い確認、saving、editor外失敗、同一user世代更新、失効、logout、切替前/旧世代/終了後応答、二重要求、通信失敗/未認定応答/拒否、secret非露出、local書込fallbackなし。合成応答の`single-rpc`は既存C01成功分岐を試すfixture値であり、実経路の認定ではない。

追加P2回帰2件（Chromium計35件）：cloud切替確定時にはdefault製品viewの`stopVoice`から既存voice.stopを呼び、停止ボタンを含むlocal UIをinertにする前に認識を停止する。cancelでは停止せず、停止後の旧callbackは既存epoch検証で無視し、localへ戻った後は明示的に再開できる。custom viewが音声を提供する場合も返却disposerのstopVoiceを接続する。認証所有者の比較・保持にはAuth層と同じ`uuidKey`を使い、UUIDの大文字小文字差だけで別user扱いしない。合成認識器と実C03/C05＋合成senderで、停止/late result遮断/再開、表記差を伴う世代更新/再選択load、write/fetchなしを確認した。

第2単位時点ではcloud一覧/詳細・writeは未接続。通常product entryは引き続きsession/hostを生成・注入しない。C04/C05/Authのruntime実装は型参照だけに留め、build混入拒否とCSP、loopback＋Permit境界は維持する。実環境操作・Human Gateは別承認であり、今回要求/実行しない。

## Q04 Step 4 第3単位：検証済みsnapshotの読取専用一覧・詳細

`ui/product-snapshot-view.ts`はC04 loadの`completed/result.ok/value`だけを受け取る。C01で検証・所有者除去・変換・凍結済みのdomain値を再利用し、raw responseの変換/検証は複製しない。通常メモとゴミ箱内のメモをsnapshotの順に一覧表示し、1件選択でタイトル・本文・通常/ゴミ箱の固定表示・既存タグ名を閲覧できる。戻る操作以外に詳細の操作はない。高度な一覧/並替/ページングは追加しない。

- snapshotは現在の表示のメモリだけに保持。local controller/Storageへ渡さず、保存/複製/キャッシュ/同期しない。cloud選択中のlocal操作拒否と音声停止は第2単位のまま。
- 保持の有効性はload時の既存C05選択オブジェクトとC03 `isCurrent(context)`で判定。Auth/target/generationをrendererの別状態機械へ複製せず、製品hostの現在性predicateを渡す。
- Auth通知/現在値確認による失効・認証世代更新、実際の保存先変更、再load開始、購読/現在値取得失敗、disposeでsnapshot参照と一覧/詳細DOMを破棄する。期限到達の検出は既存C03に従い、追加timer/pollingなし。一覧→詳細/詳細→一覧の操作時にも現在性を再検査し、通知前の期限到達でも操作を拒否する。
- 同じcloud選択のno-opはsnapshotを破棄せず、再loadもしない。選択を変えた場合と区別する。別loadの一覧を、取り外された旧ボタンから開くことも表示ticketで拒否する。
- pending load後のtarget/Auth変更・disposeでは第2単位の応答遮断を維持。UNKNOWN/failed/denied/stale-responseは一覧を表示しない。失効はcloud選択/local draftを維持し、表示データだけを破棄する。認証復帰だけでsnapshotを復活/自動再loadさせない。
- DOMへ出す値は検証済みのタイトル・本文・タグ名と固定文言だけ。全てtextContentで描画し、HTMLとして解釈しない。ユーザーが書いた本文自体は閲覧対象である。内部のメモ/タグ/user/request ID、revision、raw JSON/headers、認証情報/例外はDOM/属性/URL/ログへ転記しない。選択は表示内の添字とticketで行い、ID入りリンクも作らない。

AI Gate：同じ製品候補HTML・C03/C04/C05・合成sender fixtureへ12件追加（Chromium計47件）。複数メモ/ゴミ箱/タグ/HTML風本文、一覧↔詳細、local復帰とdraft/Storage不変、Auth失効/世代更新/logout/disposeと旧ボタン、通知前の期限到達、成功後の再load失敗/未認定/権限拒否/不正応答、同じcloud選択no-opを確認。既存pending load後のlocal/generation/dispose回帰3件も実データ入りの合成snapshotへ更新し、旧結果を表示しないことを確認する。単一RPCの合成成功は実経路single-rpc認定ではない。

第3単位時点ではcloud writeは未接続。第4単位の単件編集/save/resolve接続は以下を参照。実通信/Human Gateは実行しない。

## Q04 Step 4 第4単位：既存cloudメモ1件の編集・保存・明示照合

`ProductCloudHost.controller`に既存C04のsave/resolveを任意で注入できる。両APIと既存のcreateId/getContext/isCurrentが揃う場合だけ、正常な現行snapshotの通常メモ詳細に編集ボタンを提供する。ゴミ箱メモ・失効snapshot・旧ボタンからは開始しない。未注入の場合は第3単位の読取専用UI、session/host未注入なら従来local-onlyのまま。

- `product-cloud-editor.ts`は同時に1つのcloud editorを所有する。既存createEditor(source=cloud)/editDraft/beginSave/isDirtyとnavigationのrequest/confirmを再利用し、local controller/Storageとは分離する。タグは取得済み関連を固定し変更UIを作らない。内部ID/revision/requestIdはメモリの要求だけに使い、DOM/URL/ログへ出さない。
- 入力は保存開始時の既存整形/検証を通し、不変attemptを既存C04 saveへ一度渡す。入力中・保存中の追加編集は消さず、二重保存と保存中の切替/logout/編集終了を抑止する。C05のdirtyと離脱確認にはcloud editorも加え、確認後の編集・保存結果・Auth世代変更で旧確認を拒否する。editor外失敗、migration/復元busy等の既存判定は維持。
- C04/C01の検証済みsavedだけが、送信rawDraftのbaselineと返却revisionを既存editor接続関数で更新する。独自の競合判定/revision加算はしない。成功表示は「保存要求の成功」であり現在snapshotの証明ではない。編集開始時に旧snapshot表示を破棄し、保存後に楽観的書換・自動loadをしない。現在内容の確認は既存の明示保存先再選択/loadで行う。
- conflict/rejectedは成功にせずdraft保持。UNKNOWNと送信後stale-responseは不変attemptとC04が発行したpending handleを対応付けて保持する。新しいsave/自動retry/自動resolveは行わず、「保存結果を照合」の明示操作だけで元要求をC04 resolveへ渡す。
- resolve no-recordは結果不明のまま、未実行証明にしない。savedだけ元attemptを解消し、削除済みreceiptでは削除済みの事実を表示して復元しない。同一userの検証済み再認証後も元pendingに対して明示resolveできる。C04によるowner照合を緩めない。
- 保存先/Auth世代/編集sessionが古い成功は反映しない。保存中の追加編集と保存先変更を混同しないため、製品選択ticketは実際の選択変更/再loadでのみ失効させ、編集状態の鮮度は既存editor参照で別に検査する。Authの正当性は既存isCurrentに委譲する。
- cloud draftはタブ内に保持し、失効/別userでは入力欄を空・無効にする。同じuserで再認証した場合のみ再表示する。保存先を明示localへ戻してもlocal draftへ転送しない。cloud pendingが残る間は別メモの編集で上書きしない。
- `app.dispose()`はcloud save/resolve中にbusy、未解決attempt/pendingが残る場合にpendingを返し、UI/購読/Authを終了しない。既存C04のbusy/pending契約を強制突破しない。実際にappliedで終了した後は旧DOM操作から再送しない。タブ/ブラウザ終了を越えたdraftやpendingの永続化は保証しない。

AI Gate：既存の合成senderにmemo_save/memo_resolve_requestだけを追加し、C03/C04/C05・生成製品HTMLを共有するChromium15件を追加（計62件）。既存1件編集/保存、conflict/permission/UNKNOWN、明示resolve(saved/no-record/削除済みreceipt)、二重送信/保存中離脱、送信中の追加編集保持、Auth失効/世代/target変更後の旧結果、旧snapshot/ゴミ箱編集拒否、dirty logout確認鮮度、再認証後照合、applied dispose後の旧操作拒否、秘密値非露出/local write/fetch0を確認する。editor純粋回帰1件も追加し、local結果との混同と旧session結果を拒否する。

P2回帰4件追加（Chromium計66件）：画面の鮮度と元要求の確定結果を区別する。stale targetのsave completedは元attemptと検証済み結果を保持し、C04 handleを持たないまま永久停止させない。resolveがhandleを閉じた終端diagnosedも捨てずに保持する。同一userでの再選択後、「保存結果を照合」の明示操作で保持したC04結果を追加通信なしで回収する。回収前に自動成功表示せず、回収後も確認するのは元要求の成否だけ。save成功/競合とresolve saved/削除済みreceiptの4分岐で、draft保持・再送0・local write/fetch0・閉鎖済みhandleへのresolve再送0・dispose復帰を確認する。no-recordは従来どおり生存handleと不明を保持する。

第4単位時点ではcloud新規は未接続。第5単位の接続範囲は以下を参照。実通信・Human Gate・cleanupは実行しない。

## Q04 Step 4 第5単位：cloud新規メモ1件の作成・保存

save/resolve注入済みのhostだけに「クラウドに新規メモ」を提供する。cloud選択中、現在のC03 contextがC05のAuth generation・選択時ownerと一致し、処理/確認待ちや既存editorがない場合のみ開始する。local/未認証/失効/別user/読取中は開始しない。write host/session未注入なら従来経路のまま。

- 既存cloud editorの開始処理を共通化し、新規の場合だけ既存createIdからメモUUIDを生成する。空title/body/tagIdsとexpectedRevision=nullは既存createEditorに委譲する。メモUUIDは編集開始時に固定し、保存/照合や入力拒否で自動変更しない。requestId/operationIdは従来どおりbeginSaveへの明示保存要求時にcreateIdから渡す。
- title/bodyが共に空なら既存beginSaveで送信前拒否、本文のみなら既存normalizeMemoInputで「無題」となる。UIに別の入力仕様を作らない。新規専用のeditor/save/resolve/競合/revision/retry状態機械は追加しない。
- 第4単位と同じC04 save/resolve・editor結果接続・navigation/C05を利用する。新規saveはexpectedRevision=null、成功応答はC01がrevision=1等を検証する。UNKNOWNでは元request/メモUUID/pendingを保持し、別UUIDの新規要求に置き換えない。明示resolve、no-recordの扱い、削除済みreceipt、P2で修正した確定結果回収も共通。
- 開始時にsnapshot表示を破棄するが、新規メモを楽観追加しない。保存成功後も自動loadなし。確認するのは元要求の適用であり、現在snapshot全体の証明ではない。localへの転送/保存/fallbackは行わない。
- dirtyでlocal切替/logout/編集終了する場合は既存確認を使用し、cancelで保持する。save/resolve中は二重操作・離脱・disposeをbusyで拒否、不明はpendingを維持。失効時はcloud選択とdraftを保持して入力を空・無効にし、同一userの有効な再認証後のみ再表示/照合する。別userへdraftを引き継がない。
- 新規UUID/requestId/revision/Auth情報はDOM/属性/URL/ログへ転記しない。通常product entry、C04/Auth/C05本体、build拒否、CSP、loopback＋Permit制約は変更しない。

AI Gateは既存fixture/Chromiumケースを既存編集・新規で共通化し、24ケースを追加（計90件）。createIdの呼出しと固定UUID/expectedRevision=null/tagIds=[]、入力整形、保存成功、conflict/rejected/UNKNOWN、元要求の明示resolve/no-record/削除済みreceipt、二重送信/離脱・dispose抑止、dirty確認、Auth/target変更後の旧応答、stale確定結果回収、同一user再認証と別user拒否、dispose後旧操作、秘密値非露出を確認する。新規作成の追加ケースではlocal write/fetch0、RPCは明示load/save/resolveだけ。fixtureの単件save応答を新規expectedRevision=nullにも対応させ、C01/C04の検証をそのまま通す。

第5単位時点では状態変更は未接続。第6単位は以下を参照。実環境操作/Human Gateへは進まない。

## Q04 Step 4 第6単位：通常cloudメモ1件のゴミ箱移動

changeStateと既存createIdを注入したhostだけ、現在有効なsnapshotの通常メモ詳細へ「ゴミ箱へ移動」を提供する。既存の操作確認方針に合わせ確認/キャンセルを経由し、確認時もsnapshot token/leaseを再検査する。ゴミ箱メモには提供しない。

- C03 context/C05 generation・owner・選択と既存snapshot現在性を再利用する。memo ID、expectedRevision、createId由来requestIdを開始時に固定し、正式action `trash` で既存C04 changeStateへ一度だけ渡す。Auth・競合・結果分類はC04/C01を正本とし、別のrevision/競合/retry判定を作らない。
- 開始時にsnapshot全体を失効させる。対象行だけの楽観削除/書換えはしない。成功は状態変更要求の成功だけであり、現在値には明示再読取が必要と案内する。自動load/retry/pollingは0。削除済みreceiptを現在の移動成功にしない。
- conflict/rejectedは成功にしない。C04のunresolved/stale-response等は元要求と返却結果を保持する。専用resolveは存在しないためsave/resolveを流用せず、UNKNOWNとして停止する。不明を未実行と解釈しない。不明保持中は新たなcloud編集/作成/状態変更を開始しない。明示保存先変更/logoutは既存C05のunknown離脱確認へ委譲する。自動fallbackなし。タブ寿命を超える保持は保証しない。
- 処理中は既存host busyに含め、二重操作・保存先変更/logout/disposeを拒否する。不明保持中のdisposeはpending。Auth失効/世代変更/別user/保存先変更/失効snapshotの旧応答は現在成功へ反映しない。操作確認の古いボタンもsnapshot token/leaseで拒否する。
- local controller/Storageへcloudデータを渡さない。内部memo ID/revision/requestId/owner・raw例外はDOM/URL/ログへ出さない。未注入hostは既存read/edit/create/local-onlyを維持する。通常entry/build拒否/CSP/Permitは変更しない。

AI Gate：既存C03/C04/C05・合成sender・生成製品HTMLを共有するChromiumに19ケース追加（計109件）。確認/キャンセル、要求構成、changeState単独注入、成功/競合/拒否/通信例外/unverified/不正応答/削除済みreceipt、二重操作とbusy終了拒否、Auth/世代/target/snapshot変更後の旧応答、別userを含む古い確認ボタン、秘密値非露出/local write/fetch0を確認する。全Vitest 56ファイル/1719件、typecheck、diff検査PASS。

未接続：cloud復元/完全削除/タグ変更/一括操作、実SDK/実Auth Storage/実transport、通常entry注入・公開、実製品Auth/RPC/RLS、single-rpc認定。次の最小候補は既存changeStateによる単件復元のfake製品接続（別承認）。実通信/Human Gate/cleanupは行わない。
