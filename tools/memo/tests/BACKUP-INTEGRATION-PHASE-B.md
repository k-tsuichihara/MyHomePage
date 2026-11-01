# Step 6 Phase B：隔離ブラウザ永続化の横断試験

Phase Aマージ済みmainを基準とする。製品src・公開画面・メモリE2E禁止ガードは変更しない。既存persistenceランナーの所有プロファイル・専用loopback origin・permit・外部通信遮断・失敗時保全・所有検証後破棄を再利用する。安全条件を満たせなければStorage取得前に停止する。

## シナリオ

| ID | 実施内容 | 必須の期待値 |
|---|---|---|
| B01 | 新規profileへ空v3合成fixtureを一度だけ投入、通常CRUD・タグ・ピン・ゴミ箱・完全削除→実出力 | Phase Aと同じID/日時/revisionのメモ、タグ・関連・履歴。出力0書込、保存先不変 |
| B02 | 実出力→既存v3への追加型復元→reload→Context終了/同profile再起動 | 既存データ/履歴保護、新ID/新日時/revision=1/lastRequestId=null、タグ統合、pin/trash契約、全体保持 |
| B03 | 実出力後に完全削除→単件回復→同profile再起動 | 原ID履歴、新ID通常メモ、非ピン、現在タグだけ、再起動後保持 |
| B04 | B01出力→別の新規profileの両キー不在から初期復元→再起動 | 元ID・全属性・配列順序・履歴が一致。既存profileの消去なし |
| B05 | 同origin複数タブ、確認後変更・実Web Locks待機・競合・明示再読込 | 方式ごとの競合条件で拒否。待機中の状態、保持タブ終了後の解放、保存先無変更 |
| B06 | 最後の独立profileで実容量不足→追加型復元 | 上限内で実QuotaExceededErrorを観測しunknownで停止。既存JSON不変、無自動再送/削除。未再現はUNVERIFIED |

容量投入は既存fixtureの32試行・合計16 Mi文字以下を維持する。経過時間も測定し5秒を超える場合は容量シナリオを未検証とする。同期Storage呼出単体を途中で強制中断できる保証ではない。入力JSONのUTF-8 10 MiB制限とは別に扱う。アプリ用アダプターへ旧キー書込・削除・clearを追加しない。

新入口は固定の/backupと/backup.jsだけを既存サーバーに追加する。既存entryのAPI禁止を再利用し、実保存先を使うのは所有permitが有効な入口だけ。任意profile/任意origin/storageStateを受け取らない。生profile・パス・本文・バックアップJSONをPR/ログへ出さない。

## 回帰・完了条件

型チェック、全Vitest、既存メモリE2E、永続化E2E（B01〜B06含む）、形式更新・切替E2E、全ビルド、差分検査。製品不具合・仕様矛盾・ガード問題があれば修正せず停止する。失敗profileは既存契約で保全し、そのまま任意パスの削除を試みない。

Firefox/WebKitは今回は実行しない。メモリPlaywright設定と永続化ランナーはChromium固定で、他エンジンのpersistent起動・secure context/Web Locks・容量・外部通信制限の対応確認が後続に必要。実機・OS電源断/ディスク障害・公開切替・Supabase/Authは対象外。成功は本番公開承認を意味しない。

## 実測結果（2026-11-01）

基準main: `80defb6225e3d77d42b3f50a7235dfd629e5fb4c`（Phase Aマージ済み）。Windows、Playwright管理Chromium、headlessで実施した。

| ID | 結果 | 観測した範囲 |
|---|---|---|
| B01 | PASS | 実Storageから生成したJSONを属性・関連・履歴と照合。出力前後の両キーと書込試行数が一致 |
| B02 | PASS | 追加型復元の属性と既存データ保持、reloadとContext終了後の同所有profile再起動で全体一致 |
| B03 | PASS | 完全削除後に新IDへ回復し、元ID履歴を保持。Context終了後の再起動で全体一致 |
| B04 | PASS | 別の空profileへ初期復元し、配列順序を含む全体一致。reload・再起動後も一致 |
| B05 | PASS | 確認後の別タブ編集で拒否・無変更。実ロック待機、保持タブ終了で解放。同revisionの同時編集は一方成功・一方拒否、明示読込後に一致 |
| B06 | PASS | 実QuotaExceededErrorを観測。32試行・投入試行計6,289,920文字・8ms。追加型復元の書込試行でも実容量例外を観測しunknown。既存JSONと書込成功数は不変、直後150msの観測中に自動再試行なし |

Phase Bでは3ケースで実際にContextを終了し同profileを再起動した。OS再起動・突然の電源断を再現したものではない。B06の文字数は失敗分を含む投入試行量で、保存成功バイト数やJSONの入力上限を表さない。割当容量・所要時間は環境依存。

- 型チェック: PASS
- Vitest: 28ファイル、1,114件PASS（既存1,112件＋容量上限補助の2件）
- メモリE2E: 83件PASS
- 永続化E2E: 22件PASS、未検証0件（既存16件＋B01〜B06）。新入口も未許可時Storage取得0件を確認
- 形式更新/削除E2E: 16件PASS
- 切り替えE2E: 20件PASS、未検証0件
- preview/persistence/format/transitionの4ビルド: PASS
- `git diff --check`: PASS

バックアップは実出力APIが生成した文字列をランナーのメモリ内で次ケースへ渡し、実ファイル保存・OSダウンロード成功はこの追加試験の対象外（既存メモリE2Eがダウンロード導線を検証）。確認・復元は既存controller、通常保存・削除は既存storeを利用し、新たな製品保存経路は追加していない。

製品コードの不具合・安全ガードの回避・追加仕様判断は検出していない。製品src、公開HTML/JS/CSS、旧キー、既存メモリE2Eガード、プロファイル所有/失敗時保全処理の変更は0件。Supabase/Auth、実ユーザーデータ、本番originへの接続なし。
