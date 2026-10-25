# ケース16：存在しないタグIDでの更新失敗とデータ保持

review8 SQLのmemo_save（本体131–132行、6関数パッチ31–32行）は、指定タグIDが呼出しユーザーのtagsに存在しなければ
SQLSTATE22023 / message unknown tagを返す。HTTP400を厳密に要求する。
この判定はメモ更新・revision増加（145–147）、関連置換（149–151）、台帳INSERT（154–155）より前。
したがって本ケースは更新前の拒否と全データ保持を検証するもので、途中書き込み後のロールバックを直接証明するものではない。

## 手順

Node.js22以上・対話ターミナルで、リポジトリルートから：

```powershell
node tools/memo-db-test/missing-tag-read.mjs
```

共通CLIの固定dev-sandbox Project RefとPublishable key制限を通信前に適用する。
既存ケース15のPASS対象は使わず、新規memo/作成要求/拒否更新要求/専用タグ/不存在タグ候補IDを生成する。
UUIDはrunsの過去記録を避け、タグ名はT16A-とrun UUID先頭24桁hexの29文字。
prepared識別記録のwx保存成功後にだけ書き込みへ進む。

1. snapshotで対象メモID・タグID・不存在候補ID・候補タグ名が自分の既存データと衝突しないことを確認。
2. TAG確認後、専用タグ1件を作成し応答とsnapshotを比較。
3. CREATE確認後、専用タグ付き専用メモを作成。本文・revision1・日時・状態・関連を応答とsnapshotで確定。
4. 不存在候補IDが自分の最新snapshotにないことを再確認。
5. REJECT-UPDATE確認後、新規requestId・正しいexpected_revision1で異なる本文と[不存在候補タグID]を送る。元の関連タグは送信集合に含めない。
6. HTTP400 / code22023 / message unknown tagの3条件を確認。予期しない成功は即停止し、元に戻さない。
7. snapshot全体を直前と比較し、本文・タイトル・revision1・日時・last_request_id・ピン/ゴミ箱状態・元タグ関連と対象外データが完全に不変であることを確認。
8. 作成要求を照合し初回保存結果と一致を確認。拒否更新の凍結要求も読み取り専用で照合しstrict nullを要求。

memo_resolve_requestはタグの現在存在確認をしない読み取り専用処理（161–190行）。
nullだけで未実行とは断定しない。内部台帳の未登録を直接確認したとは扱わない。
不存在の確認は自分のsnapshotの範囲。全ユーザーのカタログ不在を証明しないが、新規UUIDを生成し、他人のIDを入力/参照しない。
SQLのunknown tagは他所有者タグも含むが、このケースは意図的に他人のタグを使用しない。

## 安全性・回数・記録

最大9 RPC：save_tag1・save2（作成1＋拒否期待1）・snapshot4・resolve2。確認入力3回、別途認証1回。
正常時は通常状態の専用メモ1件（revision1）、専用タグ1件、元タグ関連1件が残る。不在候補のタグは作成しない。
使用済みメモIDと作成要求台帳も残る。失敗途中のデータは自動削除・復旧しない。
既存データ・本体・SQL・過去記録は変更しない。自動再送・復旧・ロールバック操作なし。
通信失敗・タイムアウト・HTTP/JSON/状態/照合不一致・キャンセル・記録失敗で停止。
各通信15秒期限・リダイレクト拒否。中断はサーバー処理の終了保証ではない。
失敗後は再実行せず識別IDで別途読み取り専用確認する。同じユーザーの他の操作を並行しない。

runs/<runId>.missing-tag.jsonに識別記録を保存。tagIds[0]が実在専用タグ、tagIds[1]が作成しない不在候補ID。
各.tag/.create/.reject-update.result.json、総合.result.json、失敗.failure.jsonもすべてwxで新規作成。
本文・タイトル・タグ名実値・認証情報・レスポンス全文は記録しない。段階PASSは総合PASSとは区別する。
preparedは未送信の証明ではない。

## ローカル検証

```powershell
node --check tools/memo-db-test/missing-tag-read.mjs
node --check tools/memo-db-test/missing-tag-contract.mjs
node --check tools/memo-db-test/missing-tag-contract.test.mjs
node --test tools/memo-db-test/missing-tag-contract.test.mjs
```

実ネットワーク禁止の模擬検証のみ。稼働DBの定義・権限・実応答は未確認。実DBテストは別途許可後。
