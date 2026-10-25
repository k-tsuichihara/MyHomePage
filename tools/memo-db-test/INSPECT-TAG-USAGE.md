# ケース17失敗runの読み取り専用診断

対象runは5efbc55f-5c15-400e-8f99-fc2682f1ad61に固定。任意パス・任意run・任意RPCは入力できない。
Node.js22以上の対話ターミナルでリポジトリルートから：

```powershell
node tools/memo-db-test/inspect-tag-usage.mjs
```

1. 共通CLIの設定でdev-sandbox固定Project RefとPublishable key形式を検証。
2. 識別記録、tag-used/tag-unusedのPASS結果、failure記録を照合。対象ID・所有者・時系列・件数・失敗段階を検証。
3. 同じテストユーザーのメールアドレスと非表示パスワードを対話入力。所有者不一致ならsnapshotを呼ばず停止。
4. memo_load_snapshotを1回だけ呼ぶ。認証を除くDB操作はこれだけ。
5. 現在状態を項目別PASS/FAILで表示。値は安全なrevision/件数だけ。本文・タイトル・タグ名・last_request_idの実値は表示しない。

## 確認項目

- 使用/未使用タグが各1件存在、所有者・生成規則の名前・revision1が一致。
- メモ1が存在しrevision1、作成requestId一致、通常状態・未ピン留め、期待タイトル/本文一致。
- メモ1のcreated_at/updated_atが有効かつ等しい。
- メモ1の関連が使用タグに1件だけ存在し、未使用タグの関連は0。
- 未到達だったメモ2とその関連が存在しない。
- 通常メモだけのローカル集計で使用タグ1・未使用タグ0。
- snapshotの所有者・参照・関連重複の整合性。

差分はmemo-1.bodyMatchesなど固定の項目名と一致可否だけを表示する。現在の本文やタグ名などは出力・保存しない。
不整合データでも可能な範囲で対象の差分を先に表示し、全体の参照検証エラーは別項目で報告。

## エラー分類と安全性

fetch通信 / HTTP応答（ステータスのみ） / 応答本文受信 / JSON解析 / 取得後検証 / 記録読取・照合を区別。
fetch例外名・cause.codeは既存の許可リスト方式だけで表示し、任意の例外メッセージ・スタックは表示しない。
15秒期限・リダイレクト拒否、HTTP200必須。自動再試行なし。
通信関数はdev-sandboxの固定originとlogin/snapshotの2種類しか受け付けず、snapshotの送信JSONは常に{}。
SQLのmemo_load_snapshotはSQL STABLEのSELECT（review8本体311–319行）。保存/タグ操作/要求再送/削除/復旧を呼ばない。
認証APIはセッションを作り得るが、メモ・タグに書き込む操作はない。
診断コードのファイル操作はreadFileのみで、結果ファイル・元run・過去PASS記録を書き換えない。
本番k-life-logへ接続せず、アプリ本体・SQLも変更しない。

## 判定の限界

診断全項目PASSでも元runのFAILをPASSにしない。現在状態が失敗直後の期待値と整合するという診断のみ。
当時の保存応答・全snapshot・通信詳細は記録されていないため、過去の日時/本文の完全不変や対象外データの不変、
失敗時の通信障害と比較不一致の区別、サーバー内の処理経過は証明できない。
日時は現在の初期条件だけを検証し、当時の日時と完全一致したとは扱わない。
差分はその後の利用者操作によっても発生し得る。元の障害原因と即断しない。

## ローカル検証

```powershell
node --check tools/memo-db-test/inspect-tag-usage.mjs
node --check tools/memo-db-test/inspect-tag-usage-contract.mjs
node --check tools/memo-db-test/inspect-tag-usage-contract.test.mjs
node --test tools/memo-db-test/inspect-tag-usage-contract.test.mjs
```

模擬テストは対象runの4記録を読み取るが変更しない。実ネットワークは禁止。
実DB接続・診断実行は未実施。実行は別途判断後。
