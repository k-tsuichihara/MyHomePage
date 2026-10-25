# ケース20：入力文字数上限

対象はユーザー確定の6境界のみ。ケース21の内容妥当性は実装しない。

| フィールド | 上限ちょうど | 上限+1 | 規定の拒否 |
|---|---:|---:|---|
| タイトル | 100保存 | 101拒否 | HTTP400 / 22023 / invalid memo content |
| 本文 | 10000保存 | 10001拒否 | HTTP400 / 22023 / invalid memo content |
| タグ名 | 30保存 | 31拒否 | HTTP400 / 22023 / invalid tag input |

根拠：review8仕様書14行、SQL本体memo_valid_textの23–40行、memo_saveの133行、memo_save_tagの280–282行。
SQLはchar_length、仕様はUnicodeコードポイント数。JSではArray.from(s).lengthを使いUTF16コードユニット数と区別する。
タイトルと本文は日本語反復+補助平面絵文字、タグはrun識別子入りのASCII名+絵文字。すべてUTF16のlengthは期待コードポイント数より1多い。
上限+1は末尾にASCII1文字を追加する。文字列そのものをログ/記録に出さず長さと項目名だけ表示する。
タグ数/メモ数/関連数の明示的な最大件数は確認したSQLにないため仮定しない。revision上限は別契約で本ケース対象外。

## 手順

1. 固定dev-sandbox検証・認証後、新規run/tag/memo/4保存要求IDを生成。過去runs内UUIDを避け識別記録をwx保存。
2. 初期snapshotで専用ID・タグ名の衝突がないことを確認。
3. TAG-30確認→30コードポイント名でタグ作成→応答・snapshot検証。
4. TAG-31確認→同じ専用タグの名前を31コードポイントへ変更試行。規定拒否と全snapshot不変。
5. TITLE-100確認→タイトル100コードポイント・短い本文・専用タグ付きメモ作成→revision1・全保存値・snapshot確認。
6. TITLE-101確認→新規requestId・expected_revision1でタイトル101へ更新試行。規定拒否と全snapshot不変。
7. BODY-10000確認→新規requestId・expected_revision1で本文10000へ更新→revision2・日時増加・全保存値・snapshot確認。
8. BODY-10001確認→新規requestId・expected_revision2で本文10001へ更新試行。規定拒否と全snapshot不変。

正常経路最大15 RPC：save_tag2、memo_save4、snapshot7、resolve2。確認6回、別途認証1回。
拒否された2保存要求だけを凍結内容でmemo_resolve_requestに照合しstrict nullを要求する。タグ操作の要求照合はない。
nullは未実行の証明ではない。要求台帳/IDレジストリの直接確認は権限上不可で未検証。
取得可能なmemos/tags/memoTagsはすべて比較する。ケース18のID/関連複合キー対応付けを再利用し、重複/欠落/余分/全フィールド差をFAILにする。
文字数違反はSQL上、メモ更新/関連置換/要求台帳INSERTより前に拒否される。途中書き込み後のロールバックの直接実証ではない。
正常時は専用メモ1件（タイトル100、本文10000、revision2）、専用タグ1件（名前30）、関連1件を残す。
既存コード・SQL・アプリ本体・過去記録は変更しない。自動再送・削除・復旧なし。
通信失敗/タイムアウト/HTTP・JSON・状態・照合不一致/キャンセル/記録失敗で停止。各通信15秒・リダイレクト拒否。
失敗後は再実行せずIDで読み取り専用確認。現在のrunの段階PASSと総合PASSを区別する。

Node.js22以上・対話ターミナル、リポジトリルートから：

```powershell
node tools/memo-db-test/input-limits-read.mjs
```

共通CLIのdev-sandbox固定Project Ref・Publishable key制限と非表示パスワードを再利用する。
runs/<runId>.input-limits.json、各操作.result.json、総合.result.jsonまたは.failure.jsonをすべてwx新規作成。
本文/タイトル/タグ名実値/認証情報/応答全文は記録しない。preparedは未送信の証明ではない。

```powershell
node --check tools/memo-db-test/input-limits-read.mjs
node --check tools/memo-db-test/input-limits-contract.mjs
node --check tools/memo-db-test/input-limits-contract.test.mjs
node --test tools/memo-db-test/input-limits-contract.test.mjs
```

模擬検証のみ。稼働DB定義・実HTTP応答・実DBテストは未確認。実行は別途判断後。

## ケース21候補（提案のみ・未確定・未実装）

SQL23–40行・仕様書14–19行に基づき、文字数境界を除いた次の内容妥当性を候補とする。
- タイトル/タグの空文字・空白のみ・前後空白がDBで拒否されること。UIのtrim処理とDBの拒否を分ける。
- 本文の前後空白保持、内部LF/TAB許可、CR拒否。タイトル/タグの内部LF/TAB/U+2028/U+2029拒否。
- C0/C1制御文字禁止。U+0000/孤立サロゲートはJSON/API/PostgreSQL変換段階で失敗し得るため、関数本体のメッセージを推測せず別途契約調査が必要。
- Unicode正規化を行わず、許容された文字列をそのまま保存すること。
ケース14のASCIIキー重複判定、ケース11の状態RPC null/未知action、ケース20の6文字数境界は再実施対象にしない。
memo_saveのtitle/body nullやmemo_save_tagのname nullは既存ケースの対象を確認して正式範囲を決める。
これらの候補の最終採否・具体的エラー契約はケース21着手時に確認する。今回はコードを追加しない。
