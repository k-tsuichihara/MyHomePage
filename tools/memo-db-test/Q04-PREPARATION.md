# Q04：公開前の実権限・API確認準備

基準：PR #79マージ後main `8ef563c`。実DB/SQL/Auth/RPC操作は今回0件。
Q04は**進行中・実環境未実施**。S04 COMPLETEはrepository準備範囲であり、実権限変更済みではない。
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

全33件の再実行はしない。helper撤回という**具体的な変更**により、次の既存ケースだけが再検証対象になる。合成専用の新規run/対象を使い、過去PASS対象は変更しない。

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
