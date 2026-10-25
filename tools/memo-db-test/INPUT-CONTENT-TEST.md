# ケース21：入力内容の妥当性

## 根拠・範囲

review8仕様書14–19行：正規化なし、UIはタイトル/タグの前後空白を整形する一方、DBは正規化済み値を検証。
本文の前後空白/LF/TABは保持、CRと他のC0/C1制御文字は拒否。UIの自動補完/trimは本CLIに持ち込まない。
本体SQL23–40行：memo_valid_textはnull/空title/空tag/前後空白を拒否し、bodyの空文字は許可。
34–37行：C1(127–159)、title/tagのU+2028/U+2029、許容外C0を拒否。bodyはTAB/LFだけ許可。
memo_saveの113–116行はtitle/body=nullを22023 invalid argument、133行は内容不正を22023 invalid memo contentで拒否。
memo_save_tagの280–282行はname不正/nullを22023 invalid tag inputで拒否する。
いずれも期待HTTP400。入力検証は更新や要求台帳INSERTより前で、途中書き込みのロールバック試験とは区別する。

## 採用項目（各項目後に全snapshot比較）

| 操作名 | 入力と期待 | 根拠 |
|---|---|---|
| tag-preserved | 一意識別子+分解形e/U+0301をそのまま保存 | 仕様14行/SQLに正規化処理なし |
| body-empty | 有効な分解形タイトル+空本文を保存 | SQL29–31/133行 |
| body-whitespace | SPACE/TAB/LF/NBSPのみの本文を厳密保持 | 仕様16–17/SQL31–37行 |
| body-preserved | 前後空白+LF/TAB+分解形文字列を厳密保持 | 同上、正規化なし |
| title-empty | 空文字をinvalid memo contentで拒否 | SQL29/133行 |
| title-null | nullをinvalid argumentで拒否 | SQL113–116行 |
| title-spaces | SPACE/NBSPだけをinvalid memo contentで拒否 | SQL29行 |
| title-edge | 先頭NBSPを含むタイトルをinvalid memo contentで拒否 | SQL29行/空白集合13–21行 |
| title-lf | 内部LFをinvalid memo contentで拒否 | SQL34–37行 |
| body-null | nullをinvalid argumentで拒否 | SQL113–116行 |
| body-cr | CRLFをinvalid memo contentで拒否（LF変換しない） | SQL36行 |
| body-c1 | 内部U+0085をinvalid memo contentで拒否 | SQL34行 |
| tag-empty | 空文字をinvalid tag inputで拒否 | SQL30/280–282行 |
| tag-null | nullをinvalid tag inputで拒否 | SQL27/280–282行 |
| tag-edge | 末尾SPACE付き名をinvalid tag inputで拒否 | SQL30行 |
| tag-tab | 内部TABをinvalid tag inputで拒否 | SQL36行 |
| tag-line-separator | 内部U+2028をinvalid tag inputで拒否 | SQL35行 |

正常系4件、拒否13件。正常系では応答とsnapshotの本文/タイトル/名前を原文字列と比較し、trim/NFC/改行変換があればFAIL。
タグはrevision1、メモは空本文作成revision1→空白本文revision2→保持本文revision3。拒否要求はこの状態を変更しない。
本文が空/空白のみでもタイトルは実質非空なので、UIの両方空禁止条件にも抵触しない。
タグ名はT21-とrun UUID先頭20hex、分解形文字列で一意化し、開始時にASCIIキー/ID衝突を拒否。
ケース18の厳密比較を変更せず再利用。順序を無視するが重複/欠落/余分/フィールド追加欠落/型・値の差はFAIL。

## 除外・限界

- ケース20の文字数上限、ケース14の大小文字キー重複、ケース11の状態action/引数不正は再検証しない。
- U+0000・孤立サロゲートはAPI/JSON/DB変換段階の契約が未確定なので送らない。
- 不正UUID、SQL bigint変換、引数省略、未知fieldの内部関数直呼びは対象外。
- Unicode空白/制御文字の全コードポイント網羅、U+2029、title内TAB/tag内LF等の対称組合せは今回の代表ケースから一般化しない。
- UIのtrim/無題補完/両方空禁止はUI未実装の別範囲。NULL/空名のRPCはケース13で調査のみだったため今回は独立して検証する。
- 内部要求台帳/IDレジストリは直接読めない。拒否後に公開snapshot全体の不変を確認するが、台帳の直接未登録を実DBで証明しない。
- タグにはrequestId/要求台帳がなく、今回保存照合RPCも実行しない。失敗しても再送しない。

## 実行・安全性

Node.js22以上・対話ターミナルでリポジトリルートから：

```powershell
node tools/memo-db-test/input-content-read.mjs
```

共通CLIで固定dev-sandbox Project Ref・Publishable keyを通信前に検証し、非表示パスワード認証。
新規run/tag/memo/保存要求11 IDを過去runs内UUIDと重ならないよう生成。識別記録wx保存後だけ書き込みへ進む。
各操作名を大文字にした17回の確認入力が必要。各回対象ID・操作名・影響範囲を表示し、入力本文やタグ名は表示しない。
最大35 RPC：memo_save_tag6（許可1/拒否5）、memo_save11（許可3/拒否8）、snapshot18。別途認証1回。
正常時は通常メモ1件（revision3・タイトル/本文分解形と空白保持）、タグ1件（revision1）、関連1件が残る。使用済みIDと成功保存履歴も残る。
通信/HTTP/JSON/状態不一致・キャンセル・記録失敗で即停止。自動再送・削除・復旧なし。
各通信15秒・リダイレクト拒否。中断はサーバー処理終了の保証ではない。失敗後は再実行せず読み取り専用確認へ。
同じテストユーザーで他操作を並行しない。拒否誤成功でも自動修復しない。

runs/<runId>.input-content.jsonと各操作.result.json、総合.result.jsonまたは.failure.jsonをすべてwx新規作成。
requestIdsは正常メモ3件分→拒否メモ8件分の実行順。タグ操作には使わない。
本文・タイトル・タグ名実値・認証情報・応答全文を記録しない。段階PASSと総合PASSを区別、preparedは未送信の証明ではない。
既存コード・SQL・アプリ本体・過去run/PASS記録は変更しない。

```powershell
node --check tools/memo-db-test/input-content-read.mjs
node --check tools/memo-db-test/input-content-contract.mjs
node --check tools/memo-db-test/input-content-contract.test.mjs
node --test tools/memo-db-test/input-content-contract.test.mjs
```

実ネットワーク禁止のローカル検証のみ。稼働DB定義・実HTTP応答・実DB試験は未確認。実DB実行は別途許可後。
