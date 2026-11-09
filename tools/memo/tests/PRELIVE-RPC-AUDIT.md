# C04 実接続前 RPC 静的監査

## 1. 監査範囲と基準

- 基準コミット: `ca99679`（PR #57 マージ後の `main`）。
- 対象: C01〜C04 の契約・実装、Review8 SQL、通信なし試験。
- 本書は静的監査と実接続の事前計画のみを記録する。実HTTP、実Auth、実DB、SQL実行は行っていない。
- `single-rpc` への昇格は行わず、現行の `unverified` 契約を維持する。

## 2. 8 RPC の静的照合

Review8 SQL と `cloud-rpc-sender.ts` の許可キーを照合した結果、対象と引数の対応は次のとおりである。

| RPC | SQL署名 | sender の引数キー | 台帳/requestId |
| --- | --- | --- | --- |
| `memo_load_snapshot` | `()` | なし | 読取専用 |
| `memo_save` | `uuid,text,text,uuid[],bigint,uuid` | `p_id,p_title,p_body,p_tag_ids,p_expected_revision,p_request_id` | あり |
| `memo_resolve_request` | `uuid,uuid,text,text,uuid[],bigint` | `p_id,p_request_id,p_title,p_body,p_tag_ids,p_expected_revision` | 参照・照合 |
| `memo_change_state` | `uuid,bigint,uuid,text` | `p_id,p_expected_revision,p_request_id,p_action` | あり |
| `memo_delete_permanently` | `uuid,bigint` | `p_id,p_expected_revision` | なし |
| `memo_empty_trash` | `uuid[],bigint[]` | `p_ids,p_revisions` | なし |
| `memo_save_tag` | `uuid,text,bigint` | `p_id,p_name,p_expected_revision` | なし |
| `memo_delete_tag` | `uuid,bigint` | `p_id,p_expected_revision` | なし |

SQL上は `authenticated` へのRPC実行権限、対象テーブルのRLS、所有者 (`user_id = auth.uid()`) 条件、要求台帳の主キー `(user_id, request_id)` が定義されている。テーブルの直接権限は公開ロールから取り上げられている。これらはリポジトリ上の定義の確認であり、開発DBの実効権限・RLS動作を証明するものではない。

`cloud-rpc-adapter.ts` は応答形を厳格検証し、`unverified` を成功・確定拒否として扱わない。削除・タグ操作に架空の resolve を追加していない。

## 3. コードで確認できること／未検証

### コードで確認できること

- `MEMO_RPC_ORIGIN`、RPCパス、POST、許可された8 RPC、引数キーが固定されている。
- 任意URL・redirect（`redirect: error`）・ステータス範囲外・応答URL不一致を拒否する。
- 15秒のAbort制御、204空本文、JSON解析、固定理由への変換を行う。
- fetch は注入ポートを1回だけ呼び出し、自動再送・リダイレクト追従・自動フォールバックを実装していない。
- Bearer は sender 境界内に保持し、結果・ログ・UI状態へ出さない。
- C03 `prepareRpc()` と C04 controller が、開始時・資格情報取得後・送信直前・応答反映前に所有者と認証世代を確認する。
- sender の結果は常に `provenance: unverified` であり、adapter/controller はこれを `single-rpc` と認定しない。

### 実経路で未検証のこと

- Supabase JS SDK、ブラウザ fetch、プロキシ、CDN、PostgREST が再送・中継・redirectを行わないこと。
- 応答URL/status/bodyが実際の単一RPC実行に由来すること、HTTP応答とDB結果の対応。
- 開発環境のAuth、GRANT、RLS、8 RPC本文、要求台帳、エラーコードの実動作。
- 実ブラウザのStorage、Bearer送信、TLS、タイムアウト後のサーバー側処理。
- 実経路を `single-rpc` と認定するための証跡。

## 4. 最初の読み取り専用試験案（未実施）

実施にはオーナーの個別承認が必要であり、以下は提案である。

1. Dashboard と接続先を照合し、開発用 `dev-sandbox` であることをオーナーが確認する。本番origin・本番アカウントは使用しない。
2. 合成テストユーザーを用い、service role・管理キー・既存ユーザーデータを使用しない。
3. 認証後、許可RPCを `memo_load_snapshot` のみに限定する。書込、状態変更、削除、タグ操作、resolve は実行しない。
4. 1回の認証経路と1回の load 呼出しを上限とし、自動再送を行わない。画面待機は30秒を上限とする（この上限値の最終承認は未取得）。
5. 記録は環境ラベル、RPC名、呼出し回数、HTTP分類、失敗理由、検証済みの件数だけに限定する。トークン、パスワード、メール、メモ本文、UUID、生レスポンスは保存・表示しない。
6. origin違い、許可外RPC、想定外メソッド、redirect、timeout、通信断、非JSON、応答URL不一致、呼出し回数超過、認証所有者不一致、結果不明のいずれかで即時停止する。
7. 現行senderは `unverified` を返すため、この試験の成功は読み取り経路の観測に限られ、`single-rpc` 認定には用いない。

## 5. `single-rpc` 認定に不足する証拠

- 実Authから取得した資格情報が対象ユーザー・対象環境に属する証跡。
- 固定originからPostgRESTの1 RPCへ一度だけ到達したことの、SDK・fetch・中継を含む監査可能な証跡。
- 実HTTP status、応答URL、本文、PostgRESTエラーを正式契約と照合した記録。
- redirect・再送・プロキシ中継・timeout後処理がないことの確認。
- RLS、GRANT、要求台帳、RPC本文、所有者境界の実動作確認。
- 送信後の結果不明、古い応答、複数タブ競合の実環境証拠。

上記が揃わない限り、応答の見た目やHTTP 2xxだけで `single-rpc` に昇格しない。実接続前には、開発環境限定、読み取り専用、呼出し上限、証跡の非公開保管、失敗時停止についてオーナー承認を得る必要がある。

## 6. 進捗

`docs/RELEASE-PLAN-v1.1.0.md` の C04 は進行中を維持する。今回の静的監査資料を追加したが、実HTTP・SDK sender 接続・製品UI・C05・本番Authは未着手／未検証である。
