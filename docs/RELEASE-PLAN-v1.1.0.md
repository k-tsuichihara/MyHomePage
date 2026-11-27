# メモツール v1.1.0 リリース進捗管理

**メモツール Ver.1.1.0 リリース完了。R04／R05 COMPLETE。** PR #137マージ後の公開後Human確認結果に基づき、先生が最終判定した。Q05 COMPLETE、UATはPASS8／FAIL0／NOT STARTED0／SKIP2、O01〜O05 COMPLETEを維持する。未確認・延期事項と今回限りの残存リスク許容は下記へ引き継ぎ、完了を全技術課題の解消とは扱わない。[UAT正本](../tools/memo/tests/HUMAN-UAT-v1.1.0.md)参照。

### 最新確定結果：公開後Human確認・R04／R05 COMPLETE

- PR #137：マージ済み。承認済みheadは`ab9befccc46a6f5d83669a2637046fbd2d1b087b`、マージコミットは`cb408e3dfa16f28f9074d0a0ba040163203b113c`。今回のGit読取でorigin/mainへの反映も確認。
- GitHub Pages配信：Human PASS。
- 公開版起動・画面・既存ローカルデータ・共通メニュー等：6項目Human PASS。
- 本番ログイン・クラウド保存先切替・読取：6項目Human PASS。
- 配信資産・Console・更新後画面：3項目Human PASS。
- 上記のオーナー報告を根拠に、先生がR04／R05 COMPLETE・Ver.1.1.0リリース完了と判定。個別15項目の未報告内訳・実施時刻・ブラウザ等は推測しない。AIが公開ブラウザや本番サービスを再検証した結果ではない。
- **本番書込・削除・他ユーザー分離の実環境検証は今回未実施。** devでの既存検証、本番DBのRLS/権限カタログ確認、本番login/readのHuman PASSで、これらまで実環境検証済みとは認定しない。

**残存リスク・延期事項**：Playwright CLI終了処理は未解決。SQL事前隔離検証・異常分岐検証は未実施の履歴を維持。生成JSの空白警告5か所を含む今回限りのオーナー許容は、全Gate PASS・製品影響なしの証明や恒久的な基準緩和ではない。実スマホ・実音声は未確認の承認済みSKIPとして公開後確認へ、single-rpc／完全provenance認定は延期。T02完全性証明は未確認のまま延期し、監査・ACL原本はオーナーが非公開保持、廃棄しない。

**公開後へ引き継ぐ未解決P2**：[PR #137 CodexReview](https://github.com/k-tsuichihara/MyHomePage/pull/137#discussion_r4720402317)の製品build入力テンプレート問題。公開memo.htmlの置換後、build-product.mjsが同ファイルをproductHtml()へ渡す一方、旧scriptタグが必須のため、次の製品buildは停止する構造を静的確認済み。通常公開版の今回のHuman PASSとは区別し、後続修正/preview/再build前に公開HTMLと未加工テンプレートを分離する対応を別途判断する。今回の文書PRでは修正・再build・試験を行わず、未解決のまま記録する。

以下のSTEP 1〜4の未実施・判断待ち記述は、公開前の各段階の履歴として保持する。最新の完了判定は本節と進捗表を優先する。運用はO02〜O05の受入済み方針を継続し、将来の停止・保守版配信・データ復旧・再公開には個別判断が必要。


### R04最新進捗：本番DB適用・事後確認完了

次のレビュー済み成果物の整備完了を記録する。
| PR | 完了内容 |
| --- | --- |
| #132 | 本番適用SQL・事後確認SQLの整備 |
| #133 | 本番接続設定の最小実装（offlineでは合成設定のみ使用） |
| #134 | 本番preflight SQLの整備 |
| #135 | preflight結果を単一表へ統合 |
| #136 | verifyを単一表へ統合し、通常テーブル種別/実行主体所有を検査 |

**Human報告を根拠にR04の本番DB適用・事後確認を完了とする。** k-life-logでproduction_apply.sql全体の実行成功、production_verify.sqlは24行すべてPASS、checked_rows=23 / failed_rows=0。PostgreSQL17.11・UTF8・実行主体postgres。5テーブル・12関数・RLS・権限・policyを確認済み。Project Ref/URL一致・Publishable key存在のHuman確認も維持し、値や未報告の実施日時は記録しない。AIによるDB接続/SQL実行・実Auth/RPC確認ではない。

**STEP 3完了状況**：実設定production build・環境変数解除はHuman PASS、成功buildの参照資産の静的確認は下記のとおり完了。生成物の起動・実通信・公開資産切替は未実施。R04全体は最終公開前ゲート等が残るため完了扱いにせず、R05は未着手を維持する。

### R04 STEP 3：本番build Human PASS・生成資産の静的確認

Human報告：初回はURL形式不正でbuildが停止し、URL末尾修正後の`npm run build:product-production`は正常終了。先生は本番buildをHuman PASSと判定。環境変数解除確認は両方Falseで、解除もHuman PASS。実値・未報告日時は記録しない。

AIは今回の成功buildの既存成果物だけを読み取り、再buildせず確認した。

| 静的確認項目 | 結果・証拠 |
| --- | --- |
| HTML/JS/CSSと参照 | HTMLと参照するJS1件/CSS2件が存在。各資産のSHA-256がファイル名・HTMLのSRIと一致し、crossorigin=anonymousを確認。CSS2件は現在のソースとバイト一致 |
| Auth/RPC/CSP | CSPのconnect-srcとbundleのMEMO_RPC_ORIGINが一致。本番形式・dev以外を確認。同じ定数をAuth client生成とRPC senderへ渡す既存compositionと照合。実接続先がオーナーの意図したprojectかの根拠は既存Human設定確認であり、今回の静的照合だけでprojectの実設定を再検証したものではない |
| dev/合成設定・入口 | 現行4資産にdev origin・既知合成URL/キー/資格情報を検出せず。本番入口はコンパイル済みのif(true)で通常製品compositionへ進む。dev setup定義/公開exportと到達不能else内の呼出は残るが、本番入口から実行されない。残存だけを理由とする修正なし |
| SDK/manifest | 既存verifyAuthArtifactが終了コード0でPASS。SDK/Auth 2.119.0、原本patch条件、bundle SHAとmanifestを照合。HTML参照のハッシュ付きJSもmanifest対象の非ハッシュJSとバイト一致 |
| 混入確認 | 配置候補4件に診断・既知fixture資格情報・sourcemap参照・secret key/秘密鍵/JWTのリテラルを検出せず。意図したpublishable keyは公開設定としてJSへ含まれる。静的パターン検査は任意の秘密情報の完全不存在証明ではない。manifest/非ハッシュJS/試験資産/profile/ログ/環境ファイルは配置対象外 |
| 共通資産 | 既存rootのstyle.css、bootstrap-4.0.0.css、jquery-3.5.0.min.js、popper.min.js、menuScroll.js、shared-menu.jsへの相対参照が解決。共通資産変更なし。CSS2件に外部HTTP URL参照なし。実ブラウザの描画・公開後配信は今回未確認 |

Pagesへの配置候補は`.product/production/site/`内の次の4件だけ（既存の同じ相対パスへ配置する想定、今回は置換しない）。

- `tools/memo/memo.html`
- `tools/memo/js/memo-app.cb3bb2b8513726a2ff3106b8a751390b9a8c1ae6f6e4727339d6ccf1ecf641b7.js`
- `tools/memo/css/memo.d61bc29140fe59e9755c9f04b265ca0cef48e283bd4c5469e1460b27112b9747.css`
- `tools/memo/css/memo-product.94c5b054af9ed71dcbe149adc0f4b7942799e77d623ad4938e1daedfca67af9e.css`

出力siteには現行HTMLが参照しない旧ハッシュJSが1件残存する。内容の採用・削除は行わず、ディレクトリ丸ごとの配置を避け、上記4件に限定する。候補確認は公開・実Auth/RPC成功の証拠や公開承認ではない。次は最終公開前判断と、別途承認された場合の資産切替。Playwright CLI終了処理、SQL事前隔離検証の未実施、公開後の実スマホ/実音声等の既知事項は維持する。

### R04 STEP 4：公開準備Draft PR・最終判断待ち（公開前の履歴）

**オーナー明示承認（PR #137最終差分レビューPASS後）**：O02〜O05の以下の運用方針と、R04残存リスクの今回限りの許容を受領。O02〜O05は運用方針整理・受入の範囲で完了。R04は保守候補の特定を含む準備事項が揃い、本追記の先生最終レビューとオーナーの公開判断だけを残す。R04全体を独断でCOMPLETEにせず、R05の切替・公開後確認も未実施のまま維持する。

- O02：運用担当はオーナー。異常時は操作・書込を停止し、データを削除せず、復旧・再開は個別判断。既存の停止保守表示と下記の配置手順を再利用し、新規監視/運用機構は追加しない。
- O03：下記の利用者向け注意事項を受入。今回、暗号化・自動バックアップは追加しない。
- O04：監査・ACL原本はオーナーのみがGit管理外の非公開領域で保持継続。T02完全性証明は未確認のまま延期し、原本は廃棄しない。これは完全性確認済みや破棄完了の認定ではない。既存S04契約どおり、完全ACL復元等の将来堅牢化へ引き継ぐ。AIは原本へアクセスしない。
- O05：実スマホ・実音声は未確認のまま公開後確認。single-rpc/完全provenance認定は延期。Playwright CLI終了処理等の技術課題も未解決として残し、次版の詳細設計は行わない。
- R04：Playwright CLI終了処理未解決、SQL事前隔離検証・異常分岐検証未実施、生成JSの空白警告5か所をオーナーが今回に限り許容。解消/全Gate PASS/製品影響なしの証明や、将来のGate基準緩和ではない。公開操作の実行承認とは分離する。

**O03：利用者向け注意事項（受入済み）**

- バックアップは暗号化されていない平文JSONです。個人情報を含み得るため、安全な場所に保管し、不用意に共有しないでください。
- localの保存済みデータが対象です。未保存入力・cloudデータのバックアップにはなりません。
- ダウンロード操作だけで保存完了とは判断せず、ファイルの存在を確認してください。
- バックアップ後の変更は戻りません。初期復元はバックアップ時点の削除履歴までで、作成後に失われた履歴は回復できません。追加復元はバックアップ側の削除履歴を取り込まず、現在の既存データ・削除履歴を保持します。

**O02：既存保守版候補・配置方法（特定済み、今回は未配置）**

既存local buildが生成する`.product/maintenance/tools/memo/`のmemo.htmlと、そのHTMLが参照する次の3資産をひと組の候補とする（基準ディレクトリはtools/memo）。既存ファイルの読取照合で存在・SHA-256/SRI一致、参照JSとmaintenance-app.jsのバイト一致、コンパイル済み保守分岐を確認。再build/起動/追加試験は行っていない。

- `memo.html`
- `js/memo-app.c7341b4c34205619f6e3ff4268b227229e05cb5cafae49153caacfa5725a58e1.js`
- `css/memo.d61bc29140fe59e9755c9f04b265ca0cef48e283bd4c5469e1460b27112b9747.css`
- `css/memo-product.94c5b054af9ed71dcbe149adc0f4b7942799e77d623ad4938e1daedfca67af9e.css`

停止時にオーナーが切替を個別承認した場合だけ、この4件を同じ相対パスの公開tools/memo/へ配置する追加commit/PRを作る。CSS2件は本番候補と同じハッシュなので再変更不要、保守JSを追加しHTMLを保守版へ置換する。HTML/資産のバイト・SRIを保持し、ディレクトリ内の過去ハッシュ群を丸ごと採用しない。共通資産と旧資産は維持する。Pages main/rootへのマージが配信へつながるため、切替前にオーナーが承認する。

保守版は既存loadによる正常v2/v3の件数/停止案内のみで、Storage書込を拒否し、編集・移行・復元・自動修復を提供しない。cloud Auth/RPCを開始する版ではない。配信切替だけで既に開いている通常版タブを強制停止できるとは保証せず、オーナーは通常版タブでの操作停止・未保存内容の扱いを確認する。候補は現在Git管理外に存在するため、切替判断時に上記ファイルが失われていたり不一致なら停止し、推測で旧版へ戻さない。保守版の配信・データ復旧・通常版再開はそれぞれ個別判断とする。

先生はSTEP 3の静的確認を承認し、STEP 3完了。STEP 3に列挙した本番成功buildの4ファイルだけを作業ブランチの公開用パスへバイト同一で配置した。memo.htmlの従来URLを維持し、旧memo.js/旧CSS・共通資産・他ツールは変更/削除しない。未参照旧JS・manifest・非ハッシュbundle・試験資産は配置対象外。配置後も3資産の参照、SHA-256ファイル名、SRI、共通資産参照を確認。再build・ブラウザ起動・実Auth/RPC・DB操作は行わない。公開キーは配信に必要な公開設定としてJSへ含まれるが、値は本文へ転記しない。

本PRは公開準備であり、R04全体の完了・公開承認ではない。Pagesはmain/root配信のため、オーナーによるマージが公開へつながる点を最終レビューで確認する。mainへの直接push・AIによるマージ・公開切替は行わない。

配置後のGit indexでも参照3資産のSHA-256/SRIと成功buildとのバイト一致を確認。git diff --checkは生成JSに元から含まれる5か所のtrailing whitespaceを検出して終了コード2。成功buildの指定資産を変更しない条件に従い、空白除去・再build・ハッシュ変更は行わない。文書差分のdiff checkは別途確認し、この生成物の検出を無条件PASSにしない。

**公開後の代表確認（別途承認後）**：従来URLのHTTPS起動、HTML/JS/CSSの同じ版の配信・SRIエラーなし、共通メニュー/他ツールへの導線、local既存データ保持・基本表示を確認する。本番login→cloud保存先表示→既存データ読取は実Auth/RPCの明示承認範囲で確認し、write/削除は含めない。実スマホ/実音声は既存の公開後引継ぎとして扱い、SKIPを自動PASSにしない。UAT全体の再実施は要求しない。

**問題時の停止・復旧**：起動/資産不一致、Auth/所有者境界の異常、データ不整合等を観測したら操作・書込を止め、自動再試行や暗黙fallbackを行わずオーナーへ報告する。対象版と影響を確認し、承認後に既存のv2対応保守版へ切り替えるか、問題が配信資産だけなら本PRの公開4ファイルだけを既知の直前版へ戻す追加commitをレビューする。ハッシュ資産とHTMLは同版の組として扱い、共通資産や無関係な変更を巻き戻さない。旧版へのコードrollbackはv2/cloudデータの復旧・移行ではなく、旧版から新版データは扱えない。保守版の準備/配信も今回の自動実行対象外。localStorage/profile/バックアップ/DBを削除・初期化せず、SQL/RLSを戻さず、データ修復と書込再開は別途判断・承認する。詳細の安全方針は[既存切替設計](../tools/memo/tests/RELEASE-TRANSITION.md)を参照し、その旧時点の未実装記述と現在のQ05 COMPLETEを混同しない。

Playwright CLI終了処理課題は未解決で、全Gate正常終了や製品影響なしとは断定しない。過去の限定例外は今回の公開判断に自動適用しない。SQLの本番適用前の隔離エンジン検証未実施等の残存リスクも維持し、先生レビューとオーナーの公開判断を待つ。UAT集計はPASS8/FAIL0/NOT STARTED0/SKIP2のまま。

**残存リスク**：適用SQL全体を本番実行前に隔離SQLエンジンで検証していなかったこと、および独立した異常/ロールバック分岐のエンジン検証未実施を維持する。今回のHuman本番適用・verify成功は実行結果の証拠だが、過去の未実施検証を実施済みへ書き換えない。Playwright CLI終了処理課題、実スマホ/実音声の公開後引継ぎ、single-rpc/完全provenance未認定・延期も維持。今回の記録更新は追加実行・公開の承認ではない。

以下のSTEP 1〜適用手順案は当時の状態・判断履歴。未実行/未確認/未承認との記述を、上記の最新Human完了結果と混同しない。

### R04 STEP 1：公開環境のHuman確認結果（当時の記録）

オーナー報告：GitHub PagesはDeploy from a branch / main / /(root)、独自ドメインなし、HTTPS有効。本番Supabaseはk-life-log、Healthy、Email認証有効。メモ用テーブルは存在しない。RPC/RLS/GRANTは未確認。これはHumanの実設定確認結果であり、AIによる外部接続・SQL実行の結果ではない。公開URLの実表示・配信内容、本番メモDB適用は今回未確認/未実施。

次はSTEP 2の本番接続・DB準備の範囲/適用順序をレビューする。既存の開発schema→review8競合patch→S04 helper権限制限を根拠に、対象名衝突・pgcrypto配置・必要権限を本番適用前に確認する。本番実行の承認はまだない。既存読書管理/Auth/データへの変更は対象外。dev-sandbox候補の入口・固定origin/CSPを、本番の同一固定接続設定へ最小限整合する必要がある。既存Q04/Q05の再実施は要求しない。

### R04 STEP 2：本番適用候補と接続設定案（当時の未実行・実装前記録）

- SQL候補：[新規導入・単一transaction](../tools/memo/doc/v1.1.0/memo_v1_1_production_apply.sql)、[適用後の読取専用確認](../tools/memo/doc/v1.1.0/memo_v1_1_production_verify.sql)。原本3ファイルのSHA256を記載し、schema本文→競合6関数patch本文→S04 DOを再利用。原本は変更しない。pgcrypto作成/移設は除き、既存extensions/digestの所属・権限が正しい場合だけ進む。PostgreSQL17/UTF8、対象名不存在、実行主体権限を事前確認し、対象表RLS/権限・RPC等をCOMMIT前確認。seed/読書管理/Authユーザー/既存データの変更なし。SQL自身はprojectを証明しないので実行前にオーナーがk-life-log/Project Refを照合。ファイルはREVIEW ONLYでDB実行・構文実行検証はしていない。
- 接続設定の実装案（今回は実装しない）：新しい本番buildモードだけでMEMO_PRODUCTION_SUPABASE_URL / MEMO_PRODUCTION_SUPABASE_PUBLISHABLE_KEYをbuildプロセスから取得し、未設定/不正なら失敗。本番Project Refのオーナー確認後に固定originを確定し、dev originを拒否する。同じ検証済みoriginをAuth/RPC/CSPへ注入。キーはsb_publishable_のみを受け、secret/service_roleを拒否。公開キーは配信JSから読める公開設定であり秘密と扱わない。値をログ・Gitへ保存しない。
- 予定変更箇所：build-product.mjs（本番モード/公開設定検証/CSP）、cloud-rpc-sender.ts（本番build時だけ固定originを注入、dev defaultを維持）、product-cloud-app.ts（本番のみdev入力画面なしで既存composition生成）、product-entry.ts（本番分岐）、package.json（本番buildコマンド）、既存build/entry/sender回帰。Auth SDK・C03/C04/C05・SQL/RLS/保存契約は変更不要。設定欠落はdevへfallbackさせずbuild失敗。preview:product-cloudは既存dev挙動を維持する。
- 今回はSQLファイル作成・静的照合と案の記録だけ。本番実行、本番設定実装、実通信、追加テスト基盤、commit/push/公開は未承認。適用後確認は5表/12関数/RLS/最小権限のカタログだけで、ユーザー行やRPCを実行しない。devの既存監査/Q04/Q05は再利用し、本番への適用結果とは区別する。

### R04 STEP 2：本番接続設定の実装（合成設定のみ・未公開）

build:product-productionで公開URL/キーをbuild時注入し、本番入口ではdevキー入力UIを使わず既存の通常login/session復元へ接続する。本番候補の出力は.product/production、local/dev cloudの成果物・previewは既存のまま。設定不足/不正/dev originはbuild失敗、Auth/RPC/CSPは同一origin固定。SDK/認証・D05/C05・永続化・C04/RPC仕様・SQLは変更なし。

本番Project RefとURLの一致・Publishable keyの存在は、その後のHuman確認で報告済み（値は記録しない）。実build/試験は合成URL/公開キーのみで、実設定のbuild注入・接続は未実施。実設定使用・公開は別途承認。詳細は[製品UI統合契約](../tools/memo/tests/PRODUCT-UI-INTEGRATION.md)のR04節。関連回帰9ファイル/443件＋SDK標準Auth/通知/RPC境界3ファイル/29件、計472件PASS（終了コード0）。typecheck・local/dev cloud/合成本番候補build・dev/本番SDK成果物検査・diff check PASS。本番入口2件と不正設定拒否15件を追加し、devの既存14件もPASS。全Vitest/Playwright CLI・Human UATの再実施は今回行わない。前節の実装案/未承認記述は提案時の履歴であり、今回承認範囲はこの実装とoffline検証まで。Q05 COMPLETE/実スマホ・実音声の延期/CLI既知課題は維持。

### R04 STEP 2：本番適用前の確認準備（当時の未接続・未実行記録）

[最小読取専用preflight](../tools/memo/doc/v1.1.0/memo_v1_1_production_preflight.sql)をproduction_applyの事前条件から作成。単一結果表の5行すべてpassed=true、行5のcollision_count=0（衝突時はdetails.objectsに対象名/種別）を期待する。従来の判定条件は維持。旧版では権限7項目だけをHuman確認した。その後、PR #135の単一結果表版をHumanが本番で実行し、先生は全5項目PASSと判定。詳細は次節。projectの識別はSQLで代用せず、オーナーがk-life-logのGeneralのProject RefとProject URLのhostを照合。API Keysでは同じprojectのsb_publishable_キーであることを確認し、値をチャット/Gitへ転記しない。anon JWT/secret/service_roleだけしかない場合は設定を変えず報告する。本番設定確定・キー取得/利用は別途承認。

現環境のPATHにpsql/postgres/initdb/dockerは見当たらず、既存Pythonのpglast/pg_queryもなし（起動/接続なしで可用性のみ確認）。既存dev-sandboxはメモ構築済みで、新規適用候補の衝突停止が想定される。それを全体エンジン検証PASSに数えず、ガード解除・既存表DROP・既存dev再構成は行わない。既に所有する空の隔離Supabase互換環境があるかは未確認。あれば対象/実行方法を別途承認し、候補全体/transaction/事後ガードを検証する。なければエンジン検証未実施の残存リスクを先生・オーナー判断へ戻す。新基盤を自動追加しない。

停止条件：project/キー種別が不明、不一致/非publishable、PostgreSQL17/UTF8以外、pgcrypto配置/所属不一致、必要権限不足、対象オブジェクトあり、結果欠落/NULL/エラー、同時DDL/権限変更、本番適用の個別承認なし。自動補完/GRANT/再試行なし。今回の成果物は確認準備だけで、読取SQL実行も承認していない。

### R04 STEP 2：本番preflight Human PASS・適用手順案（当時の適用未承認記録）

オーナー報告を根拠に先生が全5項目PASSと判定：k-life-log、PostgreSQL17.11/UTF8/read_only=true、execution_role=postgres、Supabase前提すべてtrue、pgcryptoすべてtrue、権限7項目すべてtrue、衝突0件/objects=[]。Project RefとURLの一致・Publishable keyの存在もHuman確認済み。値・未報告日時は記録しない。AIによる接続/SQL実行ではない。これは本番適用や実Auth/RPC成功の証拠ではなく、production_apply全体のSQLエンジン検証は依然未実施の残存リスク。

**別途先生・オーナーの実行承認を得た場合の最小手順：**
1. Supabase SQL Editorでk-life-log/確認済みProject Refと実行role postgresを照合。同時DDL/権限変更がない時間枠で、レビュー対象commitのapply/verifyを固定する。preflight後に環境変更や対象名出現があれば停止して再判断する。
2. [production_apply](../tools/memo/doc/v1.1.0/memo_v1_1_production_apply.sql)全体を新規queryに貼り、選択範囲実行ではなくBEGINからCOMMITまで1回だけ実行する。schema→競合patch→S04を別々に実行しない。成功表示・エラーなし・COMMITまでの正常完了を確認してから次へ進む。成功表示だけで最終PASSにしない。
3. 同じproject/roleで[production_verify](../tools/memo/doc/v1.1.0/memo_v1_1_production_verify.sql)全体を別queryとして1回実行する。5表RLS有効、12関数/owner/search_path、8 RPCのauthenticated EXECUTE、直接DML/anon/PUBLIC/helper権限、3読取policyの所有者条件をファイル末尾の期待値と照合する。全結果を取得できなければ未確認として停止（SQL Editorが最後の結果だけを表示する可能性あり）。本番実Auth/RPC/writeは含めない。
4. apply正常完了かつverify全結果一致の場合のみ「DB構造/権限適用と読取確認PASS」。URL/キーの実build注入、公開切替、実Auth/RPC受入は別の操作・承認とする。

**エラー/結果不明時：** 最初のエラーで停止し、再apply・部分再実行・自動GRANT・DROPを行わない。未COMMITの同一transaction/セッションを保持できている場合はROLLBACKで取消す（実行承認範囲に含めておく）。SQL Editorの別Runが同一セッションとは仮定しない。接続切断や応答欠落でCOMMIT成否が不明なら、別セッションのROLLBACKで取消済みと扱わず、適用済み/未適用を断定しない。記録を残し、別途承認した読取確認で現在状態を確認してから判断する。COMMIT後のverify不一致はROLLBACKでは戻らないため停止し、対象限定の修正方針を再レビューする。既存読書データ・Auth・メモ表を推測で削除/復旧しない。

今回行うのは結果記録と手順整理だけ。適用SQL/verifyは未変更、SQLエンジン検証や新環境構築を追加しない。DB接続/SQL実行/実設定注入/公開/commit/pushは行わない。Q05 COMPLETEと既知CLI課題・延期事項は維持する。

### UAT-07表示修正：Playwright終了処理の未解決課題

今回のoffline Playwrightは初回・許可された1回の再実行とも83件のテストがPASS。初回のコマンド終了コード1の原因は未確定。再実行もテスト後にpreviewサーバーが残り、手動停止後のネイティブ終了コード取得値が空だったため、コマンド正常終了は未確認。後片付け後の該当Playwright/previewプロセス・4173番待受の残存はなし。終了コード取得・previewサーバー終了処理を未解決の技術的課題として残す。製品不具合と確定したわけではなく、製品への影響が完全に否定されたとも扱わない。

オーナー承認の先生判断により、今回の表示修正に限って上記制約を明示したDraft PR化を許可する。全AI Gate PASSとは扱わず、恒久的なAI Gate基準の緩和でもない。追加再実行・原因調査・終了処理修正は今回行わない。当時のUAT-07残確認はダイアログ表示受入・logout承認・local復帰・データ分離だった。現在はPR #130後のHuman確認で再login finding・データ分離もPASS、07正式PASS。PASS8/FAIL0/NOT STARTED0/SKIP2。現在はPR #131後の先生完了承認によりQ05 COMPLETE。終了処理課題は未解決のまま。

### PR #131マージ・Q05完了時の限定例外判断

先生はPR #131レビュー・Human受入と取得済み試験を根拠に、Playwright CLI終了コード/preview終了処理の未解決を明示したうえで、今回のマージ・Q05 COMPLETEを承認した。課題解消・正常終了・製品影響なしを証明したものではない。過去例外の自動適用・恒久的Gate緩和・公開承認にはしない。次の公開判断時もこの未解決事項を提示する。

### Q05完了後の引継ぎ（実行はまだ承認しない）

| 対象 | 残作業 | 必要なオーナー判断 |
| --- | --- | --- |
| R04（完了） | 本番DB適用/事後確認・本番build/資産確認・運用方針/限定リスク許容を経て、公開後Human結果に基づき先生がCOMPLETEと判定 | 未解決課題・延期は最新確定結果へ。将来の本番操作は個別判断 |
| R05（完了） | PR #137マージとPages配信、公開版/本番login/read/資産のHuman PASSに基づき先生がCOMPLETEと判定 | 本番write/削除/他ユーザー分離の今回実環境検証は未実施。将来の停止/復旧は個別判断 |
| O02/O03（完了） | オーナー担当の停止/個別復旧、既存保守候補と配置方法、平文/履歴等の利用者案内を確定 | オーナーが受入済み。実切替・復旧は別途承認。新機構なし |
| O04（完了） | オーナーのみの非公開保持継続・廃棄なしを確定。T02完全性は未確認のまま延期 | 原本へのAIアクセスなし。完全性証明を完了した扱いにしない |
| O05（完了） | 実スマホ/実音声は公開後確認、single-rpc/完全provenanceは未認定延期。CLI等の課題を維持 | 引継ぎ方針はオーナー承認済み。未確認項目をPASSと扱わない |
| S05（保留） | 将来オブジェクトのdefault権限対応は保留を維持。本番公開前の権限レビューはR04へ | 新規追加の有無と対応要否。今回SQL/RLS/GRANT変更や再監査は承認しない |

R02/R03/Q04/Q05の既存COMPLETEとO01〜O05 COMPLETEを維持する。R04/R05も公開後Human結果と先生判定によりCOMPLETE。実利用データ移行はリリース条件外。今後は記録済みの未解決/延期事項を引き継ぎ、必要な変更・本番操作を個別判断する。

## Q04：v1.1.0最小応答受入の承認済み変更

厳密single-rpc認定・完全response provenance証明は未認定のまま延期し、v1.1.0公開条件から外す。製品senderの既存HTTP安全検査を通過した`validated-http`を既存adapterのschema/所有者/要求照合へ接続する。`unverified`を無条件に成功へ変更せず、既存Auth/権限/競合/UNKNOWN/無再送/local分離を維持する。詳細・AI Gate方針は[応答受入契約](../tools/memo/tests/SINGLE-RPC-ACCEPTANCE.md)冒頭を正本とする。

本変更のAI Gate・レビュー・マージ後は、既存S04/Q04-READ/Case13/Case6 PASSとオーナー報告の実製品login→D05→UNKNOWN→logout観測を再利用し、Q04を必要十分な技術ゲートとして閉じられる状態を目標とする。現時点ではレビュー待ちで、実snapshot正常応答を認定したものではない。主要操作、実session運用、実マイク等の製品受入はQ05/UATへ渡す。R03/Q05/R04/R05・公開承認は別工程。以下の厳密認定をリリース必須とする記述はこの承認で置き換える。

Q04/C03〜C05のrepository準備：同じproduct-entryから実SDK/session→既存authenticated sender/C04/C05→製品UIを組み立てるcloud候補buildを追加。通常local/保守buildの拒否境界は維持し、実行時key入力・専用Auth Storage・既存SDK patch・固定dev origin/8RPC境界を使用する。生成HTMLから実SDK＋合成HTTPをAI検証し、実Supabase/Auth/RPC/DB/SQL通信は0。**repository側の実製品接続準備はAI完了候補、機能未結線B=0を維持**。実受入/response provenance/single-rpc/C03〜C05/Q04全体/R03/Q05/R04/R05は未完了。[製品UI契約](../tools/memo/tests/PRODUCT-UI-INTEGRATION.md)冒頭を現在の正本とし、以下のlocal-only記述は通常build/各時点の履歴と区別する。

Q04 Step 4 D05：login/restoreのapplied＋有効なC03 contextを既存C05 requestDeparture/request/confirmへ接続。dirty/UNKNOWN確認cancel保持・accept時だけcloud移行、起動local初期化との順序、古い認証完了の拒否をfake製品検証する。**Review8既知fake/offline未結線B=0、製品接続フェーズ完了候補**。C03〜C05/Q04全体は進行中、通常product entryはlocal-only、実接続/実環境受入・single-rpcは未完了。実通信/DB操作/cleanupなし。[製品UI契約](../tools/memo/tests/PRODUCT-UI-INTEGRATION.md)D05最終棚卸しが現在の正本で、以下のB件数は履歴。

Q04 Step 4 B3：既存voice-input/音声UIをcloud新規・既存・複製editorへ共有接続。日本語/本文追記/同一clockタイトル/上限拒否/手動保存・失効後の旧結果遮断をfake検証する。音声はAI完了候補。ただし最終棚卸しでReview8 §1.1 D05のlogin成功/session復元後cloud選択がhostへ未結線と判明したため、**B=1、fake/offlineフェーズは閉じない**。次候補は既存C05離脱経路への配線で、今回未着手。C03〜C05/Q04全体は進行中、実製品接続/受入・single-rpc未完了。実通信/DB操作/cleanupは0。[製品UI契約](../tools/memo/tests/PRODUCT-UI-INTEGRATION.md)B3最終棚卸しを正本とし、以下の残件数は履歴として区別する。

Q04 Step 4 B2：通常cloudメモ詳細の独立した複製操作を、既存createDuplicateEditorとcloud新規editor/save/resolveへfake製品接続。title/body/tagIdsだけを未保存の新規draftへ渡し、pin/元ID/revision等は引き継がない。複製時のwrite/追加read/local writeは0。B2はAI完了候補、既知のfake/offline未結線はB3 cloud音声入力のみの候補。C03〜C05/Q04全体は進行中、実通信/DB操作/cleanupは0、single-rpc未認定。[製品UI契約](../tools/memo/tests/PRODUCT-UI-INTEGRATION.md)B2節を現在状態の正本とし、以下の残件数は履歴として区別する。

Q04 Step 4 B1：cloud一覧へ既存queryMemos/countTagUsageとListContextの表示文脈を接続。文字検索/タグOR＋文字AND/正式並替/pin安定順/使用件数、同snapshotのdetail往復条件・scroll保持をまとめてfake製品検証する。通常とゴミ箱は分離し、新snapshot/所有境界で状態を破棄する。表示変更のRPC/local writeは0。B1はAI完了候補、fake/offline既知残件はB2 cloud複製・B3 cloud音声の2群。C03〜C05/Q04全体は進行中、実通信/DB操作/cleanupは0、single-rpc未認定。[製品UI契約](../tools/memo/tests/PRODUCT-UI-INTEGRATION.md)B1節を正本とし、以下のB=3記述は履歴と区別する。

Q04 Step 4第13単位：cloud editorのタグ割当を既存Draft/editDraft/beginSave/C04 save/resolveへfake製品接続。snapshot tags/memoTagsから候補と初期選択を固定し、新規editorも同じUIを共有する。resolveは元凍結要求tagIdsを使い、追加RPC/自動補正/再送/local writeなし。最終静的棚卸しではB=3機能群（cloud一覧の検索/絞込/並替/ピン優先等、cloud複製、cloud音声）が未接続。fake/offlineフェーズを閉じず、C03〜C05/Q04 Step 4は進行中。実通信/DB操作/cleanupは0、single-rpc未認定。[製品UI契約](../tools/memo/tests/PRODUCT-UI-INTEGRATION.md)第13単位のA/B/C/Dを正本とする。

Q04 Step 4第12単位：既存changeStateでcloud通常メモ単件pin/unpinをfake製品接続。pinnedAtから明示ボタンを選び、固定ID/revision/requestId/actionの正式4引数だけを使用する。trash/restoreと既存busy/UNKNOWN/離脱境界を共有し、snapshotを失効して明示再読取を案内。fake/offline製品残機能はcloudメモ編集時のタグ割当変更。C03〜C05/Q04 Step 4は進行中、実通信/DB操作/cleanupは0、single-rpc未認定。[製品UI契約](../tools/memo/tests/PRODUCT-UI-INTEGRATION.md)第12単位を正本とし、以下のpin未接続記述は過去の履歴と区別する。

Q04 Step 4第11単位：既存C04 deleteTagによるcloudタグ単件削除をfake製品接続。対象ID/名前/revisionを一段確認し、正式RPCのp_id/p_expected_revisionだけを送る。関連メモrevision更新・関連解除は既存SQLの責務でUIに追加しない。requestId/ledger/resolveなし。既存busy/uncertain/離脱契約を共有しUNKNOWNは保持、新cloud writeを停止する。C03〜C05/Q04は進行中、実通信/DB操作/cleanupは0、single-rpc未認定。[製品UI契約](../tools/memo/tests/PRODUCT-UI-INTEGRATION.md)第11単位を正本とし、以下のタグ削除未接続記述は履歴として区別する。

Q04 Step 4第10単位：既存C04 saveTagによるcloudタグ単件作成/改名をfake製品接続。新規はcreateId1回/expectedRevision=null、改名はsnapshotのID/revision、正式RPCはp_id/p_name/p_expected_revisionのみ。既存normalizeTagName/adapter返却検証/uncertain operation/離脱契約を再利用し、requestId/ledger/resolveは追加しない。成功は要求単位、snapshotを失効し明示再読取を案内する。C03〜C05/Q04は進行中、実通信/DB操作/cleanupは0、single-rpc未認定。[製品UI契約](../tools/memo/tests/PRODUCT-UI-INTEGRATION.md)第10単位を正本とし、以下のタグ作成/改名未接続記述は履歴として区別する。

Q04 Step 4第9単位：既存C04 emptyTrashによるcloudゴミ箱一括完全削除をfake製品接続。件数付き一段確認後、固定したゴミ箱ID/revision集合だけを正式RPCのp_ids/p_revisionsへ渡す。requestIdは既存C04内部用、RPC追加/ledger/resolve新設なし。既存adapterの要求件数一致検証を使用し、UNKNOWNは保持して新cloud writeを停止。snapshotは失効し明示再読取を案内する。C03〜C05/Q04は進行中、実通信/DB操作/cleanupは0、single-rpc未認定。[製品UI契約](../tools/memo/tests/PRODUCT-UI-INTEGRATION.md)第9単位を正本とし、以下の一括削除未接続記述は過去の履歴と区別する。

Q04 Step 4第8単位：ゴミ箱内cloudメモ1件の完全削除を既存C04 deletePermanentlyへfake製品接続。不可逆確認後のみ実行し、RPC引数はp_id/p_expected_revisionの2つだけ。既存C04内部requestIdをRPCへ送らず、ledger/resolveを新設しない。要求成功だけを表示しsnapshotを失効、UNKNOWNは保持して新cloud writeを停止。C03〜C05/Q04は進行中、実通信/DB操作/cleanupは0、single-rpc未認定。詳細は[製品UI契約](../tools/memo/tests/PRODUCT-UI-INTEGRATION.md)第8単位。以下の完全削除未接続記述は第7単位以前の履歴として区別する。

Q04 Step 4第7単位：ゴミ箱内cloudメモ1件の復元を既存changeStateの正式action `restore` へfake製品接続。PR #89のtrash経路と要求保持/busy/UNKNOWN/旧応答遮断を共通化し、操作確認後だけ実行する。成功は要求単位のみ、snapshotは失効し明示再読取を案内する。local write/実通信/DB操作/cleanupは0。C03〜C05/Q04は進行中、single-rpc未認定。接続範囲の正本は[製品UI契約](../tools/memo/tests/PRODUCT-UI-INTEGRATION.md)第7単位。以下の第6単位以前の復元未接続記述は履歴として区別する。

Q04 Step 4第6単位：通常cloudメモ1件のゴミ箱移動を既存C04 changeStateへfake製品接続済み。操作確認・busy/離脱抑止・旧応答拒否・UNKNOWN保持を既存C03/C04/C05へ委譲する。snapshotは楽観更新せず失効し、明示再読取を案内。製品Chromium109件を含む全1719件/typecheck/diff検査PASS。実通信・DB操作・cleanupは0。C03〜C05/Q04全体は進行中、通常entry/実製品受入・残りwrite・single-rpcは未完了。以下の第5単位時点の状態変更未接続記述は本追記で更新する。詳細は[製品UI契約](../tools/memo/tests/PRODUCT-UI-INTEGRATION.md)第6単位を参照。

本ファイルを、メモツールv1.1.0の開発からリリースまでの進捗管理の正本とする。仕様・安全契約・監査原本の正本を置き換えるものではない。

初期整理日：2026-11-07。コード・文書の基準main：`8eadc3145c1b42021c45b61cf4c7cc4fab82ce95`（PR #46マージ後）。GitHubのマージ済みPR #1〜#46、既存ソース・テスト定義・契約文書、および今回までのオーナー報告を照合した。今回はテストを再実行していない。

## 現在位置と公開までの推奨順序

- 現在：**STEP 04 / Q04 Step 4第5単位のcloud新規メモ単件作成・save/resolve**。PR #83で確定したStep 3のS04差分確認は完了。S04適用・Q04-READ・ケース13/6を再実行しない。R02はCOMPLETE。
- PR #84〜#87のAuth/load/C05・snapshot・単件編集とレビュー修正を引き継ぎ、新規メモ1件の作成/save/明示resolveを同じcloud editorでfake Chromium検証。通常entryは未注入local-only。実SDK/実Storage/実通信・cloud状態変更/削除/復元/タグ変更は未結線。Q04全体は進行中、single-rpc未認定を維持する。
- C03〜C05のUI非依存層は実装済みだが、実Auth・実HTTP・single-rpc認定・製品UI結線は未検証。C05では明示logoutとAuth失効を区別し、離脱可否は既存navigation契約を正本とする。
- R01は[PR #47](https://github.com/k-tsuichihara/MyHomePage/pull/47)で完了し、D05確定はPR #49、C03〜C05の通信なし境界はPR #50〜#68で段階的に整備した。今回R02へ着手したが、公開HTML・本番Auth・実ユーザーデータ・Pages公開には接続していない。
- 未決事項：Q05の正式検証範囲、製品Auth/session・cloud実経路・所有者/RLS境界・障害受入・single-rpc認定条件、公開前ゲート。S04適用成功と直接拒否・ケース13/6のPASSは記録済みで、S04差分確認は完了。ACL原本完全性・NOLOGIN用途等のUNKNOWNは保持するが、追加GRANT/完全復元を行わないS04の必須条件には戻さない。DB・本番操作の承認ではない。
- 導入時のSDK 2.111.0/2.119.0とTypeScript 7のWebAuthn/DOM型宣言衝突は、停止・報告後、オーナー承認のskipLibCheckで回避した。全.d.tsの内部型検査が省略される影響・見直し条件はAuth契約に記録。既存strict等は維持し、SDK 2.119.0の公開API型対応と通信なし26件を確認した。バージョン変更・追加緩和・実操作は別承認。
- PR #51マージ後、SDK import時のStorage probe/デバッグ参照を未許可起動ゲートが検出して停止した。PR #52では、supabase-js/auth-js各2.119.0固定・元SHA/パス/件数の検証付きでdebug初期化式だけをメモリ内置換。元SDK・ロック機構は不変。最終試験記録は全Vitest1,448件、パッチ23件、隔離Chromium11件PASS。import前のgetter取得と監視対象API呼出しを別々に0件確認し、旧成果物の検証失効も回帰試験済み。専用キー永続化、再読込/再起動、失効・複数タブ・実ロックを確認。過去の失敗profileは保全。詳細と未検証範囲はAuth契約を参照。
- 今回の状態購読・ライフサイクルは初回に合成試験24件を追加。レビュー後は再購読回帰2件も追加し、全Vitest1,474件・パッチ23件・隔離Authブラウザ11件を再確認。期限到達は現在値確認時に通知し、通知を認可判定へ転用しない。製品UI・実Authの未検証事項とE2E後処理の原因未確定・無介入完走未確認はAuth契約へ記録する。

以下の要否・スコープ・推奨順序は、PR #47マージ後のオーナーと先生の合意を反映する。既存40タスクのIDを維持し、必要と決定したことと作業完了を区別する。

| STEP | 作業 | 対象タスク |
|---|---|---|
| 01 | 進捗管理・残仕様の確定 | R01 → D05 |
| 02 | 認証・クラウド保存の統合 | C03 → C04 → C05 |
| 03 | TypeScript版の公開UI統合 | R02 |
| 04 | DB権限整理・結合テスト | S04・Q04 |
| 05 | 既存データ移行・受入テスト | R03・Q05 |
| 06 | 本番公開準備 | R04・O02・O03・O04・O05 |
| 07 | 公開切替・公開後確認 | R05 |

推奨順序であり完全な直列実行は強制しない。S04など独立した作業は並行可能。各実装時に必要なテストを実施し、Q04・Q05の最終検証は必要な製品統合後に行う。クラウド実接続・保存に関する既存の安全ゲートは、STEPの順序を理由に後回しにせず維持する。本番公開は必要な移行・セキュリティ・受入確認とオーナー承認の完了後に限る。依存関係に問題が判明した場合は、独断で順序を変えず理由と代替案を報告する。

公開方針は既存GitHub Pages版をv1.1.0で置き換えること。AIは実装・検証準備、人間は実データ保護・本番設定確認・公開承認を担当する。公開・データ移行・権限変更等の実行には操作ごとの別途承認が必要。

## 状態の読み方と運用

- ステータスは `未着手 / 進行中 / 完了 / 要確認 / 保留` の5種類。完了は各行に記した範囲の完了であり、隔離実装・過去の試験成功・公開・製品受入を同一視しない。
- 未着手は既存資料が後続工程として明記し、今回照合した実装にも接続がない範囲。事実を確定できないものは要確認とする。
- タスクの着手・完了・保留、PR完了による進捗変化、オーナーによる範囲/優先順位変更、次STEPへの移行時に本表を更新する。必要に応じて状態・現在STEP・次タスク・ブロッカー/未決事項を同期する。関連する進捗変更は原則として同じPRに含め、根拠・検証範囲・残課題も更新する。マージだけで未検証事項を消さない。
- 新規作業の確定追加、既存タスクの削除・スコープ変更はオーナー承認を必要とする。追加提案は末尾の別枠へ記録する。
- 各行の備考に今回承認された必要性・限定範囲を記す。明記のない項目の要否・リリース必須性を新たに決定せず、目標日や未決の詳細も推測しない。必要性の承認や掲載は、作業完了・個別操作の実行承認ではない。
- PRは [MyHomePageのPull Requests](https://github.com/k-tsuichihara/MyHomePage/pulls) を参照する。過去文書の「未実装」は当時の範囲として扱い、後続実装と区別する。README・正式仕様の履歴は今回書き換えない。

## 1. 要件定義・設計

| タスクID | 作業内容 | ステータス | 根拠となるファイル・PR | 備考 |
|---|---|---|---|---|
| D01 | Review8の入力・保存・移行・RPC契約の設計整理 | 完了 | [統合仕様](../tools/memo/doc/v1.1.0/memo_v1_1_implementation_review8.md)、PR #1 | 設計資料の整備。SQL/TS実一致や本番適用の合格ではない |
| D02 | 型定義・正式SQL・画面設計の参照基盤 | 完了 | [メモREADME第6章](../tools/memo/README.md)、PR #1 | 正式原本と後続承認契約を併用する |
| D03 | 製造順序・PR分割の初期計画 | 完了 | [製造計画](../tools/memo/doc/v1.1.0/IMPLEMENTATION-PLAN-2026-10-26.md)、PR #2 | 過去計画。現時点の進捗は本表で管理 |
| D04 | バックアップ・復元設計とタグ色除外の合意反映 | 完了 | [設計書](../tools/memo/tests/LOCAL-BACKUP-DESIGN.md)、PR #19・#20 | 後続の実装契約を含めて参照 |
| D05 | v1.1.0受入範囲・残仕様の最終確認 | 完了 | [統合仕様§1.1](../tools/memo/doc/v1.1.0/memo_v1_1_implementation_review8.md)、[RPC接続契約](../tools/memo/tests/CLOUD-RPC.md)、2026-11-08オーナー判断 | C03〜C05実装前の認証・セッション・保存先の仕様判断を反映・整合確認済み。実装・実接続の完了ではなく、後続タスクの判断は維持 |

## 2. TypeScript化・ローカル機能

| タスクID | 作業内容 | ステータス | 根拠となるファイル・PR | 備考 |
|---|---|---|---|---|
| L01 | TS/Vitest基盤・型・入力/読取検証 | 完了 | [src](../tools/memo/src/)、[試験案内](../tools/memo/tests/README.md)、PR #2・#3 | 公開旧JSの置換完了とはしない |
| L02 | Web Locks・通常保存・更新・旧移行/pending復旧 | 完了 | [保存](../tools/memo/tests/LOCAL-SAVE.md)、[移行](../tools/memo/tests/LOCAL-MIGRATION.md)、PR #5・#7・#13・#14 | 注入保存先/隔離入口で実装。実ユーザーへの接続は未承認 |
| L03 | タグ・ピン・ゴミ箱・検索・ソート・前後移動 | 完了 | [操作](../tools/memo/tests/LOCAL-OPERATIONS.md)、[検索](../tools/memo/tests/MEMO-QUERY.md)、PR #8・#9 | ローカル機能。製品画面の統合・受入は別 |
| L04 | ドラフト保護・制御層・隔離UI・メモ複製 | 完了 | [編集](../tools/memo/tests/EDITOR-STATE.md)、[制御](../tools/memo/tests/LOCAL-CONTROLLER.md)、[複製](../tools/memo/tests/DUPLICATE.md)、PR #10〜#12・#16 | 保存失敗/結果不明・追加編集保持の契約を維持 |
| L05 | v3形式・削除ID履歴・個別/一括完全削除 | 完了 | [v3契約](../tools/memo/tests/format/V3-CONTRACT.md)、[削除](../tools/memo/tests/LOCAL-DELETE.md)、PR #17・#18 | v3更新は管理された隔離導入経路のみ。旧版の全削除とは別操作 |

## 3. バックアップ・復元

| タスクID | 作業内容 | ステータス | 根拠となるファイル・PR | 備考 |
|---|---|---|---|---|
| B01 | Step 2：正常v3のJSON出力 | 完了 | [出力契約](../tools/memo/tests/LOCAL-BACKUP-EXPORT.md)、src/local-backup.ts、PR #21 | 10 MiB、平文、旧キー・migration/legacySnapshot・ドラフトは対象外。OS保存完了保証なし |
| B02 | Step 3：選択メモの追加型復元 | 完了 | [追加復元](../tools/memo/tests/LOCAL-RESTORE.md)、src/local-restore.ts、PR #22 | 新ID、既存タグ再利用、正常タグ統合。現在削除履歴を維持 |
| B03 | Step 4：完全削除メモの単件回復 | 完了 | [単件回復](../tools/memo/tests/DELETED-RECOVERY.md)、src/deleted-recovery.ts、PR #23 | 新ID、現在存在するタグIDのみ。結果不明で自動再書込しない |
| B04 | Step 5：保存領域喪失時の全件初期復元 | 完了 | [初期復元](../tools/memo/tests/INITIAL-RESTORE.md)、src/initial-restore.ts、PR #24 | 両キー厳密不在、全件検証、原属性・順序保持。既存値は上書きしない |
| B05 | Step 6：合成メモリ/隔離実Storageの横断検証 | 完了 | [Phase A](../tools/memo/tests/BACKUP-INTEGRATION-PHASE-A.md)、[Phase B](../tools/memo/tests/BACKUP-INTEGRATION-PHASE-B.md)、PR #25・#26 | Chromium、所有profile、loopbackのみ。再起動・複数タブ・容量例外を記録。実ユーザー/公開受入とは別 |

## 4. Supabase・認証・保存切替

| タスクID | 作業内容 | ステータス | 根拠となるファイル・PR | 備考 |
|---|---|---|---|---|
| C01 | 通信なし8RPCアダプター・厳格応答検証・エラー分類 | 完了 | [RPC契約](../tools/memo/tests/CLOUD-RPC.md)、src/cloud-rpc-adapter.ts、PR #27・#28 | P0002修正含む。single-rpcの実経路認定は未検証 |
| C02 | 注入HTTP境界・段階ランナー・SQL/TSベクトルの通信なし基盤 | 完了 | [通信なし基盤](../tools/memo/tests/CLOUD-CONNECTION-FOUNDATION.md)、tests/cloud-live/、PR #29 | 偽fetch・offline専用。Auth/実transport接続の完成ではない |
| C03 | Auth・セッション・ログイン/ログアウト接続 | 進行中 | 統合仕様§1.1、[Auth契約](../tools/memo/tests/AUTH-SESSION.md)、src/auth-session.ts・auth-client.ts・auth-sdk.ts・browser-auth.ts、PR #50〜#53・#60・オーナー承認 | PR #52の最終記録はパッチ23件・隔離Chromium11件PASS。PR #53で表示専用subscribe、解除・非同期通知・期限検出・終端通知を整備。書込許可は引き続きgetContext/isCurrentで判定する。C03の追加タイマー/ポーリングなし、型検査回避・専用ビルドの制約、アプリ単位のログアウト非保証と読書アプリ側の後日確認を維持。Q04 Step 4で既存session注入による製品候補UIの状態表示・login/logout/restore・購読解除・終了を接続し、fake Chromiumで確認。実SDK生成・実Storage・製品RPC senderは未結線、本番Auth・実アカウントも未検証のため進行中。 |
| C04 | クラウド制御層・実HTTP経路と要求照合のUI接続 | 進行中 | RPC契約、PR #54〜#66、[C04制御契約](../tools/memo/tests/CLOUD-CONTROLLER.md)、[通信なしsender境界](../tools/memo/tests/CLOUD-CONNECTION-FOUNDATION.md)、[single-rpc認定前ゲート](../tools/memo/tests/SINGLE-RPC-ACCEPTANCE.md)、[製品注入接続](../tools/memo/tests/PRODUCT-UI-INTEGRATION.md) | 8RPC controller/senderとreadonly trialの注入compositionは実装済み。専用Chromiumの既知通信問題は保留。Step 4第5単位までにload/snapshot閲覧・既存単件編集と新規単件作成のsave/resolve・競合/UNKNOWN/確定結果回収をfake検証。状態変更/削除/復元/タグ変更・実sender生成/製品配信経路は未結線。実senderはunverified、adapterは成功へ昇格しない。DB CLIのPASSを製品経路へ流用しない |
| C05 | ローカル/Supabase保存先切替の製品接続 | 進行中 | 統合仕様§1.1、[編集契約](../tools/memo/tests/EDITOR-STATE.md)、[製品注入接続](../tools/memo/tests/PRODUCT-UI-INTEGRATION.md)、src/storage-target-controller.ts、PR #68 | Step 4第2単位で既存C05を製品hostへ注入し、明示保存先選択・確認・認証世代更新・logoutをfake検証。明示logoutはnavigation離脱判定後にlocalへ戻し、Auth失効はcloud選択とdirtyを維持。saving/rejected/unresolved/dirtyは既存判定を共有。cloud選択中のlocal暗黙保存なし。cloud一覧/詳細・既存編集/新規単件作成/save/resolveはfakeで接続済み。cloud editorのdirty/saving/rejected/unresolvedも既存離脱契約へ委譲。通常entry/実クラウド接続・状態変更等の残りwriteは未接続。転送/merge/sync/retryを追加しない |

## 5. DB・権限・セキュリティ

| タスクID | 作業内容 | ステータス | 根拠となるファイル・PR | 備考 |
|---|---|---|---|---|
| S01 | A01〜A17のカタログ監査・課題記録 | 完了 | [DB監査記録](../tools/memo/tests/DEV-DB-AUDIT.md)、[チェックリスト](../tools/memo/tests/DEV-DB-AUDIT-CHECKLIST.md)、PR #30・#31 | 手動実施報告の記録。A17やR02解決ではない |
| S02 | 8RPC本文比較・追加S01〜S06監査の記録 | 完了 | DB監査記録§13・15、PR #32〜#34・#39・#40 | 改行正規化後8本文一致、戻り値型OID一致等。実Auth/RLS/HTTP合格ではない。#37は#38でrevert、復元修正は#39 |
| S03 | R02 T00〜T05読取監査の取得 | 完了 | [既存手順](../tools/memo/tests/db-audit/R02-PREAPPLY-AUDIT.md)、オーナーの今回の手動報告 | T00:PG17.11/UTF8/on/15s・3s、T01:12関数、T02:20行/4署名/13列、T03:80行欠落等なし、T04:4一致、T05:seed20/UNKNOWNなし。AI独立検証なし |
| S04 | helper直接EXECUTE制限の最小設計・SQL・静的検証 | 完了 | [現在の最小契約](../tools/memo/tests/db-audit/S04-MINIMAL-ACL.md)、[SQL案](../tools/memo/tests/db-audit/s04-helper-execute.sql)、[Q04実行記録](../tools/memo-db-test/Q04-RESULTS.md)、PR #79・#83 | repository準備COMPLETE。適用成功報告、直接拒否・ケース13/6総合PASS。PR #83マージ後にQ04 Step 3のS04差分確認もオーナー確定で完了。追加GRANT/完全復元/追加実試験なし。製品経路/RLS等のQ04残条件とは区別。A17はS05保留 |
| S05 | A17：将来オブジェクトのdefault権限対応 | 保留 | DB監査記録§14、PR #35 | 新規追加予定なしの判断で変更保留。追加前・追加後・本番公開前の権限レビューは残る |

## 6. テスト・品質確認

| タスクID | 作業内容 | ステータス | 根拠となるファイル・PR | 備考 |
|---|---|---|---|---|
| Q01 | 型チェック・Vitest・ビルドの既存回帰基盤 | 完了 | [package.json](../tools/memo/package.json)、試験案内、通信なし基盤、PR #29 | 過去記録は全Vitest1,300件等PASS。今回再実行なし。リリース対象コミットの最終回帰は別確認 |
| Q02 | 合成メモリUI・ブラウザE2E | 完了 | [ブラウザ契約](../tools/memo/tests/BROWSER-UI.md)、tests/browser/、PR #12以降 | 過去記録83件PASS。実OS日本語IME・実端末受入とは別 |
| Q03 | 隔離ChromiumのStorage/Web Locks・形式/切替試験 | 完了 | [永続化](../tools/memo/tests/LOCAL-PERSISTENCE.md)、Phase B、[切替設計](../tools/memo/tests/RELEASE-TRANSITION.md)、PR #14・#15・#17・#26 | 過去記録22/16/20件PASS。容量・再起動は記録範囲に限定 |
| Q04 | 実RPC・SQL/TS一致・Auth/RLS/GRANT・障害/競合検証 | 完了 | PR #102、既存Q04実行記録、オーナー完了判断 | 個人利用v1.1.0の技術ゲートとしてCOMPLETE。既存S04/Q04-READ/Case13/Case6と製品Auth/D05/logout観測を再利用。single-rpc・完全response provenanceは未認定のまま延期。追加Human Gate・実通信は行わない。主要操作/実マイク等はQ05へ |
| Q05 | 実機・IME・主要操作・ドラフト保護等の最小UAT | 完了（COMPLETE） | [UAT正本](../tools/memo/tests/HUMAN-UAT-v1.1.0.md)、PR #131、先生の明示的な完了承認 | 01〜08・最終レイアウトHuman PASS。PASS8/FAIL0/NOT STARTED0/SKIP2。既存Human証拠を再利用し再試験不要。09/10は未確認のまま本番配置後へ。Playwright CLI終了処理課題を記録した限定判断であり、全Gate PASS・恒久的基準緩和・公開承認ではない。詳細履歴はUAT正本を参照 |

## 7. 本番移行・公開

| タスクID | 作業内容 | ステータス | 根拠となるファイル・PR | 備考 |
|---|---|---|---|---|
| R01 | 全体進捗表の初期作成と人間レビュー | 完了 | 本ファイル、[PR #47](https://github.com/k-tsuichihara/MyHomePage/pull/47)、今回のオーナー合意 | 必要。PR #47マージにより初期作成・レビューの範囲は完了。今回の方針反映はレビュー待ち。以後も運用ルールに従い更新する |
| R02 | TS製品入口・ビルド配信・既存公開UI統合 | 完了 | [製品UI統合契約](../tools/memo/tests/PRODUCT-UI-INTEGRATION.md)、package.json、PR #69〜#77と今回の初期復元/保守候補 | local製品候補のAI実装・オフライン検証範囲でCOMPLETE、今回差分はレビュー待ち。音声・v3導入・バックアップ/各復元と停止保守候補、資産整合性を接続。公開HTML実切替はR05、実データはR03、公開構成/受入はR04/Q05、Auth/cloud製品接続はC03〜C05へ残す。single-rpc未認定。権限課題R02とは別 |
| R03 | 既存データ移行の準備・確認 | 完了 | 既存v3/移行/原値退避のAI検証、オーナー完了判断 | 実利用データの形式確認・実データ移行試験はリリース条件から除外。必要な既存データはオーナーが必要に応じ対応。既存保護機構は維持。実データ移行を実施済みと認定したものではない。公開資産切替/配信確認はR04/R05へ |
| R04 | Pages設定・公開資産・本番DB/権限・公開前ゲート確認 | 完了 | PR #132〜#137、オーナーHuman報告、先生最終判定 | COMPLETE。本番DB適用/事後確認・本番build/資産確認・O02〜O05受入・今回限りの残存リスク許容を経て公開後Human PASS。未解決P2・CLI課題・SQL未検証履歴等は最新確定結果へ引継ぎ |
| R05 | 承認済み公開切替・停止保守版・復旧手順の製品化/適用 | 完了 | PR #137、merge cb408e3、公開後Human結果、先生最終判定 | COMPLETE。Pages配信PASS、公開版等6項目・本番login/cloud/read6項目・資産/Console等3項目Human PASS。停止/復旧方針と保守候補は確定、実障害での保守切替/復旧を実施した認定ではない。本番write/削除/他ユーザー分離は今回未検証 |

## 8. リリース後の運用・改善

| タスクID | 作業内容 | ステータス | 根拠となるファイル・PR | 備考 |
|---|---|---|---|---|
| O01 | レビュー・承認・未検証事項引継ぎの運用整備 | 完了 | [共通AGENTS](../AGENTS.md)、[メモAGENTS](../tools/memo/AGENTS.md)、PR #4・#6 | 運用ルールの整備完了。実行権限を包括承認しない |
| O02 | 公開後の障害案内・停止/復旧・利用者告知の運用確定 | 完了 | 既存切替設計・保守実装、オーナー明示承認、本書STEP 4 | 運用担当はオーナー。異常時は操作/書込停止・データ削除なし・復旧は個別判断。保守候補4件と配置方法を特定。実切替/復旧は未実施、別途承認 |
| O03 | バックアップ保管・平文情報・履歴喪失等の利用者案内 | 完了 | バックアップ/復元契約、製品UI、UAT-08、オーナー明示承認 | STEP 4の利用者向け注意事項を受入済み。平文保管・保存完了確認・local保存済み対象・復元履歴の限界を案内。暗号化/自動バックアップは今回追加しない |
| O04 | 既存監査記録・ACL原本の保管/廃棄方針整理 | 完了 | R02原本管理合意、S04現行契約、オーナー明示承認 | オーナーのみ非公開保管継続・廃棄なし。T02完全性証明は未確認のまま延期。方針整理の完了であり原本完全性や実廃棄の完了ではない |
| O05 | 延期項目の記録 | 完了 | UAT正本・各契約・オーナー明示承認 | 実スマホ/実音声は公開後確認、single-rpc/完全provenance認定は延期。CLI終了処理等の既知事項と未確認を維持。次版の詳細設計や未確認のPASS化は行わない |

## 照合の限界・レビュー事項

- 最新のT00〜T05取得完了とT02完全性未確定は、チャットでのオーナー報告を根拠に本表へ記録した。既存監査文書には準備当時の未実施記録が残る。今回はそれらを編集せず、原本を取得・参照していない。
- READMEやRELEASE-TRANSITION.md、V3-CONTRACT.md等の当初の未実装記載と、後続PR #16〜#29の実装が異なる箇所は、後続コード・契約・マージ履歴を優先して進捗を整理した。正式仕様そのものの変更ではない。
- 音声入力は初期整理時に未実装だったが、今回製品候補へ新規音声メモ・本文追記・手動保存を接続しfake/Chromiumで検証する。実マイク・権限UI・認識精度は未検証で、承認済みQ05 SKIPとして本番配置後へ引き継ぐ。Q05 COMPLETEを実音声受入済みとは扱わない。隔離メモリUIは引き続き対象外。
- 公開サイトの現物、Pages設定、本番DB、実ユーザーデータ、Auth状態、非公開監査原本は確認していない。現在の本番状態をローカルコードや開発監査だけで断定しない。
- 固定の過去テスト件数は記録時点の結果。最新mainの実行結果や、全環境の保証ではない。テスト定義の存在だけでPASSとしない。
- 自動同期・自動転送・障害時の自動fallbackは現行正式仕様上の対象外であり、残作業として追加しない。

## 追加提案（未承認・確定タスク外）

初期作成時点の追加提案はなし。今後の提案は根拠・影響・承認状態をここへ記載し、承認されるまで上表へ確定追加しない。
