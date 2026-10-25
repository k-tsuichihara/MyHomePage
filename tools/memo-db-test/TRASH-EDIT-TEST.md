# ケース12：ゴミ箱内メモの編集拒否

## SQL契約調査（静的評価）

review8本体memo_v1_1_schema_review8.sql:104–157、6関数パッチmemo_v1_1_conflict_patch_review8.sql:4–57のmemo_saveを対象とする。
引数：p_id uuid, p_title text, p_body text, p_tag_ids uuid[], p_expected_revision bigint, p_request_id uuid。
通常戻り値：{memo,tagIds}。完全削除済み履歴は別receipt。

本体の処理順序：認証・ロック(111–112)→入力検証(113–118)→ハッシュ・台帳照合(119–130)
→タグ存在確認・文字検証(131–133)→更新対象取得(141–142)
→revision不一致 OR deleted_at非nullを一つの条件で拒否(143–144)→メモ更新(145–147)
→タグ関連置換(149–151)→台帳INSERT(154–155)。
パッチの対応する拒否条件は43–44行。

**期待エラーはHTTP409 / PT409 / memo revision conflict。状態専用の別メッセージは存在しない。**
revision判定とゴミ箱判定に別々の処理順はなく同じOR条件。応答だけで拒否原因は識別できない。
本テストは直前snapshotでrevision2・ゴミ箱内を確認し、正しいexpected_revision=2と新規requestIdを送信して、
古いrevisionを意図的に送った競合テストと区別する。
外部から同時更新があればサーバー判定時点のrevisionを証明できないため、同一ユーザーの他の操作を止めて実施する。
拒否後の全データ不変も必須とするが、DB内部の分岐実行を直接証明するものではない。

タイトル・本文・タグは同じ保存RPC。タグ/入力検証はゴミ箱判定より先なので、不正タグなら別の拒否となる。
今回はタグを新設・流用せず空配列のままにし、元データと異なるタイトル（末尾に edited）と本文（専用要求ID付きの行を追加）を送る。
タイトル・本文の差異は送信前に確認する。タグ変更そのもの、タグ付きメモ、ピン留め済みメモの編集拒否は対象外。

拒否はUPDATE/関連置換/台帳INSERTより前で、last_request_idを含む保存変更は成立しない設計。
memo_load_snapshot(311–319)は自分の通常・ゴミ箱メモ全列、タグ、関連を返す。
内部台帳・IDレジストリは90–99行でクライアント読取不可。直接未登録を検証したとは扱わない。
memo_resolve_request(161–190)は読み取り専用で、送った保存要求の内容とハッシュを照合し、記録がなければnull。
本テストでは明確な期待拒否とsnapshot不変を確認した後に限り、その凍結要求を1回照合してstrict nullを要求する。
**nullだけを未実行の証明としない。** 状態変更要求の照合には使用しない。
既存要求の再送は台帳分岐で現在状態検査前に履歴を返すため、編集試行には必ず新規requestIdを使う。

## 実行・回数

Node.js 22以上・対話ターミナルでリポジトリルートから：

```powershell
node tools/memo-db-test/trash-edit-read.mjs
```

共通CLIのdev-sandbox固定Project Ref照合、Publishable key制限、非表示パスワード入力を再利用。
作成・trash・作成要求照合はケース8の判定を再利用し、その後に編集拒否とsnapshot比較、拒否保存要求の照合を追加する。
準備済み識別記録をwxで新規保存した場合だけ書き込みに進む。UUIDは既存runs記録と重複しないものを生成。
CREATE/TRASH/EDITの3回、各書き込み前に対象・操作・影響範囲を表示して個別確認する。
編集が誤成功すれば即FAIL。元に戻す操作は実装しない。

最大9 RPC：save2（作成1・拒否期待編集1）、change_state1、snapshot4、resolve2（作成1・拒否要求1）。別途認証1回。
正常時は専用メモ1件がゴミ箱内・revision2・未ピン留めで残り、使用済みID・作成/trash台帳も残る。
状態変更照合・内部台帳直接確認は対象外。タイトル・本文・タグ・日時・last_request_id・状態・対象外データは全snapshot比較する。
自動再送・削除・復旧・ロールバック操作なし。各通信は15秒期限、リダイレクト拒否。
通信失敗・タイムアウト・応答不明・不一致・確認キャンセル・記録失敗で停止する。
中断はサーバー処理終了の保証ではない。失敗後は再実行せず別途読み取り専用確認を行う。

記録：runs/<runId>.trash-edit.json、各.create/.trash/.edit.result.json、総合.result.json、失敗.failure.json。
すべてwxで新規作成し、段階PASSと総合PASSを区別。preparedは未送信の証明ではない。
本文・タイトル実値・認証情報・応答全文は記録しない。既存コード・SQL・過去PASS対象/記録は変更しない。

## ローカル検証

```powershell
node --check tools/memo-db-test/trash-edit-read.mjs
node --check tools/memo-db-test/trash-edit-contract.mjs
node --check tools/memo-db-test/trash-edit-contract.test.mjs
node --test tools/memo-db-test/trash-edit-contract.test.mjs
```

実ネットワーク禁止の模擬検証のみ。実DBの応答・権限・通信動作は未検証。実DB実行は別途判断後。
