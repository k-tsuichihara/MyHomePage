# メモツール DB・APIテスト資産

## 用途・実行前提

Node.js 22以上の標準機能を使う独立したCLI群です。npm installは不要です。[ルートAGENTS.md](../../AGENTS.md) と各ケースの手順書に従ってください。メモ本体のビルド・ブラウザ試験とは別の資産です。

[テスト計画](TEST-PLAN-2026-10-25.md) と [最終サマリー](TEST-SUMMARY-2026-10-25.md) を参照してください。実DBの最終結果は33項目PASSです。以下に残る「未実行」「次段階未実装」等は作成時点の履歴であり、後続の完了状況は最終サマリーで確認します。安全条件・ケース固有の実行前提は引き続き有効です。

| 分類 | 対象・入口 | 前提・限界 |
|---|---|---|
| ローカル模擬テスト | `*.test.mjs` 34件 | 応答・状態・通信異常等を模擬する。実DBのPASSとは別。個別実行方法は各手順書を参照 |
| 新規専用データを使う実DBテスト | `create-read.mjs`、ケース2〜26・30の各入口（下記継続・診断を除く） | dev-sandbox、通常Auth、実設定、個別確認が必要。ケース2は新規IDを照合入力に使う読取のみでメモを作成しない。ケース22は主に読取・拒否検証、23は2ユーザー、26・30は新規専用ユーザーと初期空状態が必要 |
| 過去runに依存する継続テスト | `update-read.mjs`、`conflict-read.mjs`、`resolve-read.mjs`、ケース27〜29の `deleted-replay-read.mjs` / `deleted-id-read.mjs` / `resolve-mismatch-read.mjs` | 元runの識別・PASS結果と同じユーザー・必要な現在状態を照合。公開コードだけでは同じ履歴を再現できない |
| 過去run専用の読み取り診断 | `inspect-conflict.mjs`、`inspect-tag-usage.mjs`、`inspect-tag-delete.mjs` | 対応するローカル記録が必要。DB書込なしでも認証・読取通信を伴う。元FAILをPASSへ変更するツールではない |

`cli.mjs` は認証とsnapshot読取の入口・共通通信処理です。`-read.mjs` という名前でも書き込みを行う入口があるため、名前だけで読み取り専用と判断しないでください。判定・通信・補助コード71件、模擬テスト34件は現在の配置とimport関係を維持します。

### ローカル証跡と再現性

ケース27はケース26、28は26・27、29は26〜28の固定run記録を参照します。診断ツールにも特定の失敗run参照があります。UUID・対象・所有者の照合を回避するために記録を捏造・書き換えたり、安全確認を無効化したりしないでください。必要な記録がなければ停止します。既存コードの固定参照は今回変更していません。

新規データ型のCLIでも、既存 `runs/` をID重複防止や既存ユーザーとの取り違え防止に使うものがあります。個別手順とコードの条件を確認し、公開コードだけで過去の実DB試験をそのまま再現できるとは扱いません。模擬テストのfixtureは実行証跡の代替ではありません。

### 設定・公開・安全条件

- 開発用Project Ref・HTTPSホストの固定照合は安全機構として維持します。複数の判定コードにも固定値があり、一箇所の変更だけで別環境へ転用できる構成ではありません。環境識別情報はGitHub上で閲覧可能になる前提です。
- 本番k-life-log、service_role・管理キーは使用しません。通常AuthユーザーとPublishable keyを使用します。
- [.env.example](.env.example) は値が空のテンプレートです。実値はローカルの `.env.local` にのみ設定します。
- [.gitignore](.gitignore) は `.env.local`、`.env.*.local`、`*.log`、`runs/` を除外します。認証情報・実設定・生ログを強制追加しないでください。
- 実行証跡236件はローカル保管し、GitHubには公開しません。公開サマリーには実run UUIDを掲載しませんが、既存コード・個別手順の履歴参照は保持しています。
- 書き込みは各ケースの明示的な手動確認後だけ実行します。想定外応答・タイムアウト・状態差異では停止し、自動再送・削除・復旧・後片付けは行いません。
- Git除外はWeb配信除外を保証しません。実設定・runsを含む作業ディレクトリをそのまま公開・アップロードしないでください。Pagesの公開設定は別途確認が必要です。

本整理ではドキュメントのみを編集し、DB接続・テスト実行・コード変更は行っていません。

## 初期段階からの手順・履歴

## 第1段階：新規保存1件と再読み込み

既存の `cli.mjs` は引き続きログイン・読み込み専用です。新しい入口は次のコマンドです（Node.js 22以上）。

```powershell
node tools/memo-db-test/create-read.mjs
```

同じ `.env.local` と `cli.mjs` の固定Project Refを使います。通信先の検証後、`CREATE` の完全一致入力で書き込みを承認し、テストユーザーでログインします。
初期読み込み→新規保存1回→再読み込みを行い、内容・所有者・revision=1・日時・ピン/ゴミ箱初期状態・関連なし・既存データ不変を照合します。同時に別端末でデータを変更すると、不変照合がFAILになることがあります。

保存前に `runs/<実行UUID>.json` を作り、実行ID・メモID・requestId・ユーザーID・プロジェクトホスト・状態だけを保持します。本文・タイトル・キー・メール・パスワード・トークンは記録しません。`runs/` はGit除外です。Windowsのアクセス権は親ディレクトリを継承するため、ローカルの個人用作業領域で保管してください。
`prepared` は未実行の証明ではありません。通信失敗、終了、中断、記録確定失敗時は作成済みの可能性があります。記録されたIDで確認してから次の操作を判断してください。毎回新しいIDを生成するため、再実行は新たな1件の作成です。既存記録を再送する機能はありません。

識別記録はPASS時も上書きせず保持します。PASS結果は `runs/<実行UUID>.result.json` に新規作成します。結果記録の作成に失敗しても元の識別記録は変更しません。識別記録の保持済み表示は、その作成に成功した場合だけ行います。

PASSでもメモは残します。更新・削除・再送・タグ変更など次段階のテストは実装していません。テスト自体は作成時に未実行です。

Node.js 22以上の標準機能のみを使用します。npm installは不要です。
メモ本体・読書管理アプリの設定やlocalStorageにはアクセスしません。

## 設定

### ケース4：requestIdの内容・対象・操作混用

```powershell
node tools/memo-db-test/mix-read.mjs
```

review8の台帳キーは(user_id, request_id)。保存ハッシュはユーザー・要求ID・save・対象ID・期待revision・タイトル・本文・正規化タグ集合に結び付きます。memo_change_stateも同じ台帳を操作名で照合するため、saveで使用済みのrequestIdをpinへ使うことは、状態更新前に拒否される設計です。
期待拒否はHTTP 400＋code 22023＋message `request id reused with different operation or content` の3条件。PT409や一般HTTPエラーでは合格にしません。
新しい専用メモAを作成し、本文だけ変更した再利用、未使用の専用ID Bへの対象変更、Aへのpin操作混用を各1回試みます。Bは事前不在を確認するUUIDで、万一対象変更が成功しても既存PASS対象は操作しません。初回保存も含め各操作前に対象ID・操作・想定影響を表示し、CREATE/CONTENT/TARGET/OPERATIONの完全一致確認が必要です。
RPC上限はmemo_saveが3回（作成1＋不正再利用2）、memo_change_stateが1回、memo_load_snapshotが8回。認証は別途1回です。期待外成功・応答不明・タイムアウト・不変不一致・記録失敗では即停止し、後続試行や自動復旧・削除はしません。
正常時は専用メモA1件と作成台帳だけが残り、再利用3試行はDB不変を期待します。万一成功するとA本文/ピンまたはB新規作成の可能性があります。runsへ識別記録・操作ごとの結果・全体結果をそれぞれwxで新規作成し、本文・認証情報・エラー全文は保存しません。既存記録は変更しません。並行操作はしないでください。
ローカル模擬テスト: `node --test tools/memo-db-test/mix-contract.test.mjs`。実DBは未実行です。

### ケース3：同一保存要求の再送（専用メモを新規作成）

```powershell
node tools/memo-db-test/replay-read.mjs
```

固定dev-sandbox設定を使い、`REPLAY` の明示承認後に認証します。既存JSON記録と衝突しない新規memoId・requestId・実行UUIDを生成し、送信前に `.replay.json` をwxで記録します。既存PASS対象は使いません。
作成前snapshot→保存1回→初期状態・既存データ不変の再読込確認→同一JSON文字列で再送1回→全返却結果（日時含む）一致→snapshot全体不変を検証します。保存呼び出しは最大2回、snapshotは最大3回。初回成功を確認できない場合は再送しません。タイムアウト・HTTP失敗・途中不一致は即停止し、自動再試行・削除なし。
PASS結果は別の `.replay.result.json` に新規作成。本文・認証情報は保存・表示しません。メモ1件と台帳は残ります。失敗でも保存済みの可能性があり、再実行は別の1件を作るため、先に記録IDを確認してください。同じユーザーの他の操作と並行実行しないでください。JSON記録改変・読取不能時は停止します。
模擬テスト: `node --test tools/memo-db-test/replay-contract.test.mjs`。実DBは未実行。review8 SQLは同一要求の台帳resultを返すため、現存する専用メモに他の操作がない条件で、初回応答と再送応答の全フィールド一致を期待します。

### ケース2：未記録要求の照合（読み取り専用）

```powershell
node tools/memo-db-test/resolve-missing.mjs
```

共通CLIの固定dev-sandbox URL・Publishable key制限・非表示認証・15秒タイムアウトを使用します。認証後は `memo_resolve_request` を1回だけ呼びます。新しいメモIDは照合入力用だけで、メモを作成しません。タイトル・本文は固定のダミー値、タグ空配列、期待revision=nullでSQL引数仕様に従います。
既存runs内の全JSONを読んでUUIDを収集し、衝突しないrequestId・runId・メモIDを生成します。不正記録は停止要因です。同時に別のテストを実行しないでください。ローカル記録にないサーバー要求の不在は事前には証明できず、実応答を検証します。
照合前に `<runId>.missing.json`、PASS後に別の `.missing.result.json` をwxで新規作成し、既存記録を上書きしません。本文・認証情報は保存しません。HTTP成功かつ結果が厳密なnullの場合のみPASS。nullは「未実行の証明」ではありません。HTTP失敗、タイムアウト、非null、解析失敗はFAILで停止し、自動再試行しません。
模擬テスト: `node --test tools/memo-db-test/resolve-missing.test.mjs`。実DB接続は作成時に未実行です。

### 残りケース1：正常更新要求の保存結果照合（読み取り専用）

```powershell
node tools/memo-db-test/resolve-read.mjs 85294e97-8529-4d5d-a85c-672116349874
```

引数は更新PASSの実行UUID。更新・作成の識別記録と両PASS結果を照合し、既存v1更新テストの固定生成式から送信内容を復元します。記録が特定できなければ認証前に停止します。現在の本文を読んで要求を推測しません。認証・固定接続先・Publishable key制限・15秒タイムアウトは既存CLIを使用します。
認証後は `memo_resolve_request` を1回だけ呼びます。status=saved、ID・所有者・タイトル・本文・requestId・revision=2・ピン/ゴミ箱なし・タグなし・日時妥当性を確認した場合だけPASS。null・削除済みreceipt・不一致はこのケースのPASSにしません。保存時DB日時そのものは元記録にないため、その完全一致と現在状態は証明できません。
結果は `runs/<新UUID>.resolve.result.json` に排他新規作成し、過去記録を変更しません。本文・認証情報はログ/ファイルに保存しません。DB書き込み・自動再送なし。結果ファイル作成失敗はFAILですがDB変更はありません。
ローカル模擬テストは `node --test tools/memo-db-test/resolve-contract.test.mjs`。実DBテストは作成時に未実行です。

### 競合FAIL後の読み取り専用状態確認

```powershell
node tools/memo-db-test/inspect-conflict.mjs b3eb7c1b-9925-46ad-90eb-fb297071d808
```

引数は競合識別記録の実行UUIDです。固定接続先を検証し、競合・更新・作成の記録と両PASS結果を照合してから、同じユーザーで認証します。認証後のAPIは `memo_load_snapshot` 1回のみです。書き込み系RPC、SQL、再送、ファイル作成・変更は行いません。
各確認項目のPASS/FAILを表示し、HTTPエラーはステータス番号だけ表示します。通信失敗、HTTPエラー、応答JSON解析失敗を分け、サーバー応答本文や認証情報は表示・保存しません。全項目がPASSでも、元の競合テストの合格や日時不変を証明するものではありません。
構文チェックのみ実施し、接続・実DB動作は未検証です。設定・記録が不正、ユーザーが異なる場合は読み取りRPC前に停止します。

### 第3段階：古いrevisionによる更新競合

```powershell
node tools/memo-db-test/conflict-read.mjs <正常更新テストの実行UUID>
```

引数は `.update.json` のファイル名に含まれる実行UUIDです。メモIDや任意ファイルパスは受け付けません。更新識別記録・更新PASS結果・作成識別記録・作成PASS結果の対応、接続先、所有者、現在の本文・タイトル・requestId・revision=2・初期状態を確認します。
同じユーザーでログインし、`CONFLICT` と完全一致で入力した場合のみ、新しいrequestIdと古いrevision=1で `memo_save` を1回試みます。review8のHTTP 409、JSON code `PT409`、メッセージ `memo revision conflict` の3条件、および再読込した対象・対象外メモ・タグ・関連の不変を確認した場合だけPASSです。通信失敗や別エラーはPASSにしません。

送信前の `runs/<競合実行UUID>.conflict.json` とPASS時の `.conflict.result.json` は別ファイルへ排他的に新規作成します。元記録は変更しません。本文・認証情報・サーバーのエラー全文はログやファイルへ出力しません。自動再送・削除はありません。
期待外の成功や通信失敗ではDB変更済みの可能性があるため、記録IDで対象を確認してください。別端末による同時変更でもFAILになります。共通CLIには変更を加えていません。作成時点では未実行・実DB動作未検証です。

### 第2段階：正常更新と再読み込み

作成テストのPASS記録がある実行UUIDを引数に指定します（メモIDではありません）。

```powershell
node tools/memo-db-test/update-read.mjs <作成テストの実行UUID>
```

`runs/<UUID>.json` と `<UUID>.result.json` を検証し、同じユーザーでログインして対象を読み込みます。元のタイトル・本文・requestId・所有者・revision=1・初期状態・関連なしが一致するテストメモだけを許可します。任意パスや直接のメモID指定は受け付けません。識別記録は手動編集せず保管してください。

確認後に `UPDATE` の完全一致入力を求め、現在のrevisionを渡して本文を1回だけ更新します。再読み込みで本文、revision=2、更新日時、作成日時と他の全状態の維持、対象外データ不変を確認します。
送信前に `runs/<更新実行UUID>.update.json`、PASS後に別の `.update.result.json` を新規作成します。元の作成記録・結果は上書きしません。ファイル・ログに本文や認証情報は記録しません。
FAILや中断でも更新済みの可能性があります。自動再送・削除はありません。更新済みrevision=2の対象は再実行で更新前検証に失敗します。別端末の同時変更や時計の逆行でも照合がFAILになる場合があります。Windowsの記録ファイルの保護は親ディレクトリのアクセス権に従います。
この入口は未実行で、実DB動作は未検証です。競合・タグ操作・削除テストは含みません。

1. Supabase Dashboardで **dev-sandbox** を開き、SettingsのProject ID / Project Refを確認します。本番k-life-logの値は使用しません。
2. `cli.mjs` の `DEV_SANDBOX_PROJECT_REF` には開発環境のRefが設定済みです。DashboardのRefと一致することを確認します。固定ホストを検証する関連コードもあるため、独断で書き換えないでください。表示名dev-sandboxを入れる欄ではありません。
3. このディレクトリの `.env.example` を `.env.local` にコピーします。
4. dev-sandboxのProject URLと `sb_publishable_` 形式のPublishable keyを設定します。

```dotenv
SUPABASE_PROJECT_URL=https://確認したProjectRef.supabase.co
SUPABASE_PUBLISHABLE_KEY=確認したPublishableKey
```

RefはURL・キーとは別にコードへ固定します。空のままでは通信も認証情報の入力も行いません。
URLは固定RefのHTTPSホスト・ルートパスだけを許可し、リダイレクトも拒否します。
既存アプリの.envや環境変数からのフォールバックはありません。
設定は2項目だけで、空行・行頭コメント・値を囲む引用符に対応します。値末尾のコメントや変数展開は非対応です。
`.env.local` は専用.gitignoreで除外されます。強制追加はしないでください。

## 実行（ユーザーが実施）

リポジトリルートの対話型ターミナルで実行します。

```powershell
node tools/memo-db-test/cli.mjs
```

メールアドレス、非表示パスワードを入力します。Enterで確定、Backspaceで削除、Ctrl+Cで中止できます。
入力リダイレクトは受け付けません。パスワード欄は通常文字の入力用です。

認証成功時のみ `memo_load_snapshot` を1回呼びます。自動再試行はしません。
認証・RPCの成否と3配列の件数だけを出力します。HTTPエラー本文や返却データは表示しません。
失敗時の終了コードは1です。各通信のタイムアウトは15秒です。

## 注意

- このコードは作成時に未実行です。実DB接続の成功は未確認です。
- ログインはSupabase Authへの通信を行います。メモの保存・削除・SQL実行機能はありません。
- トークンと認証情報はファイル保存しません。セッションの自動更新・永続化もありません。
- JavaScriptの文字列をメモリから確実に消去する保証はありません。
- サーバー側で発行したセッションの失効処理は行いません。CLI終了後はサーバーの有効期限に従います。
- 成功判定は認証トークン取得とスナップショットの3配列の存在確認です。全レコードの内容検証・RLS分離検証は次段階です。
- service_role、secretキー、旧JWT形式キーは使用できません。
- NodeのHTTPデバッグ・外部プリロード等を有効にせず、通常の環境で実行してください。

ローカル模擬テスト: `node --test tools/memo-db-test/conflict-response.test.mjs`。dev-sandboxへのreview8適用が確認されるまで競合CLIを再実行しないでください。旧40001・誤HTTP状態・使用済みIDをPASSにしません。過去runs記録は旧契約の履歴として保持します。

