# ケース10：状態変更の競合・再送

## review8 SQL契約調査（静的評価）

本体memo_v1_1_schema_review8.sql:193–226と、6関数パッチmemo_v1_1_conflict_patch_review8.sql:60–93のmemo_change_stateを照合した。
関数本体は一致し、パッチはCREATE OR REPLACE。SQL変更は不要。

- 引数：p_id uuid, p_expected_revision bigint, p_request_id uuid, p_action text。
- action：pin / unpin / trash / restore。戻り値：public.memosの行。
- 順序：認証→ユーザー単位トランザクションロック→入力検証→ハッシュ生成→同一ユーザーのrequestId台帳検索。
- 台帳があれば対象ID・action・ハッシュを検査。不一致は22023 / HTTP400 / request id reused with different operation or content。
- ハッシュはユーザー・requestId・action・対象ID・expectedRevisionに結び付く。同じID/action/対象でもexpectedRevisionを変えれば一致しない。
- 台帳一致かつ未完全削除なら、初回結果を返して終了。現在revisionを検査せず、DB更新・新規台帳記録なし。
- 完全削除でredactedならP0002 / previously applied, memo deleted。これは今回検証しない。
- 台帳なしの場合のみ対象をFOR UPDATEで取得→revision検査→状態検査→更新→要求台帳INSERT→返却。
- 古いrevision：PT409 / HTTP409 / revision conflict。保存RPCのmemo revision conflictとは異なる。
- pinはpinned_at=now()。updated_at=now()、revision+1、last_request_id更新。その他は保持。
- 完全同一再送ではrevision・日時・last_request_id・状態は変化せず、初回応答と同一の履歴行が返る。
- memo_resolve_requestはsave専用。状態変更の読み取り専用照合は実施不可。

安全に実装した範囲は新規専用メモの作成→pin→別の新規requestIdと古いrevisionによるunpin競合→完全同一pin再送。
異なるaction/対象へのrequestId混用、完全削除後の再送、さらに別更新が入った後の履歴再送は今回の実DB検証対象外。
テスト対象の意図的再送は、通信失敗時の自動再送と区別する。失敗や応答不明が先行したら実行しない。

## 実行

Node.js 22以上・対話ターミナルでリポジトリルートから：

```powershell
node tools/memo-db-test/state-replay-read.mjs
```

共通CLIのdev-sandbox固定Project Ref検証、Publishable key制限、非表示パスワード入力を再利用する。
通常RPCはケース7のpinRpc（HTTP200必須）、競合のみ専用応答処理（HTTP409とcode/messageを厳密照合）。
すべて15秒期限・リダイレクト拒否。本文・キー・トークン・応答全文はログや記録に残さない。

1. 新規run/memo/作成/pin/競合IDを既存runsのUUIDと重ならないよう生成し、識別記録をwxで新規作成。
2. 作成前snapshot取得、CREATE確認後に作成。revision1・未ピン留め・内容・初期日時・空タグを検証。
3. snapshotと初回応答一致、既存メモ・タグ・関連不変を確認。
4. PIN確認後に新規requestIdでpin。revision2、pinned_at=updated_at、last_request_idと全列を確認しsnapshot比較。
5. CONFLICT確認後に別の新規requestId、expected_revision=1、action=unpinを1回だけ送る。
6. HTTP409 + PT409 + revision conflictのみを期待拒否とし、snapshot全データ不変を確認。
7. REPLAY確認後に初回pin要求をrequestId・expected_revision=1含め完全同一で1回だけ意図的再送。
8. 初回pin応答との完全一致とsnapshot全データ不変を確認。
9. 作成要求のみmemo_resolve_requestで照合し、作成時の履歴結果と一致を確認。

正常経路の最大RPCは10回：save1・change_state3（pin/競合/意図的再送）・snapshot5・resolve1。別途認証1回。
正常時は専用メモ1件が通常状態・ピン留め・revision2で残る。使用済みIDと作成/pin台帳も残る。
競合要求の台帳登録がないことは公開APIから直接検証しない。
タグなし・未ピンからのpinのみ。全actionの再送、タグ付き状態遷移は未検証。

各書き込み前に対象ID・操作・影響を表示して個別確認。誤って競合要求が成功すれば専用メモが解除され得るが、自動復旧しない。
通信例外・タイムアウト・HTTP/状態/照合不一致・確認キャンセル・記録失敗は即停止し総合PASSにしない。
自動再送・削除・復旧・ロールバック操作なし。クライアント中断はサーバー処理終了の保証ではない。
失敗後は再実行せず識別記録のIDを使って別途読み取り専用確認を行う。

記録はruns/<runId>.state-replay.json、各.create/.pin/.conflict/.replay.result.json、総合.result.json、失敗.failure.json。
すべてwxで新規作成。識別記録失敗なら書き込みに進まない。段階PASSと総合PASSを区別。
preparedは未送信の証明ではない。状態変更の読み取り専用照合は対象外と結果に明記。
既存コード・SQL・本体・過去記録は変更しない。

## ローカル確認

```powershell
node --check tools/memo-db-test/state-replay-read.mjs
node --check tools/memo-db-test/state-replay-contract.mjs
node --check tools/memo-db-test/state-replay-contract.test.mjs
node --test tools/memo-db-test/state-replay-contract.test.mjs
```

模擬テストでは実ネットワーク禁止。実DBの応答表現・権限・実通信は未検証。実DB実行は別途許可後。
