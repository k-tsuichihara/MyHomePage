# 確定ケース22：未認証アクセスの拒否

ユーザー承認により22=未認証拒否、23=ユーザー間データ分離とする。ケース23は未実装。
ケース22は専用ユーザー1名で正常読取し、Authorizationなしの3テーブル直接SELECTと読み取りRPC1種を検証する。
未認証の書き込みRPCは試さない。データ準備用の認証済み書き込みだけを個別確認して実行する。

## SQL・公式API根拠

- review8 SQL88–99行：全5テーブルでRLS有効。memos/tags/memo_tagsはauthenticated SELECTのみ許可し、user_id=auth.uid()のポリシー。anonにSELECT権限なし。内部台帳/レジストリもクライアント読取なし。
- SQL326–342行：RPC EXECUTEはPUBLIC/anon/authenticatedから取り消してauthenticatedだけに付与。
- SQL311–319行：memo_load_snapshotはSECURITY DEFINERで明示的にauth.uid()で所有者を絞り、UIDなしならnullを返す。これは書込RPCの42501/unauthenticatedとは異なる。EXECUTE拒否なら関数本体に到達しない。
- メモ書込RPC等はauth.uid()がnullなら42501/unauthenticatedをraiseするが、本テストはそのガードを呼び出す試験ではない。
- SECURITY DEFINERやservice_roleのRLS回避を一般ユーザー検証の代用にしない。稼働DBの所有者/ACL/BYPASSRLS属性はカタログ権限がないため今回未確認。
- PostgREST14公式エラー表：42501は未認証ならHTTP401、認証済みなら403。https://docs.postgrest.org/en/v14/references/errors.html
- Supabase公式：Publishable keyはapikeyヘッダー、ユーザーJWTは別。https://supabase.com/docs/guides/getting-started/api-keys

期待拒否はHTTP401＋JSON code42501＋空でないmessage。DB生成エラー全文はSQLで固定されず翻訳され得るため、英語全文一致を要求しない。
messageがpermission denied for table/function/schemaで始まればprivilege-deniedと分類し、unauthenticatedそのものなら想定外の関数ガードとして停止。
その他言語でも401/42501一致なら権限不足自体は確認するが、実行前拒否/正確な層は未確定と記録する。本文の任意文字列は保存しない。
401だけ、JWT/キー不正、PGRST302、404等を合格にしない。HTTP200の空配列やnullも権限拒否の証明にならず停止する。
HTTP200でデータが出れば即FAIL。RLSによる非表示とACL/API拒否は別物で、本ケースの401/42501からRLS単独の正しさを主張しない。

## テストユーザー準備

dev-sandboxに既存の専用テストユーザー1名があれば利用可能。実利用者のアカウントは使わない。
新設が必要なら利用者がSupabaseダッシュボードのプロジェクト名をdev-sandboxと確認し、AuthenticationのUsers画面でテスト用メール/パスワードのユーザーを手動作成する。
メール確認が必要な設定ならテスト用メールで確認を完了する。権限昇格・管理キー・role変更はしない。
URLとPublishable keyだけを専用.env.localに設定。sb_secret_/service_role/旧JWTキーはCLIが受け付けない。
パスワードは毎回非表示入力しファイル/チャットに保存しない。アクセストークンはメモリ内のみ。
ログインはセッション/認証監査記録を作り得る。テストはログアウト/refresh/セッション削除を行わず、他セッションへのログアウト影響を避ける。
トークンを使う正常要求と、Authorization自体を付けない未認証要求を分離する。Publishable keyをBearerにしない。

## 手順と範囲

1. 設定検証・認証、新規run/memo/tag/request UUIDを既存runsと重ならないよう生成。識別記録wx保存後だけ書き込みへ進む。
2. 初期snapshot取得。TAG確認で専用タグを作成しsnapshot比較。
3. CREATE確認でタグ付き専用メモを作成しsnapshot比較。空データだけを見て拒否成功と誤判定しない準備。
4. 認証済みでmemos/tags/memo_tagsの専用IDフィルターSELECTを行い、それぞれ専用行が1件返ることを確認。
5. 各同一SELECTをAuthorizationなしで1回試行。401/42501等の上記契約で判定し、各回認証済みsnapshot全体不変を比較。
6. Authorizationなしのmemo_load_snapshotを1回試行し同じ拒否契約を確認。認証済みsnapshot全体不変を比較。

ID/関連複合キーによるケース18の厳密比較を変更せず再利用。重複/欠落/余分/全フィールド差はFAIL。
既存データは読取比較のみ。新しい専用タグ・メモだけを作成し、削除/名前変更/関連変更/他ユーザー操作はしない。
未認証のデータ応答を受けてもログ・記録に本文や行を残さない。

## 実行・回数・残存

Node.js22以上・対話ターミナルでリポジトリルートから：

```powershell
node tools/memo-db-test/unauthenticated-read.mjs
```

最大RPC10回：save_tag1、save1、認証済みsnapshot7、未認証snapshot1。
別途テーブルSELECT6回（認証済み3＋未認証3）、ログイン1回。最大HTTP要求合計17回。
手動確認TAG/CREATEの2回。正常時は専用タグ1件・通常メモ1件revision1・関連1件と、作成要求台帳/使用済みIDが残る。
ユーザー作成/削除は自動化しない。異常時即停止。自動再送・削除・復旧なし、通信15秒期限・リダイレクト拒否。
通信不明後に再実行せず、記録IDで読み取り専用確認する。

記録はruns/<runId>.unauthenticated.json、各段階.result.json、総合.result.jsonか.failure.jsonをwx新規作成。
認証情報/本文/名前実値/応答全文を保存しない。固定のエラー分類とHTTP/codeのみを記録。
preparedは未送信の証明ではない。段階PASSは総合PASSと区別。既存コード・SQL・アプリ本体・過去記録は変更しない。

未検証：全RPCのEXECUTE ACL、内部2テーブル、直接DML拒否、無効/期限切れJWT、service_role/BYPASSRLS、他ユーザー分離（ケース23）、RLS単独の非表示、PUBLIC全体のACLカタログ確認。
実APIの観測から正確な層を特定できない場合は記録に明記し、全権限を検証済みとしない。

```powershell
node --check tools/memo-db-test/unauthenticated-read.mjs
node --check tools/memo-db-test/unauthenticated-contract.mjs
node --check tools/memo-db-test/unauthenticated-contract.test.mjs
node --test tools/memo-db-test/unauthenticated-contract.test.mjs
```

実DBには未接続。公式資料閲覧とローカル模擬検証のみ。実DB試験は利用者の別途許可後。
