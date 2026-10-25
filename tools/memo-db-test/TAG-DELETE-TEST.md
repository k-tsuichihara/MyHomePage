# ケース18：タグ削除

## SQL契約（静的調査）

review8本体memo_v1_1_schema_review8.sql:293–307とパッチmemo_v1_1_conflict_patch_review8.sql:162–176のmemo_delete_tag。
引数はp_id uuid / p_expected_revision bigint、returns void。requestIdや要求照合APIはない。
認証→ユーザー単位ロック→入力検証→関連メモUPDATE→タグDELETE→未削除ならPT409/tag revision conflict。
本体301–303行で、ゴミ箱内も含む関連メモのrevisionを1増やし、updated_at=now()、last_request_id=null。
本文・タイトル・created_at・pinned_at・deleted_atは維持。関連のないメモは更新しない。
本体77–82行の外部キーCASCADEで削除タグへのmemo_tagsが消える。他タグへの関連は維持する。
タグrevision不一致の場合は例外でトランザクション全体が失敗する設計だが、今回は正常削除のみで失敗原子性は未検証。
仕様書40行もゴミ箱内を含む関連メモrevision更新を規定。関連メモのupdated_atは同じSQL now()となる。

HTTPアダプタはvoid RPCの正常応答を204・空本文として厳密に扱いJSON解析しない。
これはSQLがHTTPを定義したものではなくAPI層の期待契約で、実環境では未検証。別形式ならFAILで停止し再送しない。
タグ削除自体の成功確認は直後snapshotのタグ不在・関連不在・メモ変更列・対象外不変まで必須。

## 専用データと手順

1. snapshot取得後、新規削除タグDと残すタグKを作成し各応答・snapshot比較。
2. 新規通常メモ1にD/K、新規メモ2にDを付けて作成し、本文・日時・revision1・状態・関連を各段階で検証。
3. メモ2をtrashしrevision2・ゴミ箱状態・関連保持を検証。
4. 新規専用Dタグだけをexpected_revision1で1回削除。
5. D本体とDへの全関連が消え、Kとメモ1→Kの関連が残ることを確認。
6. メモ1はrevision2、メモ2はrevision3、両方last_request_id=null・更新日時増加・同一日時を確認。
7. 本文などの他列、ゴミ箱状態、対象外メモ・タグ・関連は完全不変を確認。

専用タグ名はT18D-/T18K-とrun UUID先頭24桁hexの29文字。開始時に既存ID/ASCIIキー衝突を拒否する。
既存PASS対象を再利用せず、既存コード・SQL・過去記録は変更しない。

## 実行・安全性

Node.js22以上・対話ターミナルでリポジトリルートから：

```powershell
node tools/memo-db-test/tag-delete-read.mjs
```

共通CLIのdev-sandbox固定Project Ref・Publishable key制限・非表示パスワード入力を利用。
TAG-DELETE/TAG-KEEP/MEMO-1/MEMO-2/TRASH/DELETE-TAGの6回、対象・影響を表示して個別確認する。
削除はテスト目的の明示操作1回だけで、失敗時の自動削除/復旧ではない。
正常経路は最大13 RPC（save_tag2・save2・change_state1・delete_tag1・snapshot7）、別途認証1回。
正常時は専用メモ2件（通常revision2/ゴミ箱revision3）、残すタグ1件、メモ1→K関連1件が残る。
作成済みメモの使用済みID・過去保存要求台帳も残る。タグ削除後の保存再送は今回対象外。
失敗・タイムアウト・応答不明・HTTP/JSON/状態不一致・キャンセル・記録失敗で停止。自動再送・削除・復旧なし。
通信は各15秒期限・リダイレクト拒否。接続先は通信関数でも固定originと照合する。
中断はサーバー処理終了の保証ではない。削除結果不明でも再送せず、別途snapshotで読み取り専用確認する。

runs/<runId>.tag-delete.jsonをprepared識別記録としてwx保存した場合だけ書き込みに進む。
各段階.result.json、総合.result.json、失敗.failure.jsonも新規作成。元run・過去PASS記録は上書きしない。
tagIds[0/1]は削除D/保持K、memoIds[0/1]は通常/ゴミ箱、requestIds[0/1/2]はメモ作成1/2/trash。
本文・タイトル・タグ名実値・認証情報・応答全文は記録しない。段階PASSと総合PASSを区別する。

```powershell
node --check tools/memo-db-test/tag-delete-read.mjs
node --check tools/memo-db-test/tag-delete-contract.mjs
node --check tools/memo-db-test/tag-delete-contract.test.mjs
node --test tools/memo-db-test/tag-delete-contract.test.mjs
```

実ネットワーク禁止の模擬検証のみ。稼働DB定義・権限・HTTP返却形式は未検証。実DB実行は別途判断後。

## スナップショット比較の修正

ケース18のみ、メモ/タグはid、関連は(memo_id, tag_id)の複合キーで実値と期待値を対応付ける。
両側でキーの重複を拒否し、欠落・余分な行を個別に検出。対応行はuser_idを含む全フィールドをisDeepStrictEqualで厳密比較する。
未知の追加列・欠落列・型の差もFAIL。キー挿入順と配列順の違いは無視するが、値・行数・重複の検証は緩めない。
診断項目名は固定の安全な文字列だけを表示し、未知の列名・本文等の実値は出力しない。
元runのFAIL・過去PASS記録は変更せず、過去の直接原因が確定したとも扱わない。

ケース17のtag-usage-contract.mjsにもJSON.stringifyによる整列が残っている。
全体比較が順序差で不一致となった後、対応付けた既知フィールドが一致してもotherFieldsOrMultiplicityでFAILになるため、
ケース18と同種の誤判定があり得る。初期/各段階snapshot比較が影響対象だが、今回はケース17を変更しない。
