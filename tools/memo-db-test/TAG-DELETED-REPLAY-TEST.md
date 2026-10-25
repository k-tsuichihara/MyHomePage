# ケース19：タグ削除後の保存要求リプレイ

## review8契約と期待値

memo_v1_1_schema_review8.sqlのmemo_save（104–157）は認証・ロック・基本入力検証後、ハッシュを生成して(user_id,request_id)の要求台帳を照合する（119–130）。
ハッシュはuser/requestId/操作save/memoId/タイトル/本文/タグ集合/expectedRevisionに結び付く。
同一要求の履歴返却はタグ存在確認（131–132）と現在revision/ゴミ箱検査（141–144）より先。
成功済み要求を完全同一で送ると保存時の{memo,tagIds}を返し、現在のメモや関連を更新しない。
台帳一致でも異なる内容なら拒否される。今回は混用せず初回JSONを凍結し、同じrequestId・全payloadで1回だけ明示リプレイする。

memo_delete_tag（293–307）は関連メモのrevision+1/updated_at更新/last_request_id=nullを行い、タグを削除。
外部キーCASCADE（77–82）で関連を解除する。本文・タイトル・作成日時・ピン/ゴミ箱状態は保持。
タグ削除ではmemo_requestsの過去保存結果を削除・redactしない。
従ってリプレイ応答のtagIdsには削除済みIDが含まれ、memoは過去revision1・過去requestIdを持つ。
現在のsnapshotはrevision2・last_request_id=null・タグ不在・関連なしであり、履歴結果と現況を混同しない。
memo_resolve_request（161–190）も現在のタグ存在確認をせず、同じ凍結要求で履歴結果を照合できる。
内部台帳を直接読めないため、保存リプレイと読み取り専用照合の返却結果で契約を確認する。
memo_saveとmemo_delete_tagの本体/6関数パッチ定義は、宣言CREATE OR REPLACE以外一致することをローカルで照合済み。
memo_resolve_requestはこの差分パッチの対象外であり、本体の契約を参照する（パッチ内に定義がないことは欠落や不一致ではない）。

今回の対象は新規通常メモ1件。ゴミ箱状態の条件を重ねず、タグ削除後の履歴優先を単独検証する。
SQL上の履歴返却分岐はゴミ箱検査より先だが、ゴミ箱内メモのリプレイは今回未検証として結果に明記する。
完全削除後のreceipt、変更要求のリプレイ、同一requestId内容混用は別ケース。

## 手順・安全性

Node.js22以上・対話ターミナルでリポジトリルートから：

```powershell
node tools/memo-db-test/tag-deleted-replay-read.mjs
```

1. 共通CLIで固定dev-sandbox URL・Publishable key形式を検証し、非表示パスワード認証。
2. 既存runsのUUIDを避け新規run/tag/memo/requestIdを生成。識別記録をwxで新規保存した後だけ書き込みへ進む。
3. 全snapshotで対象ID・タグ名の衝突がないことを確認。
4. TAG確認後、専用タグを作成し応答とsnapshotを比較。
5. CREATE確認後、タグ付き通常メモを作成しrevision1・本文等・requestId・関連を確認。
6. DELETE-TAG確認後、専用タグだけを削除。現行revision2・last_request_id=null・タグ/関連不在、対象外不変を確認。
7. REPLAY確認後、削除前の成功要求を完全同一で1回だけ意図的に送る。
8. 応答は削除前の保存結果と完全一致、snapshotは削除直後と完全一致を要求する。
9. 凍結要求をmemo_resolve_requestで1回読み取り照合し、同じ履歴保存結果と一致を要求する。

各書き込みの対象ID・操作・影響を表示して個別確認。失敗・応答不明が先行したらリプレイへ進まない。
テスト対象の明示リプレイと通信失敗時の自動再送を区別する。自動再送・削除・復旧・ロールバック操作なし。
HTTP/JSON不正・通信失敗・タイムアウト・状態不一致・確認キャンセル・記録失敗で停止し、再実行しない。
各通信15秒期限・リダイレクト拒否。中断はサーバー処理終了の保証ではない。
削除RPCはケース18と同じHTTP204空本文を要求し、それ以外はHTTP200を要求する。

正常経路は最大10 RPC：save_tag1・memo_save2（作成1＋意図的リプレイ1）・delete_tag1・snapshot5・resolve1、別途認証1回。
確認4回。正常時は専用通常メモ1件（revision2・last_request_id=null・関連なし）が残る。
専用タグは削除済み、使用済みメモIDと過去の保存要求台帳は残る。他のタグやメモは操作しない。
ケース18の比較関数を変更せず再利用し、ID/関連複合キーで全行を厳密比較。キー順/配列順を無視し、欠落/重複/余分な行/全フィールド差はFAIL。

記録はruns/<runId>.tag-deleted-replay.json、各.tag/.create/.delete-tag/.replay.result.json、総合.result.jsonまたは.failure.json。
すべてwxで新規作成。本文・タイトル・タグ名実値・認証情報・レスポンス全文は記録しない。
段階PASSと総合PASSを区別し、preparedは未送信の証明ではない。
既存コード・SQL・アプリ本体・過去run/PASS記録は変更しない。

```powershell
node --check tools/memo-db-test/tag-deleted-replay-read.mjs
node --check tools/memo-db-test/tag-deleted-replay-contract.mjs
node --check tools/memo-db-test/tag-deleted-replay-contract.test.mjs
node --test tools/memo-db-test/tag-deleted-replay-contract.test.mjs
```

実ネットワークは禁止した模擬検証のみ。実DBテストは別途許可後。
