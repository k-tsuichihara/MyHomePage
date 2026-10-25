# ケース14：タグ名の重複判定

## SQL契約の静的調査

- review8本体memo_v1_1_schema_review8.sql:23–40は名前1〜30コードポイント・前後空白なし・禁止制御文字なしを検証する。SQLはtrim/NFC等の暗黙正規化をしない。
- 42–46のmemo_tag_keyはtranslateでASCII A–Zだけa–zにする。lower/citextは使わない。非ASCIIのÄ(U+00C4)/ä(U+00E4)は変更しない。
- 69–76のtagsは表示名nameをそのまま保存。id/user_id/name/created_at/revisionを持ちupdated_atはない。
- 76の一意インデックスtags_name_per_userは(user_id, memo_tag_key(name) COLLATE "C")。比較の照合順序が明示されており、DB既定の言語別照合を期待値に使わない。
- 274–292のmemo_save_tagは新規INSERTまたはID/所有者/revision一致UPDATE。ON CONFLICTの既存タグ返却・名前での更新はない。
- 名前重複は上記インデックスの一意違反23505。RPCは捕捉せずトランザクションが失敗する設計なので名前・revision等の更新は成立しない。
- 本体関数と6関数パッチ141–159は宣言CREATE OR REPLACE以外一致。パッチはキー関数やインデックスを再定義しない。
- snapshot311–319で自分のタグ全列、メモ、関連を比較。内部台帳の直接読取は不可。タグ操作にはrequestId/要求台帳がなく照合RPCを使わない。
- 仕様書12–19はASCIIだけの折りたたみ、非ASCII非変換、Unicode正規化なしを明記。非ASCIIのÄ/äは仕様上別名。

## 環境に依存する項目（SQL契約と混同しない）

SQLはカスタムの重複messageやHTTPステータスを定義していない。23505→HTTP409はPostgRESTの変換に依存する。
本CLIの厳密照合対象messageは英語標準形：duplicate key value violates unique constraint "tags_name_per_user"。
これはSQLが固定した文字列ではなく、サーバーのlc_messages・実際のインデックス名・APIの応答形式に依存する試験条件。
別言語/別名ならFAILで停止し、任意の23505をPASSにしない。レスポンス全文やエラー詳細にはタグ名が含まれ得るためログ/記録しない。

実DB適用済みのキー関数・明示C照合・一意インデックスと英語message環境は今回未確認。
静的レビューだけでこれらを確認済みとは扱わない。安全な代替は、書き込み前にダッシュボード等で既存定義とlc_messagesを読み取り専用確認すること。
メッセージ差が見つかった場合は、実エラー全文を共有せず、言語と制約名だけを確認してテスト契約を再検討する。
本体とパッチの一致はローカルの資料間の確認であり稼働DBとの一致ではない。
NFC/NFD同値文字列、合字、トルコ語I、日本語の表記揺れや任意の非ASCIIの全比較には一般化しない。

## 比較パターンと手順

タグ名はrun UUIDの先頭24桁hexをsuffixとし、各29コードポイント。対象IDは新規5 UUIDを予約する。
作成前に全候補IDと候補名のASCIIキーが既存タグと衝突しないことをsnapshotで確認する。

| 操作 | 内容 | 期待 |
|---|---|---|
| create-ascii | T14A-suffixを新規作成 | 新規タグrevision1 |
| duplicate-exact | 別IDで同じ表示名を作成 | HTTP409/23505/厳密message、全データ不変 |
| duplicate-ascii | 別IDでt14a-suffixを作成 | 同上 |
| create-nonascii-upper | T14Ä-suffixを作成 | 別タグrevision1 |
| create-nonascii-lower | T14ä-suffixを作成 | 別タグrevision1 |
| rename-duplicate | ä側をÄ側と完全一致の名前に変更、expected_revision1 | 同上の拒否、名前・revision・created_at等不変 |

各成功後に全snapshotで意図した1件追加だけを許可。各拒否後は全snapshot不変を要求する。
各書き込み前に対象・引数（テスト用名）・影響範囲を表示し、表示操作名を大文字で入力して個別確認する。
想定外の成功/拒否、HTTP/code/message不一致、通信例外・タイムアウト・JSON不正・状態不一致・キャンセル・記録失敗は停止。
自動再送・削除・復旧・ロールバック操作なし。各通信15秒期限・リダイレクト拒否。
クライアント中断はサーバー処理終了を保証しない。失敗後は再実行せず、IDを使って読み取り専用確認する。

## 実行・記録

Node.js22以上・対話ターミナルでリポジトリルートから：

```powershell
node tools/memo-db-test/tag-duplicate-read.mjs
```

共通CLIのdev-sandbox固定Project Ref・Publishable key制限・非表示パスワードを利用。
最大13 RPC（save_tag6・snapshot7）、確認6回、別途認証1回。
正常時は専用タグ3件がそれぞれrevision1で残る。メモ作成・タグ削除・関連変更はしない。
失敗時は0〜3件、誤成功時には追加タグ/予期しない変更が残り得るが自動修復しない。

runs/<runId>.tag-duplicate.jsonに識別記録、各操作.result.jsonに段階結果、総合.result.jsonまたは.failure.jsonをwxで新規作成。
識別記録保存失敗なら書き込みに進まない。段階PASSは総合PASSと区別。preparedは未送信の証明ではない。
記録にはID・時刻・固定パターンラベル・一致フラグだけを含め、タグ名実値・認証情報・応答全文は保存しない。
既存コード・SQL・過去PASS対象/記録は変更しない。実DB実行は別途許可後。

```powershell
node --check tools/memo-db-test/tag-duplicate-read.mjs
node --check tools/memo-db-test/tag-duplicate-contract.mjs
node --check tools/memo-db-test/tag-duplicate-contract.test.mjs
node --test tools/memo-db-test/tag-duplicate-contract.test.mjs
```

実ネットワークを禁止した模擬検証。比較結果のSQL上の期待と実DBでの観測を区別し、未実行時は実DB観測なしと報告する。
