# Q04：公開前の実権限・API確認準備

基準：PR #79マージ後main `8ef563c`。実DB/SQL/Auth/RPC操作は今回0件。
現在の実施状態は[Q04実行記録](Q04-RESULTS.md)を正本とする。**Step 3のS04差分確認は完了、追加実試験不要**。Q04全体は進行中。Step 4第1単位の製品UI/session注入接続をオーナー承認で実装し、fake/Chromiumで検証した。実SDK生成・実Storage・実通信・C04/C05本結線・cleanupは未実施/未承認。以下の未承認/未実施表現は準備履歴として現在の記録と区別する。
対象は承認済みdev-sandboxと合成テストユーザーのみ。production、実ユーザーデータ、公開操作は対象外。

## 1. 再利用と残るUNKNOWN

| 分類 | そのまま再利用する資産 | 今回/次の扱い |
|---|---|---|
| 確認済み環境・catalog | A01〜A17、8 RPC body audit、S01〜S06、T00〜T05 | Project Ref/origin/isolation、署名、定義、既存権限の過去PASSは再監査しない。設定変更・証拠失効・新依存が出た場合だけ理由付きで再確認 |
| 権限変更 | [S04最小契約](../memo/tests/db-audit/S04-MINIMAL-ACL.md)、[S04 SQL](../memo/tests/db-audit/s04-helper-execute.sql) | 原文を再利用。ACL原本完全性・NOLOGIN調査・完全復旧は再要求しない。A17/S05は保留 |
| DB/API判定・対象保護 | [過去33件](TEST-SUMMARY-2026-10-25.md)、各`*-contract.mjs` / `*-read.mjs` | 判定器・明示確認・新規ID・所有者照合・不変比較・wx記録を再利用。過去run固定の継続ケースを新規runへ偽装しない |
| C03/C04製品経路 | Auth/session/SDK、controller、sender、[認定条件](../memo/tests/SINGLE-RPC-ACCEPTANCE.md) | fake回帰を再利用。DB CLIの成功を製品SDK/ブラウザ成功やsingle-rpcへ昇格しない |
| AI側追加 | `q04-prepare.mjs`、`q04-read.mjs` / `q04-read-contract.mjs` | 承認前に実行ファイル・通信上限・機械判定・安全な記録・停止を準備。新しい監査frameworkは作らない |
| 実環境のみ | S04適用の成否、撤回後の直接拒否/8 RPC/CHECK/index、実Auth/RLS/HTTP、競合 | 実適用・試験の個別承認後だけ観測。現在UNKNOWN |

Human Gate専用Chromiumでの既知network問題は保留のまま再調査しない。DB CLIは元から存在する別経路であり、ネットワークfallbackではない。Human Gateを失敗後に自動でCLIへ切り替える機能はない。

## 2. 最小実行順序と承認単位

### 0：AI Gate（実通信なし）

`node --test tools/memo-db-test/q04-read-contract.test.mjs tools/memo-db-test/q04-prepare.test.mjs`

これはfake fetch/メモリ記録のみ。CLI入口のimportでも設定読取/通信はしない。SQL実行・DB接続は行わない。既存オフラインDB判定器とC03/C04回帰を併用する。

### 1：S04適用（別承認待ち）

準備だけのコマンド：リポジトリルートから `node tools/memo-db-test/q04-prepare.mjs`。
既存S04原文をBEGIN / SET LOCAL 15s・3s / COMMITで包み、`runs/q04-prepared/<新規run>/s04-apply.sql` とmanifestを排他的に新規作成する。SQL適用も設定取得も行わない。manifestの`applied:false`は生成状態でありDB状態の証明ではない。

承認対象は「dev-sandboxで生成済みSQLを1回適用し、helper4件のPUBLIC/anon/authenticated EXECUTEだけを撤回する」。追加GRANT、DDL、表/RLS/owner変更なし。同時DDL/権限変更のない時間枠で実施。新しいDB管理接続基盤は作らず、既存のオーナーSQL Editor操作を使用する。

人間が必要なのはこの権限変更の承認と、AIから操作できないSQL Editorの実行だけ。SQLの編集・role選択・ACL比較を要求しない。全文を1 Runで実行する。末尾COMMITまでの信頼できる成功応答が得られない場合はUNKNOWNとして後続停止。エラー時はtransaction終了まで保証されたとせず、接続/transaction状態確認・終了が必要なら別承認。別RunからのROLLBACKで解決済みとはしない。自動再適用・自動終了処理はない。

生ACL/role/SQL Editor生エラーをチャットへ転記しない。成功応答を確認不能、エラー、切断、30秒待機超過の場合は、その事実だけを記録して停止。実行前の環境確認済み事項を再監査させない。成功後の不具合はS04契約の限定forward fixへ戻り、PUBLICへ戻して回避しない。

### 2：Auth・helper直接拒否・snapshot（別承認待ち）

人間が実行する入口：`node tools/memo-db-test/q04-read.mjs`（ルートから、引数なし）。
既存`cli.mjs`の固定dev-sandbox設定検査と、既存`.env.local`の公開キー設定を使用する。AIは設定ファイルを読まない。既存の値が有効なら再入力/再確認不要。不足時は人間が既存のローカル設定経路を使い、実値をAI/Git/URLへ渡さない。

1. 起動時点は通信0。上限・影響を表示。
2. **この単位の実通信承認後だけ** `Q04-READ` と入力。これだけでは通信しない。
3. 合成ユーザーemail/passwordを非表示で入力する。資格情報はCLI引数、URL、記録へ含めない。
4. password入力完了後、Auth 1回を開始する。Auth応答を判定できなければRPC 0のまま停止。
5. anon→authenticatedの順に4 helperを各1回拒否確認、最後に`memo_load_snapshot`を1回だけ実行。その他の正式RPC・書込・logout・ユーザー作成は0回。
6. runnerが合否/UNKNOWNを判定・記録・表示する。人間による通信数カウント、DevTools、技術的な結果整理は不要。

上限は**Auth 1 / RPC 9（helper8 + load1）/ write 0 / retry 0、要求15秒、通信全体30秒**。helperは固定の副作用なしINVOKER関数だけで、引数も固定する。一般の任意RPC/URL/argsを受け取らない。

件数はrunnerからfetchへの送信回数であり、provider/中継での実行回数の証明ではない。低層の再送/応答出所の認定は既存acceptanceへ残す。新しいhelper拒否経路はDB試験専用で、製品の8 RPC allowlistやAuth safeFetchを拡張しない。

HTTP 401/403 + SQLSTATE 42501 + 対象関数の権限拒否文が一致した場合だけ拒否確認。HTTP 2xxはFAILで停止。404/PGRST202、汎用unauthenticated、他HTTP/本文はUNKNOWNで停止（schema cache未掲載と実行拒否を混同しない）。言語差等で拒否文が異なっても推測PASSにしない。snapshotは既存比較器で形式/重複を検査し、各rowのownerをAuth応答ownerと照合する。空snapshotは今回の読取成功に限り、RLS所有者分離の証明ではない。

この経路は過去CLIと同じpassword grantを使うDB/API試験であり、製品SDKのsession復元・refresh・世代・StorageやRLS実証を代替しない。SSO/ブラウザセッション共有は前提にしない。

### 3：変更に影響される書込・権限・競合（別承認待ち）

全33件の再実行はしない。次表は準備時に列挙した利用可能な既存ケースであり、全行の再実行を必須とする一覧ではない。ケース13完了後の現在の差分選定は後掲「残ケースの差分選定」を優先する。合成専用の新規run/対象を使い、過去PASS対象は変更しない。

| 必要な証拠 | 再利用する入口/判定器 | 依存・停止 |
|---|---|---|
| メモ作成/更新・入力CHECK | `create-read.mjs` / `update-read.mjs` / `input-content-read.mjs` | 現在の新規作成runを使用。更新の旧UUIDを固定コピーしない |
| タグ作成/改名・一意index | `tag-edit-read.mjs` / `tag-duplicate-read.mjs` | ASCII同値拒否・非ASCII区別。権限不足なら停止 |
| タグ削除・関連/他データ不変 | `tag-delete-read.mjs` | 既存の順序非依存比較器を使用 |
| 状態変更・個別削除・一括削除（残り8RPC経路） | `pin-read.mjs` / `permanent-delete-read.mjs` / `empty-trash-success-read.mjs` | 新規専用対象のみ。一括削除ケースの専用空ユーザー等、既存前提を維持 |
| 保存照合・要求台帳・revision競合 | `resolve-missing.mjs` / `concurrent-read.mjs` | 並行ケースの意図した2送信と、UNKNOWN後のretryを区別。旧run依存ケースは無条件に再実行しない |
| 未認証/直接表権限・RLS所有者分離 | `unauthenticated-read.mjs` / `isolation-read.mjs` | 既存ケース22/23を使用。後者は合成A/B。拒否エラーだけでRLS正常とはしない |

各入口は名前に`read`があっても書き込む。各手順書が正本で、Q04文書は上限/確認を緩めない。既存CLIは操作ごとの確認・対象表示・記録を持つため、新しい一括自動承認や全ケース自動続行runnerは追加しない。AIが必要なコマンド/対象対応/上限を承認前にまとめ、人間へUUID調査や手作業での集計を依頼しない。記録に必要なrun対応は承認後にローカルの既存記録から機械的に解決する。対象/上限/cleanupが未承認なら実行しない。

### 4：製品経路の実接続と受入（別承認・後続依存）

C03〜C05製品接続後のAuth/session復元・失効・同一ユーザー再認証・Auth generation・送信前後の応答反映拒否は、既存製品Auth/controller/senderで検証する。DB CLIの合格をここへ流用しない。offlineのtimeout/disconnect/generation/no-auto-retryを再利用し、実通信障害を作るためだけに書込を繰り返さない。
実経路の再送・応答出所が未確認なら`single-rpc`未認定を維持する。Q04をPASSにしても自動昇格しない。今回、製品UI・C05接続は変更していない。

### Step 3ケース13の承認準備履歴（実施後PASS）

以下は実施前に提示した範囲。オーナーの1回実行・総合PASS報告を実行記録に追記済み。このケースを再実行せず、専用タグ1件を保持する。

最初の候補は既存[ケース13](TAG-EDIT-TEST.md)・`tag-edit-read.mjs`。新規の専用タグ1件だけで、`memo_save_tag`→valid_text/trim_edges/edge_spacesとCHECK/indexのtag_keyを使う通常経路に到達できるため。過去のhelper監査を繰り返すのではなく、S04撤回後の実書込という未検証部分を確認する。

| 承認対象 | 具体的な範囲 |
|---|---|
| 対象 | 既に確認済みdev-sandbox・合成ユーザー1名・新規生成する専用タグ1件のみ |
| Auth | 最大1回。既存の固定接続先/公開キー検査・通常Auth。管理キーなし |
| RPC | 最大7回：`memo_save_tag`3回（作成、改名、古いrevisionの拒否試行） + `memo_load_snapshot`4回。HTTP全体はAuthを含め最大8回 |
| 書込影響 | 正常なら作成→改名の2回が成立し、タグ1件がrevision=2で残る。3回目はHTTP409/PT409/固定競合文の一致とsnapshot不変を期待。誤成功なら同じ専用タグの名前/revisionが変化し得る |
| 人間の操作 | 個別承認後だけ既存コマンドを起動し、合成資格情報をローカル入力。既存CREATE/RENAME/CONFLICT確認は操作承認であり、技術判定を人間へ要求しない |
| 判定/記録 | 既存`runTagEditCase`/`tagRpc`が所有者、revision、created_at、全snapshot不変、期待競合を検査し、既存wx記録へ保存。ローカル表示には合成ID/引数が含まれるため端末全体を共有しない |
| 制限 | 各要求15秒、redirect拒否、retry0、既存対象の編集・メモ作成・タグ削除・cleanup・他ケース自動続行なし。人間の入力待ちを含む試験全体を30秒に収める契約ではない（Step 2専用の通信全体30秒と区別） |
| 停止 | 確認取消し、HTTP/本文/状態不一致、timeout、通信失敗、記録失敗で後続停止。旧CLIのFAIL表示も、送信後の結果不確定ならQ04ではUNKNOWNとして扱う。再送/自動修復なし |

実行コマンドは既存の `node tools/memo-db-test/tag-edit-read.mjs`。**現在は起動しない**。このケースは認証の後に書込確認を求めるため、起動前にAuthと上記全ケース範囲の個別承認が必要。旧手順にあるDashboard/定義の再確認は、具体的な変更理由なしに追加しない。

ここで確認できないASCII重複/非ASCII区別は既存ケース14、メモ書込/台帳/競合は既存の作成/更新/並行ケース、RLSは既存A/Bケースへ残す。全Step 3や8 RPCがこの1ケースだけで完了するとはしない。ケース13の過去PASSやoffline回帰を変更後の実PASSへ転記しない。既存判定器・手順・上限の静的照合まで準備済みで、runner再実装や新しい承認機構は追加しない。

### 残ケースの差分選定履歴（ケース13完了後）

以下はケース6承認前の選定履歴。現在はケース6の総合PASSを記録済みであり、後掲の「ケース6完了後の再評価」を現在の判断として優先する。

S04は4 helperのクライアントEXECUTE撤回のみ。RPC本文、CHECK/index式、RLS、表権限、入力仕様は変更していない。過去PASSはその範囲の証拠として保持するが、新しい変更後実測に読み替えない。

| 経路 | 今回の選定 | 理由 |
|---|---|---|
| helper直接拒否・タグ正常書込 | 再実行しない | Q04-READとケース13で確認済み。作成済みタグを再利用・削除しない |
| メモ作成/更新・memo側CHECK・保存照合 | 次の最小候補：既存ケース6を1回 | memo_saveの変更後書込は未実証。ケース6なら新規メモ1件で作成/更新/要求照合/競合を一体確認でき、基本作成→更新→競合→照合を別runで重複実行しない |
| 名前重複/非ASCII区別・入力全境界 | 次の候補へ追加しない | 今回変えたのはEXECUTEであり比較/検証式ではない。タグ正常書込でindex/helper実行経路は成立。過去ケース14/20/21のPASSを保持し、新しい意味変更等の理由が出た場合だけ再評価 |
| ピン/ゴミ箱/個別・一括削除/タグ削除 | S04差分確認のためだけには再実行しない | 本文/定義は変更せず、S04内の全8 RPC ownerに対するhelper実効権限ガードも成功報告あり。これを各機能の新実測PASSとはしない。将来製品接続の新依存が出た場合はその境界で確認 |
| RLS分離/直接表権限 | 追加の旧CLI試験を今は要求しない | RLS/表GRANTは変更していない。過去ケース22/23のPASSを再利用。製品経路のAuth/所有者境界は未検証としてQ04後続に保持 |
| 障害/失効/古い応答/single-rpc | 製品経路の後続条件を維持 | 既存offline回帰は再利用するが、未接続の実製品Auth経路まで合格にしない。実障害を起こすためだけの追加書込は行わない |

S04のための追加実試験候補は**既存ケース6の1単位**に絞る。Q04全体の受入項目を削除する判断ではなく、S04差分のために過去33件を再実行しない選定。製品Auth/HTTP/RLS/競合・single-rpc等の残条件は維持する。

#### 既存ケース6の承認準備履歴（実施後PASS）

- runner：`concurrent-read.mjs`、判定器：`concurrent-contract.mjs`の`runConcurrentCase`/`sendTimed`。正本は[CONCURRENT-TEST.md](CONCURRENT-TEST.md)。新規runnerは作らない。
- 対象：既に確認済みdev-sandbox、合成ユーザー1名、新規専用メモ1件。今回のタグや他の既存メモ/タグ/関連には触れない。
- 上限：Auth1回、RPC8回（`memo_save`3、`memo_load_snapshot`3、`memo_resolve_request`2）。write RPC送信最大3回、正常に成立する変更は作成1回＋並行更新の勝者1回の計2回。HTTP全体最大9回。
- 送信内訳：初期snapshot→明示CREATEで新規メモrevision1→snapshot→明示PARALLELで同じrevision1に異なるrequestId/本文のA/Bを各1回送信→両方の開始済み結果を回収→正常条件を満たす場合だけsnapshotと勝敗両要求のresolveへ進む。意図した2送信はUNKNOWN後のretryではない。
- PASS：一方だけHTTP200、他方はHTTP409/PT409/固定競合文一致、送信期間の重なり、最終revision2、日時・本文・所有者・要求ID・他データ不変、勝者resolve結果一致、敗者resolve=nullを既存判定器が確認し、記録保存を完了した場合。null単独を未実行証明としない。期間重複をDB内部の同時実行/ロック待ち証明にしない。
- FAIL/要確認：期待外の確定応答、両成功/両拒否、状態不一致、期間非重複等では停止。非重複は既存契約の`unconfirmed-redesign-required`であり、再実行してPASSにする操作は未承認。
- UNKNOWN：timeout/通信断/応答解析不能/記録不能等でDB結果を確定できない場合。既存CLIのFAIL表示を未保存確定に読み替えない。既に開始したA/Bは回収するが、追加snapshot/resolve/再送/修復は行わない。後続の再診断は別承認。
- 時間/停止：各要求15秒、redirect拒否、retry0。Step 2専用の通信全体30秒を流用しない。途中取消し/記録失敗でも止める。正常時は専用メモ1件revision2を残す。cleanup/削除/巻戻しなし、後片付けは別承認。
- 人間の操作：ケース全体の個別承認後だけ既存コマンドを起動し、合成資格情報とCREATE/PARALLEL確認を入力する。対象ID選定、通信重複・競合・不変・照合・合否の技術判定はrunnerが担当。既存runsの公開や手作業比較は不要。
- 証明範囲：変更後のメモ作成/更新とそのCHECK/helper経路、同revision競合、正式な保存照合、対象外不変。製品SDK/ブラウザ、RLS機構、残りRPC、全入力境界、single-rpcをこの1ケースだけで証明しない。

実行コマンドは `node tools/memo-db-test/concurrent-read.mjs`。**現在は起動しない**。AI側では既存コード・手順・上限・停止の静的照合まで完了。実データ/資格情報/過去runsの追加取得や実試験はしていない。

### ケース6完了後の再評価（現在の判断）

**追加のStep 3実試験は、S04差分確認のためには不要。PR #83レビューPASS・マージ後にオーナーがこの限定範囲を完了と確定した。** ケース13/6を含む既実施ケースは再実行しない。

| S04の変更リスク | 現在の根拠 | 追加実試験の要否 |
|---|---|---|
| clientに不要なhelper直接EXECUTEが残る | S04適用成功報告、SQL内の実効/SET到達ガード、Q04-READの4 helper×2主体の直接拒否 | 不要。既存catalog監査も再実行しない |
| タグの必要helper権限が不足する | ケース13の作成/改名/競合総合PASS。valid_text/trim_edges/edge_spacesとCHECK/indexのtag_keyを使う経路成立 | 不要。作成済みタグは保持 |
| メモの必要helper権限が不足する | ケース6の作成/更新/競合/保存照合総合PASS | 不要。作成済みメモは保持 |
| その他RPC ownerのhelper権限不足 | S04内の全8 RPC owner×4 helperの実効権限ガード成功報告。関数/所有者/本文を変更せず、実書込をメモ/タグ両方で確認 | S04のためだけの状態変更/削除/再送ケース追加は不要。全8 RPCの新規実測PASSという主張はしない |
| 名前比較/入力境界/RLS/表GRANTが変わる | これらはS04の変更対象外。過去の定義監査・機能PASSは失効理由なしに再実行しない | 念のための再試験は追加しない。製品接続に伴う新しい境界の検証とは別 |

残るQ04条件は「S04差分の未達」ではなく、製品Auth/session復元・失効・同一ユーザー再認証、cloud controller/sender/UI結線、製品の所有者/RLS/GRANT境界、障害/古い応答/競合時の受入、実経路の応答出所・single-rpcである。過去DB/API PASSと今回CLI PASS、既存offline回帰を根拠として引き継ぐが、未実証の製品実経路を合格へ昇格させない。

Step 3完了は後続の製品実装/実通信の承認ではない。製品接続の作業範囲は別に定める。S04差分の追加Human Gate、cleanup、残置タグ/メモ削除は要求しない。新しい診断・監査・試験基盤を追加せず、今回は文書更新と静的照合だけで停止する。

### Step 4静的整理と次の1実装単位（実装前の提案）

以下の提案はその後オーナー承認を受け、第1単位のsession注入UIとして実装した。[製品UI契約](../memo/tests/PRODUCT-UI-INTEGRATION.md)を現在の接続仕様とする。提案時の未着手表現は履歴であり、実SDK/実通信等の未結線を解消したことにはしない。

基準main：`0cdcbf9`（PR #83マージ後）。DB監査や既存試験は再実行せず、製品接続コードと契約だけを読んだ。

| 対象 | 実装済みの再利用先 | 製品側の未結線 |
|---|---|---|
| C03 | `auth-session.ts`のrestore/login/logout/subscribe/getContext/isCurrent/dispose、`auth-sdk.ts`の専用Storage/SDK/safeFetch | 製品UIのログイン/ログアウト/復元/再認証表示、生成・購読解除・終了のhost。実製品Storage/設定の注入も未結線 |
| C04 | 8 RPC adapter/controller、`prepareRpc()`の1回限定能力、`cloud-rpc-sender.ts` | 製品compositionからの生成、UI操作→controller dispatch、読取結果の画面反映、固定要求/UNKNOWN/明示resolveの製品表示。現在の`mountMemoPreview`はlocal controller型に結合している |
| C05 | `storage-target-controller.ts`、既存navigation/editorの離脱判定 | Auth状態と保存先要求/確認のhost、local/cloud表示・操作先切替、logoutの確認→Auth処理→local反映、失効時cloud/draft保持、同一ユーザーの検証済みgeneration更新、切替時の古い確認/応答の失効 |

製品entryは`mountProductBrowserLocalApp`だけを呼び、`product-local-app.ts`はlocal store/controller/移行・復元UIを組み立てている。`build-product.mjs`はAuth/cloud/SDK混入を拒否する現在のlocal-only境界を持つ。これは単にimportを追加してよい状態ではない。

`createBrowserMemoAuth`は`requirePersistencePermit`により専用loopbackだけを許可する。一方、製品local境界はHTTPSのmemo.html用。既存試験用Permitを製品へコピーしたり、共通チェックを緩和したりしない。`createMemoSdkAuth`は別途再利用できるため、将来の製品Storage境界はメモ専用Authキーだけに限定して接続する。Auth/RPC設定の同一project整合、SDKパッチ付きbuild、製品配信時の通信境界は後続のAI実装対象であり、実環境値を今取得する理由にはしない。

senderの応答は常に`unverified`で、adapterはこれをload成功/保存確定にしない。この契約を保ったまま、fakeの既存`single-rpc` fixtureで成功表示を、unverified fixtureで停止/UNKNOWN表示を試験できる。fixtureの成功と実経路の認定を混同しない。Human Gate専用runnerは製品compositionではなく、製品へそのまま組み込まない。

**推奨する次の1単位：製品候補UIのAuth表示・操作を、既存sessionの注入で接続する。**

- 既存local app/候補HTMLに、固定文言の認証状態・ログイン/ログアウト・同一ユーザー再認証案内を接続。既存sessionを注入し、restore/login/logout/subscribeを再利用する。新しい認証基盤や汎用state machineは作らない。
- UIは表示用通知を使い、認証済み表示をcloud書込許可にしない。logoutは既存requestNavigation/confirmNavigationでsaving/dirty/rejected/unresolvedを判定してからAuthへ進む。確認cancelでは画面/ドラフトを維持する。
- app所有の購読・終了を定め、二重操作、古い完了通知、dispose後受付、資格情報の継続保持/生例外表示を防ぐ。通常logoutのscope:localは既存Auth側を維持する。
- この単位では実SDK生成・実Storage接続・実fetch・cloud選択の確定/データ操作には進めない。cloudが使えると表示しながらlocalへ保存する状態を作らない。正式仕様§1.1にあるログイン/復元からの切替要求、C05の確認/反映は次の製品host結線で扱い、同期/転送は追加しない。
- APIの型だけを参照する注入境界を使い、現在のlocal-only bundleにSDKを混入させない。公開memo.html/Pagesは変更しない。
- 注入Auth portがない通常入口は現行local-onlyを維持する。既存製品候補のcomposition/UIへfake sessionを注入して確認し、別物のAuth/RPC実装やHuman Gate runnerを新設しない。

AI Gateでは既存Auth fake/session、メモリStorage、製品候補DOM/Chromium fixtureを再利用し、状態表示、復元、明示操作、失敗/失効の固定表示、離脱確認cancel、saving抑止、世代変更、dispose、secret非出力、local保存への回帰なし、外部通信0を検証できる。既存の単体テストを写経せず、UI/host間の新しい結線だけを追加する。今回はこの実装も試験もまだ開始していない。

その後のC04/C05操作先・画面状態接続や製品SDK/Storage/build接続もAI-onlyで準備できる。実Authの復元/refresh/失効/実ログアウト、実製品ブラウザのTLS/HTTP/応答出所、実RPC/RLSの製品経路との整合は実環境でのみ確認できるが、そこへ到達する前に人間の試験操作を求めない。次の1単位は実環境値・秘密入力・新しいHuman Gateを必要としない。

## 3. 結果・記録・停止

読取runnerは固定schema、scope、state/reason/stage/target、Auth/RPC/write件数、拒否確認数、retry 0、整数HTTP status、42501/PGRST202/otherという固定codeだけを出力する。email/password/key/token/user UUID/raw URL/body/header/provider文/stackは保存・表示しない。publicなS04 SQLのSHA-256とISO時刻だけを記録へ付加する（非公開ACLハッシュではない）。

`runs/q04-read/<新規run>/連番.json`はwx新規作成。既存`.gitignore`の`runs/`配下でローカル非公開保管し、GitにもWeb配信にも含めない。Windows権限は親フォルダから継承するため個人用非公開領域で使う。`prepared`やファイル生成は実行完了/未実行の証明ではない。人間は最後の安全なJSONをAIへ渡すだけでよく、生ログ解析は要求しない。

記録したSQL hashもローカルの原文版識別だけであり、そのSQLが適用済みである証明ではない。

Auth失敗はSTOP。送信後の通信断/timeout/応答出所不一致/本文異常/記録失敗/拒否判定不能はUNKNOWN。期待外helper成功はFAIL。どれも即時停止し、後続snapshot・writeなし。runnerインスタンスは1回限り。CLIの再起動も別の人間承認が必要。UNKNOWN後は対象限定の再診断を別承認し、元runを上書きしない。

読み取りrunnerのPASSは「8拒否 + 1snapshot」のみ。全8 RPC、RLS、製品SDK、single-rpc、公開受入まで合格にしない。Q04完了には段階3/4の該当証拠が必要。

## 4. 今回のAI Gateと未実施

fake fetchで通信上限、拒否の厳密判定、Auth失敗RPC0、preflight0、2回目禁止、network/timeout/本文/redirect/応答URL不一致、記録失敗、snapshot異常/別owner、secret非出力を検査。SQL準備は原文一度だけ・15s/3s・未適用manifestを検査する。SQL構文/DB原子性を実行検証したものではない。

最終結果：追加17件PASS、既存を含むDB用offline試験37ファイル1,281件PASS、メモ本体typecheck PASS、関連S04/controller/sender/Auth境界のVitest4ファイル51件PASS、CLI/生成器のNode構文検査PASS、git diff --check PASS。実TTY入力・実設定読取・生成SQLのSQL Editor実行は未実施。画面/本体srcを変更していないため製品Chromium回帰は今回再実行せず、既存記録を維持する。

実設定/既存runs/非公開ACLは未読。実監査/実通信/SQL適用なし。S04延期事項、A17、Human Gate診断の再調査を追加していない。
