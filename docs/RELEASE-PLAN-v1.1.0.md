# メモツール v1.1.0 リリース進捗管理

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
| Q04 | 実RPC・SQL/TS一致・Auth/RLS/GRANT・障害/競合検証 | 進行中 | [実行記録](../tools/memo-db-test/Q04-RESULTS.md)、[Step 4準備](../tools/memo-db-test/Q04-PREPARATION.md)、[過去DB33試験](../tools/memo-db-test/TEST-SUMMARY-2026-10-25.md) | Step 3のS04差分確認は完了。証拠の限界・残置タグ/メモ保持・再実行禁止を維持。Step 4第1単位のAuth UIに続き、第2単位のC04 load/C05保存先選択に続き、第5単位のcloud新規単件作成/save/明示resolveまでfake Chromiumで確認。通常product entryはlocal-only。実SDK生成・実製品通信・状態変更等の残りwriteは未接続。製品実環境受入・single-rpcは未検証。全体PASS/cleanupなし |
| Q05 | 実機・IME・主要操作・ドラフト保護・アクセシビリティ等の受入範囲確認 | 要確認 | ブラウザ契約、Phase Bの未検証事項、今回のオーナー合意 | 必要。Windows + Chrome中心を想定し、日本語IME・主要操作・編集中データ保護を重視。Firefox・Safari/WebKit等は後回し。スマホ実機を含む正式検証範囲・対応対象は後日確定し、対象外と断定しない |

## 7. 本番移行・公開

| タスクID | 作業内容 | ステータス | 根拠となるファイル・PR | 備考 |
|---|---|---|---|---|
| R01 | 全体進捗表の初期作成と人間レビュー | 完了 | 本ファイル、[PR #47](https://github.com/k-tsuichihara/MyHomePage/pull/47)、今回のオーナー合意 | 必要。PR #47マージにより初期作成・レビューの範囲は完了。今回の方針反映はレビュー待ち。以後も運用ルールに従い更新する |
| R02 | TS製品入口・ビルド配信・既存公開UI統合 | 完了 | [製品UI統合契約](../tools/memo/tests/PRODUCT-UI-INTEGRATION.md)、package.json、PR #69〜#77と今回の初期復元/保守候補 | local製品候補のAI実装・オフライン検証範囲でCOMPLETE、今回差分はレビュー待ち。音声・v3導入・バックアップ/各復元と停止保守候補、資産整合性を接続。公開HTML実切替はR05、実データはR03、公開構成/受入はR04/Q05、Auth/cloud製品接続はC03〜C05へ残す。single-rpc未認定。権限課題R02とは別 |
| R03 | 実ユーザーv2導入元確認・v3更新・旧タブ並行利用対策 | 要確認 | v3契約、切替設計、今回のオーナー合意 | 必要。人間が実データ保護を確認し、移行実行は別承認。隔離許可を本番へ流用しない。旧JS書込・キー分岐・互換性の残課題を維持 |
| R04 | Pages設定・公開資産・本番DB/権限・公開前ゲート確認 | 要確認 | 切替設計、AGENTS.md§14・15、DB監査記録、今回のオーナー合意 | 必要。AIは検証準備、人間は本番設定確認・公開承認。Pages公開元/配信方式は未確認でmain/(root)と断定しない。開発監査成功は本番適用承認ではない |
| R05 | 承認済み公開切替・停止保守版・復旧手順の製品化/適用 | 未着手 | 切替設計、v3契約、今回のオーナー合意 | 必要。公開切替・公開後確認を含む。v3対応の書込停止保守版とコードrollback/データ復旧の分離が必要。AIは準備を担当し、公開・移行・権限変更の実行は人間の別承認後に限る |

## 8. リリース後の運用・改善

| タスクID | 作業内容 | ステータス | 根拠となるファイル・PR | 備考 |
|---|---|---|---|---|
| O01 | レビュー・承認・未検証事項引継ぎの運用整備 | 完了 | [共通AGENTS](../AGENTS.md)、[メモAGENTS](../tools/memo/AGENTS.md)、PR #4・#6 | 運用ルールの整備完了。実行権限を包括承認しない |
| O02 | 公開後の障害案内・停止/復旧・利用者告知の運用確定 | 要確認 | 切替設計の停止/復旧・告知項目、今回のオーナー合意 | 必要。R05の復旧手順を再利用し、製品用の担当・連絡・案内を整備。最終受入は未完了 |
| O03 | バックアップ保管・平文情報・履歴喪失等の利用者案内 | 要確認 | バックアップ設計/出力契約、初期復元契約、今回のオーナー合意 | 必要。バックアップ・平文データ・履歴消失等の注意事項を整備。隔離UIの説明と製品版の案内・受入を区別 |
| O04 | 既存監査記録・ACL原本の保管/廃棄方針整理 | 要確認 | R02計画の承認単位1・R02完了チェック、今回のオーナー合意 | 範囲限定で必要。既存監査記録の保管・廃棄方針整理に限定。オーナーのみ原本を保管/閲覧/完全性確認。T02完全性と最終破棄判断は未完了。実廃棄の承認を意味せず原本・内部値は掲載しない |
| O05 | 延期項目の記録 | 要確認 | 各契約の残課題、今回のオーナー合意 | 最低限必要。延期項目の記録に限定し、次バージョンの詳細設計は行わない。具体的な延期項目は承認なく確定しない |

## 照合の限界・レビュー事項

- 最新のT00〜T05取得完了とT02完全性未確定は、チャットでのオーナー報告を根拠に本表へ記録した。既存監査文書には準備当時の未実施記録が残る。今回はそれらを編集せず、原本を取得・参照していない。
- READMEやRELEASE-TRANSITION.md、V3-CONTRACT.md等の当初の未実装記載と、後続PR #16〜#29の実装が異なる箇所は、後続コード・契約・マージ履歴を優先して進捗を整理した。正式仕様そのものの変更ではない。
- 音声入力は初期整理時に未実装だったが、今回製品候補へ新規音声メモ・本文追記・手動保存を接続しfake/Chromiumで検証する。実マイク・権限UI・認識精度は未検証でQ05へ引き継ぎ、製品受入完了とは扱わない。隔離メモリUIは引き続き対象外。
- 公開サイトの現物、Pages設定、本番DB、実ユーザーデータ、Auth状態、非公開監査原本は確認していない。現在の本番状態をローカルコードや開発監査だけで断定しない。
- 固定の過去テスト件数は記録時点の結果。最新mainの実行結果や、全環境の保証ではない。テスト定義の存在だけでPASSとしない。
- 自動同期・自動転送・障害時の自動fallbackは現行正式仕様上の対象外であり、残作業として追加しない。

## 追加提案（未承認・確定タスク外）

初期作成時点の追加提案はなし。今後の提案は根拠・影響・承認状態をここへ記載し、承認されるまで上表へ確定追加しない。
