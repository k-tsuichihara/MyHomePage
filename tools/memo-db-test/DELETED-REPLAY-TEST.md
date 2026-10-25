# ケース27：完全削除後の元保存要求リプレイによるメモ復活防止

2026-10-25に新規採用。[採用記録](TEST-PLAN-2026-10-25.md)を参照。ケース28〜30は未定義。実DB接続・実行は別途判断する。

## SQL・API契約

対象：tools/memo/doc/v1.1.0/memo_v1_1_schema_review8.sql。

| 段階 | 根拠・期待値 |
|---|---|
| 新規作成 | 104〜155行：memo_saveへmemoId/requestId、title/body、専用tagId、expected_revision=null。応答{memo,tagIds}、revision=1、last_request_id=作成要求、deleted_at/pinned_at=null、created_at=updated_at |
| ゴミ箱移動 | 192〜225行：memo_change_state(action=trash,expected_revision=1)。revision=2、updated_at増加（マイクロ秒）、deleted_at=updated_at、last_request_id=trash要求。その他の全フィールド・タグ関連は保持 |
| 完全削除 | 228〜240行：最新revision=2でmemo_delete_permanently。SQLはvoid、APIはHTTP204・空本文。238〜239行で要求台帳を削除済みにしresultを消去。81行のFKで関連行も削除。タグ本体は保持 |
| 元要求リプレイ | 119〜128行：要求ハッシュを再計算し、所有者/requestId/操作/対象/内容の一致を確認。deleted_redactedならHTTP200・厳密に{"status":"previously-applied-deleted"}を返して終了。通常保存結果・null・追加フィールドはFAIL |
| 復活防止 | 127行でreturnするため、130行以降のタグ存在確認・135行以降の使用済みID登録/メモ作成・149行以降の関連更新に到達しない |

統合仕様memo_v1_1_implementation_review8.mdの37〜38行も同じ削除済みreceiptと台帳のデータ最小化を規定する。6関数パッチのmemo_save（4行以降）とdelete_permanently（96行以降）も同じ分岐。HTTP204の根拠はケース24の[手順書](PERMANENT-DELETE-TEST.md)を参照。

ケース24の読み取り専用memo_resolve_request照会とは異なり、実際のmemo_save再送分岐を検証する。ケース3は現存メモ、ケース19はタグ削除後でメモは現存。本ケースはメモが完全削除済みの条件を検証する。削除済みIDに別requestIdで作成する操作は対象外。

## 実行準備・手動確認

- ケース26のrun `27027609-0196-4590-8b96-4183a948a23e` で使用したdev-sandbox Authユーザーを再利用する。CLIはその識別記録と最終PASS結果を認証前に照合し、認証後のuser.idが記録のuserIdと一致しなければDB RPC前に停止する。記録が欠落/不一致なら推測で続けない。ユーザー自動作成/削除・service_role/管理キーは使用しない。
- 初期データ0件は要求しない。ケース26のゴミ箱メモ2件（各revision=2、trash requestId一致、未ピン）、タグ1件（revision=1）、関連2件の存在・所有者を最初のsnapshotで確認する。さらに全初期データをメモリ内基準として保持し、各操作後に全フィールド比較する。初期取得からケース27完了まで、同ユーザーを他CLI・他端末から操作しない。
- Node.js 22以上、追加依存なし。既存.env.localのURL/Publishable keyとcli.mjsの固定Project Ref検証を利用し、認証前と各RPC送信前にdev-sandboxだけを許可する。リダイレクトは拒否。本番k-life-logには接続しない。

```powershell
node tools/memo-db-test/deleted-replay-read.mjs
```

メールは対話入力、パスワードは非表示、トークンはメモリ内のみ。認証セッション/ログは残り得る。logout/refresh/admin APIなし。過去runsの全JSON内UUIDと衝突しない新規IDを発行し、識別記録をwxで作成してから書き込みへ進む。

1. 初期の全snapshot取得。ケース26の記録上の対象が期待する状態で存在することを確認し、既存全データを保護基準として保持する。空状態を要求しない。
2. **TAG**：専用タグ1件作成。所有者・revision=1・名前・日時と全snapshotを確認。
3. **CREATE**：専用メモ1件とタグ関連1件を作成。作成payloadは一度だけJSON.stringifyし、初回HTTP本文として直接送る。凍結文字列はメモリ内だけで保持する。
4. **TRASH**：専用メモをゴミ箱へ移動。応答・全snapshotでrevision=2等を確認。
5. **DELETE**：最新revision=2で専用メモを1回完全削除。応答と全snapshotでメモ・関連不在、タグと対象外データの保持を確認。
6. **REPLAY**：元memoId/requestId/expected_revision=nullを表示し、誤成功時の復活リスクを確認する。
7. 確認入力後に全snapshotを再取得し、削除後期待状態と一致することを確認。比較用snapshotはメモリ内で保持する。
8. 初回と完全に同じJSON文字列をそのままHTTP本文としてmemo_saveへ1回だけ送信する。元内容の再生成・再シリアライズ・requestId変更はしない。JSON.parseは検証用のみであり、送信本文の作り直しには使わない。
9. HTTP200と厳密な削除済みreceiptを検証し、再取得した全snapshotが直前から完全不変、専用メモ・関連不在、専用タグ保持であることを確認。

各書き込み前に対象ID・requestId・expectedRevision・影響範囲を表示する。タグ作成/完全削除はRPCにrequestIdがないためnullと表示。大文字確認入力は**5回**。

最大 **12 RPC**：snapshot7（初期・タグ後・作成後・trash後・削除後・リプレイ直前・リプレイ後）、save_tag1、memo_save2（初回1＋明示リプレイ1）、change_state1、delete_permanently1。認証1回は別でHTTP総数最大13回。resolve RPCは呼ばない。

## 安全対策・記録・限界

- 通常RPC経路はsnapshot/save_tag/change_state/delete_permanentlyだけを許可。memo_saveは専用の生JSON送信関数に限定する。毎リクエスト15秒タイムアウト、redirect:error、自動再試行なし。
- 削除応答や削除後状態が未確認ならリプレイしない。失敗・タイムアウト・誤HTTP・通常保存結果・削除済み応答の余分なフィールド・状態差異・確認キャンセル・記録失敗は即停止。異常時の削除・再送・復旧・後片付けは禁止。
- リプレイ誤成功時は専用メモと関連が復活し、要求履歴などが変わる可能性がある。自動で消さず、元の識別記録/FAILを保持して読み取り専用で調査する。
- 比較はケース18のcompareTagDeleteSnapshotsを再利用。配列順・キー挿入順に依存せず、メモ/タグはID、関連はmemo_id+tag_idで対応付ける。全フィールドの有無・型・値、欠落・重複・余分な行を検査する。
- runs/<runId>.deleted-replay.jsonは識別用。進捗・最終結果・失敗はそれぞれ別ファイルへwxで新規保存し、既存記録を上書きしない。記録はID・時刻・安全な項目名・合否だけ。本文/タイトル/タグ名実値/全payload/認証情報/トークン/キー/レスポンス全文は保存しない。
- 正常終了後は初期snapshot＋今回の専用タグ1件だけが残る。初期がケース26の2メモ/1タグ/2関連のみなら、最終は2メモ/2タグ/2関連。今回のメモ・関連は不在。ケース26のIDは完全削除RPCへ渡さず、今回の新規memoIdだけを指定する。最終的に初期全データ＋タグ1件との完全一致も別途検証し、結果へbaselineCounts/finalCounts/existingDataUnchangedと参照runIdを記録する。従来のmemosRetained等は今回の専用データの残存数であり、ユーザー全体の件数ではない。
- 使用済みID・要求の最小限記録は保持される設計だが、内部要求台帳の内容・不変は直接未検証。バックアップ/監査ログの消去も対象外。ケース26の当時の全レコードが記録にないため、当時から今回開始までの全フィールド不変まで証明するものではない。今回の初期snapshotからの不変を検証する。
- 直前取得とリプレイは別トランザクション。実行中の並行更新は止める。失敗したrunを再実行で修復しない。新規起動は別の専用データを作るので、異常時は先に状態調査する。

## ローカル検証

```powershell
node --check tools/memo-db-test/deleted-replay-read.mjs
node --check tools/memo-db-test/deleted-replay-contract.mjs
node --check tools/memo-db-test/deleted-replay-contract.test.mjs
node --test tools/memo-db-test/deleted-replay-contract.test.mjs tools/memo-db-test/empty-trash-conflict-contract.test.mjs tools/memo-db-test/delete-conflict-contract.test.mjs tools/memo-db-test/permanent-delete-contract.test.mjs tools/memo-db-test/tag-delete-contract.test.mjs tools/memo-db-test/unauthenticated-contract.test.mjs tools/memo-db-test/isolation-contract.test.mjs
```

実ネットワークを禁止し、初回/再送の文字列一致、正常receipt、通常保存結果・余分なreceipt・null、メモ/関連復活、タグ・対象外データ変化、欠落・重複・余分、未知フィールドの有無、順序だけ異なる正常値、HTTP/通信/本文/JSON異常、各段階失敗・確認キャンセル・進捗保存失敗、回数上限・再送禁止を模擬検証する。実DB動作確認とは区別する。
