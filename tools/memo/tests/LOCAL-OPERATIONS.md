# タグ管理・ピン・ゴミ箱・使用件数の契約とテスト方針

根拠：[review8統合仕様§1〜5](../doc/v1.1.0/memo_v1_1_implementation_review8.md)、[スキーマSQL](../doc/v1.1.0/memo_v1_1_schema_review8.sql)、[差分パッチ](../doc/v1.1.0/memo_v1_1_conflict_patch_review8.sql)、[承認済みローカル保存契約](LOCAL-SAVE.md)。模擬保存先・時計・ロックだけを使い、正式資料原本・既存画面・実localStorage・実DBには接続／変更しない。

## 追加操作

- 同一ストアにchangeState、saveTag、deleteTagを追加する。saveを含む全変更操作で、requestId使用済み集合・受付時登録・再利用拒否を共用する。登録はrequestIdのUUID検証後、他の検証・ロック取得より前。失敗・unknownでも解除しない。
- changeStateの入力はid/action/expectedRevision/requestId。actionはpin/unpin/trash/restore。対象メモが存在し、期待revision一致・上限未満であることを要求する。pin/unpin/trashは通常メモだけ、restoreはゴミ箱内だけ許可。
- スキーマSQL219〜220行・差分パッチ86〜87行では、trash/restoreはpinned_atを変更しない。ローカルもpinnedAtを保持し、trashはdeletedAt=時計、restoreはnullにする。pinはpinnedAt=時計、unpinはnull。全状態操作でupdatedAt更新・revision+1。本文・関連・createdAt・lastRequestIdは保持する。同じ状態のpin/unpinもSQL同様に更新する。
- saveTagの入力はid/name/expectedRevision/requestId。作成はexpectedRevision=null、現存タグIDとの同値重複を拒否しrevision=1・createdAt=時計。改名は期待revision一致・加算可能を要求しcreatedAtを保持、revision+1。新規入力規則で整形・検証し、ASCII限定キーで名前重複を拒否する。メモ・関連は変更しない。
- deleteTagの入力はid/expectedRevision/requestId。明示メソッド呼出しでだけ削除する。タグrevisionを照合し、関連メモ全件（ゴミ箱含む）の整合性とrevision加算可能性を保存前に確認する。1件でも不適合なら全体拒否。タグと関連を除去し、関連メモのrevision+1・updatedAt更新を単一JSONへまとめる。タグに関連しないメモは保持する。
- ローカルでは状態操作・タグ削除でも関連メモのlastRequestIdを保持する。クラウドSQLの状態操作でrequestIdを記録する動作、タグ削除でnullにする動作とは異なる承認済みA案。成功照合には使わない。
- タグ使用件数はcountTagUsageによる純粋な集計。MemoDataを全件検証し、ゴミ箱外のメモだけを数える。タグマスターの順序・ID表記を保持し、未使用タグも0件で返す。件数列を永続化しない。
- タグ作成も明示操作として、両キーなしからnot-requiredを含むタグデータを1回書込できる。読込時の自動初期化はしない。
- 全変更で共通Web Locks・新旧キー再確認・全体候補検証・1回のJSON書込・読戻しを共用。書込後の異常はunknown、自動再送・削除・ロールバックなし。旧キー・移行メタデータを保護する。

## テスト方針

| 観点 | 期待結果 |
|---|---|
| 状態遷移 | 各actionのフィールド保持・日時・revision、pin済みのtrash→restoreで元のピン保持、不正状態・競合・上限拒否 |
| タグ管理 | 正常作成/改名、ASCII大小文字重複拒否・非ASCII区別、Unicode境界、ID/期待revision、メモrevision不変 |
| タグ削除 | 通常/ゴミ箱の全関連更新、未使用タグ、複数関連の1件が上限/孤立なら未書込拒否、対象外不変、lastRequestIdのSQLとの差異 |
| 使用件数 | trashで減少・restoreで復帰、複数タグ/未使用タグ、UUID大小文字、入力不変、不正関連は拒否 |
| 共通安全性 | 操作間のrequestId再利用拒否、入力不正時のID消費、競合・同時操作、未知項目、書込・読戻し障害、既存461件の回帰 |

型チェック・全Vitest・差分検査を完了条件とする。確認UI、完全削除・ゴミ箱を空にする処理、削除済みメモIDの永続registryは対象外。実ブラウザ・実Web Locks・複数タブ・容量上限、TS/SQL一致・クラウド接続ゲートは未検証のまま後続へ引き継ぐ。専用の隔離環境・生成JS・テスト配信と成果物の非公開方針・対象ブラウザを接続工程で承認後に準備する。モックの障害注入を実ブラウザ検証済みとは扱わない。
