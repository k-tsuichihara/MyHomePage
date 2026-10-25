# ケース23：ユーザー間のデータ分離

## 実行前の準備

実DB実行は別途判断する。この実装作業では接続していない。

1. Supabaseダッシュボードでプロジェクト名が **dev-sandbox**、Project RefがCLIの固定値と一致することを確認する。本番k-life-logは開かない。
2. Authentication → Usersで既存ユーザーAがテスト専用か確認する。所有者が確認できない、実運用のアカウント、実データ用のアカウントなら使わない。この場合はテスト専用Aも手動準備する。
3. 同画面のユーザー追加から、別メールアドレスの専用ユーザーBを手動作成する。Email/Password認証を使用し、メール確認済み（作成UIでAuto Confirm Userを選べる場合は有効）にする。既存のAuth設定・権限・RLSは変更しない。ログイン可能なパスワードを設定する。ユーザー作成・削除はCLIから行わない。
4. A/BのユーザーIDが異なり、両方がdev-sandboxのテスト専用であることを確認する。既存Aは過去ケース用のユーザーでもよい。全既存データを取得して不変比較するため、実行中は両ユーザーによる他の操作を止める。
5. `.env.local`には既存と同じdev-sandbox URLとPublishable keyのみを設定する。service_role/secretは不可。メール・パスワードは実行時入力、パスワードは非表示。トークンはメモリ内のみ。認証によるセッション・認証ログは残り得る。ログアウトやトークン更新APIは呼ばない。

## SQL契約と採用範囲

根拠は `../memo/doc/v1.1.0/memo_v1_1_schema_review8.sql` の以下。

| 検証 | 根拠・期待値 |
|---|---|
| 自分のデータの取得 | 94–99行：authenticatedにSELECTを付与し、3テーブルのRLSを`user_id = auth.uid()`で制限。専用メモ・タグ・関連は各1行、HTTP200で取得 |
| 双方向の他人データSELECT | 同じIDフィルターを相手トークンでGET。HTTP200・厳密な空配列。ケース22の401/42501（テーブル権限不足）と異なる。自分側で存在確認した専用行なので、単に存在しないIDの確認ではない |
| スナップショット | 310–320行：SECURITY DEFINERだが3コレクションすべて`auth.uid()`で絞り込み。ゴミ箱内も返す。全行の所有者も検査 |
| 他人のメモ編集 | 123–147行：要求台帳は実行ユーザー単位。タグ配列を空にした有効な編集要求（revision=2）は所有者付き検索で見つからず、`P0002 / memo not found`。ゴミ箱編集拒否より先に所有者検索が行われる |
| 他人の状態変更 | 199–217行：新規requestId・restore・revision=2。所有者付き検索で`P0002 / memo not found` |
| 他人の完全削除 | 230–240行：`user_id`・ゴミ箱状態・revisionで削除対象を制限。`PT409 / not found or revision conflict` |
| 他人のタグ改名・削除 | 275–307行：所有者・revision条件で更新/削除。`PT409 / tag revision conflict`。削除前の関連メモ更新も実行ユーザーで限定。例外時はトランザクション全体が失敗 |
| 自分の専用メモをゴミ箱へ移動 | 212–225行：revision 1→2、deleted_at=updated_at、last_request_idをtrash要求へ更新、本文・タイトル・タグ・pinned_at・作成日時は保持 |

6関数パッチの対応定義は save:4行、change_state:60行、delete_permanently:96行、save_tag:141行、delete_tag:162行。review8本体と同じ所有者条件・業務エラーを使用する。

PostgREST 14の[エラー変換契約](https://docs.postgrest.org/en/v14/references/errors.html#http-status-codes)ではP0002はP0*に該当しHTTP500（P0001だけはHTTP400）、PT409は[カスタムHTTPエラー](https://docs.postgrest.org/en/v14/references/errors.html#raise-errors-with-http-status-codes)としてHTTP409。HTTP・JSON code・SQLで規定したmessageの3条件を厳密照合する。汎用の500や40001は受け入れない。

## 実行順序・安全対策

```powershell
node tools/memo-db-test/isolation-read.mjs
```

最初に`TEST-USERS`でアカウント用途を確認し、A、Bを順に認証する。同一ユーザーIDならDB操作前に停止。

新規UUIDは既存runsの全JSONのUUIDと照合して発行する。識別記録を`wx`で新規作成した後だけ操作する。

1. A/Bの初期スナップショット取得。
2. A、Bそれぞれに専用タグ1件・関連付きメモ1件を作成し、メモをゴミ箱へ移す。各操作後に両方の全データを比較。
3. A→A、A→B、およびB→B、B→Aについてmemos/tags/memo_tagsを直接SELECT。
4. A→B、B→Aそれぞれで編集・復元・完全削除・タグ改名・タグ削除を試みる。どれも拒否が期待値。各拒否直後に両方の全取得データを比較する。

書き込み前は毎回、actor（0=A、1=B）、対象ID、期待revision、requestId、action、専用データだけが影響対象であることを表示。準備6操作＋拒否予定10操作の**16回**、表示された操作名の大文字を入力する。冒頭の用途確認を含め確認入力は17回（認証入力は別）。本文・タイトル・タグ名の実値は表示・記録しない。

最大 **50 RPC**：snapshot34＋準備6（save_tag2、save2、trash2）＋拒否予定10。直接SELECT12回、認証2回を含むHTTP総数は64回。各リクエスト15秒制限、redirectはerror。固定Project Ref検証は設定読込時・各データAPI送信前に適用。

通信失敗・本文受信失敗・JSON解析失敗・HTTP/エラー契約不一致・状態不一致・確認キャンセル・結果記録失敗では即停止。意図しない成功の本文は破棄する。開始済み要求の結果不明時を含め、自動再送・削除・復旧はしない。失敗後は識別記録を使い読み取り専用で状態調査する。

`runs/<runId>.isolation.json`は上書きしない。進捗・最終結果・失敗は別の新規ファイル。記録はUUID・固定された項目名・合否・安全な診断分類のみ。既存比較器でメモ/タグをID、関連をmemo_id+tag_idで対応付け、全フィールドの値と有無・重複・欠落・余分な行を比較する。配列順・オブジェクトキー挿入順は無視する。

## 正常終了後・限界

- 専用メモ2件（各revision=2、ゴミ箱）、タグ2件、関連2件を保持。各ユーザーの作成/trash要求台帳と使用済みID記録も残る。既存PASS対象は再利用しない。
- 要求台帳・使用済みID台帳の内部状態は直接確認しない。状態変更要求をmemo_resolve_requestで照合しない。
- 双方向の代表的なRPCの所有者制限を検証するもので、全RPC・全action・直接DML・添付される任意JWTの偽造・service_roleによるRLS迂回は検証しない。管理者権限は使用しない。
- 他人のタグを自分のメモに関連付けるケース、他人のrequestIdの照合、通常状態のメモへの編集などは今回対象外。RPC内拒否をRLS単独の効果とは呼ばない。
- スナップショットは1ユーザー内で一貫するが、A/B同時点の単一トランザクションではない。実行中の外部更新があれば不変比較はFAILとなる。
- 静的/模擬確認は実DBの権限・エラー変換・RLSの動作実証ではない。実DB実行前に2ユーザーの準備が必要。

## ローカル検証（外部通信なし）

```powershell
node --check tools/memo-db-test/isolation-read.mjs
node --check tools/memo-db-test/isolation-contract.mjs
node --check tools/memo-db-test/isolation-contract.test.mjs
node --test tools/memo-db-test/isolation-contract.test.mjs tools/memo-db-test/unauthenticated-contract.test.mjs tools/memo-db-test/tag-delete-contract.test.mjs
```

テストはfetchを明示的な模擬に差し替え、実ネットワーク利用を禁止する。双方向の正常取得・拒否、両ユーザーの不変、関連の重複/余分/所有者変更、HTTP/code/message違い、通信/受信/解析失敗、途中停止、誤成功、確認キャンセル、記録失敗、上限回数・再送禁止・経路制限を検証する。
