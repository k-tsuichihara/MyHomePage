# 通信なしSupabase RPC境界の契約・テスト方針

根拠はReview8統合仕様§4・6・7、正式SQL・型、既存validateCloudSnapshot。今回の承認は模擬通信による限定先行実装だけで、SQL/TS実DB一致ゲート、Auth、公開接続を解除しない。

## 境界

`createCloudRpcAdapter(ownerId, transport)`は固定した期待所有者と、HTTP status・解析済みbodyを返す注入関数だけを受ける。fetch、SDK、URL、認証情報、localStorage、UIには接続しない。通信先は自動再試行せず、解析失敗も例外として伝える責務を持つ。製品用通信実装は今回作らない。

load / save / resolve / changeState / deletePermanently / emptyTrash / saveTag / deleteTagを8つの正式RPCへ対応付ける。これは画面用MemoRepositoryの完成ではなく、null照合や失敗理由を失わない低レベル境界である。形式・所有者・参照整合性を検証し、snake_caseをcamelCaseへ明示変換、revisionを安全整数に変換する。

- `ok`、送信前`not-attempted`、確定的な`rejected`、読取`failed`、書込`unknown`を区別する。所有者不一致・不正応答・通信失敗・未分類HTTPは理由で区別。
- 成功応答はJSON RPCでHTTP200、void RPCでHTTP204かつ本文なしを要求。loadのnullはpermission拒否、resolveのnullはno-recordで未実行とは断定しない。saved照合はhistoricalな結果でcurrentMayDiffer=true。削除済みreceiptは現存メモへ変換しない。
- HTTP409+PT409+操作別既知メッセージだけを業務競合とする。未知PT409、誤HTTP、40001を競合へ読み替えない。23505等の制約拒否とrevision競合を分ける。P0002の状態要求削除済み履歴も通常成功と分離する。
- 入力は正規化済み値を要求し、暗黙補正しない。UUID同値性・重複・正の安全整数revision・対象ID・要求内容と応答の対応を確認する。現在タグを再取得して歴史的receiptを拒否しない。
- 全送信内容と所有者を非公開メモリ内の不変スナップショットとして返す。書込unknownでも保持し、ログへ出さない。要求台帳やローカルA案の使用済み集合は作らない。同内容・同requestIdの明示再呼出しは可能だが、自動照合・自動再送・削除後の自動再実行は行わない。
- adapterは状態を持たず、古い応答をUIへ反映しない。保存先・認証ユーザー・画面session・operation世代と現在状態の照合は後続controllerの責務。固定所有者のadapterを別ユーザーへ使い回さない。未完了Promiseの順序逆転をテストし、adapterが画面更新や結果上書きを行わないことを確認する。
- saveと状態RPCも過去要求の行を返す場合があるためcurrentMayDiffer=trueを付ける。これはクライアント側結果メタデータであり、正式RPCへ新フィールドを追加するものではない。

## テスト観点

| 対象 | 期待結果 |
|---|---|
| 全8RPC | 正式引数と応答、void204、件数整数、pin/unpin/trash/restore、未知フィールド拒否 |
| DB行 | UUID/日時/revision/所有者、メモ・タグ・関連の欠落/未知/重複/孤立を拒否。入力独立性 |
| 保存・照合 | 凍結内容、canonicalなタグ集合、正常保存、履歴saved、redacted receipt、null区別、要求と異なる応答拒否 |
| 異常 | HTTP+SQLSTATE+操作の分類、通信失敗、不正応答、所有者不一致を区別、書込unknown保持 |
| 非同期 | 入力の後続変更、応答順序逆転、例外時も1呼出しだけ、同requestIdの明示呼出しをローカルA案で拒否しない |
| 非接続 | transportはテスト内の合成関数のみ。ローカル保存/復元・Auth・UI・SQL原本の変更なし |

型チェック・全Vitest・既存メモリ/永続化/形式/切替E2E・4ビルド・差分検査を回帰実行する。新たな実DB試験は実施しない。

## 未検証・後続

SDK/HTTP接続、JWT/セッション、RLS、SQL/TS共通ベクトルの実DB一致、実RPCの複合行表現・HTTP動作は後続の承認付き検証が必要。過去のDBテストは根拠資料であって今回の実通信結果ではない。削除結果不明後の元対象限定の再取得・認証保証、同内容再試行のUI承認、保存先/session照合も後続。resolveのnullを正式型のnot-appliedへ変換しない（統合仕様の未実行非保証を優先）。

## 実施結果（2026-11-01）

基準main: `16906e1843fe962fa05b33c26ceb63a70e34c3ef`。Windows / Node.js / 既存の固定バージョンのTypeScript・Vitest・esbuild・Playwrightを使用し、依存追加なし。

- 型チェック: PASS
- 全Vitest: 29ファイル、1,207件PASS（既存1,114件＋RPC契約93件）
- 既存メモリE2E: 83件PASS
- 既存隔離永続化E2E: 22件PASS、未検証0件
- 既存形式更新/削除E2E: 16件PASS
- 既存切り替えE2E: 20件PASS、未検証0件
- preview / persistence / format / transitionビルド: PASS
- 差分チェック: PASS

RPCの93件はすべて注入した合成関数で実行し、実HTTP・Supabase/Auth・DBは未接続。既存E2Eの実API利用は従来の所有profile・loopback・合成データ境界だけで、新アダプターはUIへ接続していない。遅延試験は各要求が独立した結果を返す範囲の検証であり、未実装のクラウド画面制御やユーザー切替の安全性を実証したものではない。既存SQL・型原本・ローカル保存/復元・公開資産の変更なし。
