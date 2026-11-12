# Human Gate Lessons Learned

## 1. 背景と目的

メモツールでは、Auth・読み取りRPC・書込みRPCを含む実環境経路を、AIだけで確認できる範囲と人間の明示操作が必要な範囲に分離するためHuman Gateを導入した。目的は、実Supabaseへの副作用、秘密情報の露出、意図しない書込みを抑えながら、最後の実環境確認だけを最小回数で行うことだった。

AI Gateは、仕様確認、静的解析、単体・結合・ブラウザ試験、fake endpoint、回帰、失敗再現、観測値のサニタイズを担当する。Human Gateは、実環境への最終承認、意図した環境・ユーザーの確認、AIでは代替できない実通信を担当する。Authとread/writeを分離したのは、認証失敗時にRPCへ進ませず、読み取り試験で書込み副作用をゼロにするためである。

## 2. 有効だった設計

実装・試験履歴から、次の制御は実際に有効だった。

- retry 0、fallbackなし、redirect禁止、固定origin/pathのallowlist。
- Auth開始と読み取り開始を分離し、Auth失敗時はRPC/writeを0件で停止。
- `memo_load_snapshot`のみを許可し、書込みRPCを0件に固定。
- synthetic user/fake transport、専用loopback、専用browser profile、Persistence Permit。
- email/password/token/UUID/本文を観測値・ログ・証跡へ出さない構造化診断。
- CSPとPlaywright routeを併用し、CSPだけを安全境界にしなかったこと。
- offline fake endpointでCSP許可・拒否、route許可・拒否を比較できたこと。
- Human Gate前にAI Gateで通信回数、二重操作、dispose、generation変更を検証したこと。

## 3. 時間がかかった原因

以下は履歴から確認できる工程上の教訓である。一部の因果関係は推測を含む。

- Human Gate Ready判定前に人間試験へ近づき、診断不足のまま実行したため、診断追加と再試験の往復が発生した。
- `auth-blocked`、`auth-unavailable`、network failureの区別を後から追加した。主要checkpointと失敗分類を最初に定義すべきだった。
- 専用runnerの問題と製品経路の問題を、同じ試験結果から切り分けようとしたため、runner自体の検証コストが増えた。
- 安全性向上のための診断・runner拡張が、個人用アプリの本来の価値から独立した目的になりかけた。

## 4. 最初からやり直す場合の推奨フロー

仕様 → 実装 → AI Gate → offline/fake integration → Human Gate Ready判定 → Human Gate最小実行 → 製品経路確認、の順にする。

Human Gate前にAIだけで確認する項目は、固定origin/path、Auth/read/write分離、retry/fallback/redirect、通信回数上限、秘密情報非露出、fake transportでの正常・異常、二重操作、dispose、UNKNOWN停止、結果保存の構造である。これらが未確認なら人間試験へ進めない。人間にはコード変更、環境変数の手組み、DevTools解析を要求しない。

## 5. Human Gateの停止条件

- 同一条件の再試行をしない。次回実行で新しい証拠が得られる場合だけ再実行する。
- Human Gateの回数をコストとして扱い、各回の目的と取得証拠を事前に一つに絞る。
- 診断基盤自体にも完成条件を置き、原因100%証明を目的にしない。
- UNKNOWN、通信断、結果不明では自動再試行しない。
- 個人用アプリでは、残る問題が実環境固有で製品側の明確な不具合がない場合、費用対効果に基づき調査を打ち切る。

## 6. UNKNOWNの扱い

UNKNOWNはFAILではないが、成功でもない。未観測は拒否を意味せず、provider responseなしはcredentials不正を意味しない。static PASSはlive PASSではなく、test harness failureはproduct failureではない。証拠がない状態を勝手に成功・失敗へ昇格させず、configured / observed-verified / unknown / recheck-neededを分けて記録する。

## 7. AI GateとHuman Gateの責任分離

AI Gateは機械的に代替できる確認を最大限引き受ける。Human Gateは実環境への最終承認、意図確認、避けられない実操作だけを担う。人間をテスト自動化の代替にしてはならない。人間が見るのは、サニタイズ済み結果と意図した振る舞いであり、DevToolsやログ解析ではない。

## 8. Safe DB Runnerへ転用できる原則

- 提案主体と実行主体を分離し、人間承認を最終境界に置く。
- 承認前にAI Gateで静的・機械的検証を尽くす。
- 結果を成功・失敗・要確認・UNKNOWN等で明示し、UNKNOWN時は自動再試行しない。
- 実行証拠を構造化し、秘密・生本文・不要な個人情報を保存しない。
- 環境情報を一度確認済みなら、具体的な変更理由なしに再確認しない。
- configured / observed-verified / unknown / recheck-neededを状態として管理する。
- harness自身の失敗と対象DB操作の失敗を別分類にする。
- human execution countをコストとして、各実行の目的と停止条件を事前定義する。

これはSafe DB Runnerの仕様そのものではない。脅威モデル、権限境界、復旧要件は対象プロジェクトごとに再評価する。

## 9. 過剰設計を防ぐ原則

安全性を下げるのではなく、守る対象・想定リスク・アプリ規模に対して合理的な安全性を目標にする。個人用アプリと企業向け高保証システムに同じGate、診断深度、証跡要件を課さない。診断機能やrunnerは、次の意思決定に必要な情報を得た時点で止める。

## 10. Human Gate #6時点の最終状態

最新mainで実施した正式な#6は、Auth 1回、RPC/write 0、`auth-unavailable`、Auth transport開始後にHTTP responseとPlaywright route観測がないnetwork failureだった。offlineではCSP拒否時に同型の挙動を再現できたが、実環境の根本原因は確定していない。credentials不正、provider障害、通常製品経路の不具合とは断定していない。

追加のHuman Gateや汎用診断基盤を続ける費用対効果は低く、個人用アプリとして調査を打ち切り、既知課題として保留する判断とした。`single-rpc`は未認定、実Auth/RPC/RLSのlive検証も未完了である。

## 11. 今後のチェックリスト

- [ ] Human Gate前にAI Gateの機械的確認を完了した。
- [ ] 一回のHuman Gateで得る新証拠を一つに定義した。
- [ ] STOP/UNKNOWN後の自動再試行がない。
- [ ] harness failureと製品・DB failureを分離している。
- [ ] live PASSとstatic/offline PASSを混同していない。
- [ ] 調査打ち切り条件を、アプリ規模とリスクに応じて合意した。
