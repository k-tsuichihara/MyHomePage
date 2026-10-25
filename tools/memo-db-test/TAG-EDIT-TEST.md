# ケース13：タグ作成・名前変更・revision競合

## review8 SQL契約（静的調査）

- 本体memo_v1_1_schema_review8.sql:274–292、パッチmemo_v1_1_conflict_patch_review8.sql:141–159のmemo_save_tag。
- 引数p_id uuid, p_name text, p_expected_revision bigint。戻り値public.tagsの行。
- UUIDはクライアントが発行。user_idはauth.uid()、作成日時はDBのnow()。タグはid、user_id、name、created_at、revisionを持ち、updated_atやlast_request_idはない（本体69–76）。
- 認証→ユーザー単位ロック→入力検証(280–282)→expected_revision=nullなら作成、指定ありなら所有者・ID・revision一致を条件に更新(287–289)。
- 作成revision1。名前変更はrevision+1、ID・所有者・created_atは維持。
- UPDATE対象がなければPT409 / HTTP409 / tag revision conflict。存在しないID・他所有者もこの拒否に含まれるため、本ケースは所有済み専用タグと古いrevisionで検証する。
- p_id=null、無効名、revisionが1未満または9007199254740991超過は22023 / invalid tag input。
- memo_valid_text（23–40）で名前は1〜30 Unicodeコードポイント、前後空白なし、禁止制御文字・内部改行区切りなし。null/空名を拒否。
- SQLはtrimやUnicode正規化を暗黙適用しない。仕様書12–19行のUI/TSでの前後空白処理と、正規化済み値を検証するDBを区別する。
- 名前一意制約は本体77行の(user_id, memo_tag_key(name) COLLATE C)。42–46行のキーはASCII A–Zだけ小文字化し、非ASCIIを変換しない。
- 完全一致/ASCII同一キーの重複は23505の一意違反。カスタムメッセージは定義されていない。本ケースでは名前重複を試さない。
- requestId引数・要求台帳INSERT・冪等な履歴返却なし。再送に関する保証を仮定せず、通信不明でも再送しない。memo_resolve_requestも使用しない。
- タグ作成/名前変更はメモ・関連を書き換えない。関連済みメモのrevisionも名前変更では増加しない。今回は関連なしの専用タグなので関連済みメモへの影響は直接実証しない。
- memo_load_snapshot（311–319）で自分のタグ全列とメモ・関連を一貫した形式で比較できる。内部台帳は90–99行で直接読取不可だが、本RPCには台帳処理自体がない。
- 本体とパッチはCREATE OR REPLACEの宣言差以外、同じ関数定義。SQLは変更しない。

採用する競合は名前変更後の古いexpected_revision=1。正確なカスタムエラーがあり、専用タグ1件で安全に隔離できる。
ケース14にASCII大小文字・非ASCIIの重複判定、基本的な完全一致重複を残す。入力規則の全境界・他ユーザー・関連付きメモの検証も本ケースの対象外。

## 実行手順・安全性

Node.js 22以上・対話ターミナルでリポジトリルートから：

```powershell
node tools/memo-db-test/tag-edit-read.mjs
```

共通CLIのdev-sandbox固定Project Ref照合とPublishable key制限を通信前に適用し、非表示パスワードで認証する。
新規run/tag UUIDはrunsの過去UUIDを避ける。タグ名はT13A-/T13B-/T13C-とrun UUID先頭24桁hexの29文字。
既存タグのIDと、候補名のASCIIキーの衝突を作成前snapshotで検査し、衝突時は停止する（自動生成し直して再送しない）。
準備済み識別記録の新規保存成功後だけ書き込みへ進む。

1. snapshot取得。
2. 対象・引数・影響範囲を確認しCREATE入力。専用タグ作成、revision1・ID・名前・所有者・created_atを検証。
3. snapshotで対象タグが1件だけ増え、メモ・他タグ・関連が不変であることを確認。
4. RENAME入力後、同じタグID・expected_revision=1で別の一意名へ変更。revision2、その他の列不変を検証しsnapshot比較。
5. CONFLICT入力後、同じタグID・古いexpected_revision=1・さらに異なる有効名で更新を1回試行。
6. HTTP409 + PT409 + tag revision conflictの3条件と、全snapshot不変を必須として総合PASS。

最大7 RPC：memo_save_tag3、memo_load_snapshot4。確認入力3回、別途認証1回。
正常時は名前変更済みの専用タグ1件がrevision2で残る。メモ作成・タグ削除・関連付けは行わない。
誤成功・HTTP/JSON/状態不一致・タイムアウト・通信失敗・キャンセル・記録失敗で停止。
自動再送・削除・復旧・ロールバック操作なし。各通信に15秒期限とリダイレクト拒否。
クライアント中断はサーバー処理終了の保証ではない。失敗後は再実行せず、記録のtagIdで別途読み取り専用確認を行う。

runs/<runId>.tag-edit.json、各.create/.rename/.conflict.result.json、総合.result.json、失敗.failure.jsonをすべてwxで新規作成。
タグ名の実値・認証情報・レスポンス全文はファイルに記録しない。対話確認ではテスト用タグ名を含む引数を表示する。
prepared記録は未送信の証明ではなく、段階PASSは総合PASSと区別する。
既存コード・SQL・過去記録を変更しない。名前は生成規則で再構成でき、識別記録にはrunId・tagIdを残す。

## ローカル検証

```powershell
node --check tools/memo-db-test/tag-edit-read.mjs
node --check tools/memo-db-test/tag-edit-contract.mjs
node --check tools/memo-db-test/tag-edit-contract.test.mjs
node --test tools/memo-db-test/tag-edit-contract.test.mjs
```

模擬テストは実ネットワークを禁止。実DBの返却形式・権限・通信動作は未検証。実DB実行は別途許可後。
