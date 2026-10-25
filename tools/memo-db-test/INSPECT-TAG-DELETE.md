# ケース18失敗runの読み取り専用診断

対象runは9fec4de4-3fc6-493e-856f-ad8a469ae86bに固定。任意run/パス/対象ID/RPCの入力は受け付けない。
Node.js22以上・対話ターミナルでリポジトリルートから：

```powershell
node tools/memo-db-test/inspect-tag-delete.mjs
```

共通CLIのdev-sandbox固定Project RefとPublishable key形式を通信前に検証する。
識別記録・タグ作成2段階PASS・失敗記録を照合。tag-delete段階のPASSは削除予定タグの作成成功であり、削除成功を意味しない。
対象メモID/requestId、ID重複、所有者、段階名、失敗項目、時系列の対応を検証する。
同じテストユーザーで非表示パスワード認証し、記録の所有者と一致した場合のみ読み取りへ進む。

## 確認項目

- メモ1が1件存在しrevision1、last_request_id一致。
- 本文・タイトルが当該runの生成規則に一致、deleted_at=null、pinned_at=null。
- created_at/updated_atは現在の初期条件として有効かつ同じ。
- 削除予定タグDと保持タグKが各1件存在し、所有者・生成名・revision1が一致。
- メモ1→D、メモ1→Kが各1件存在し、関連の所有者も一致。余分な関連はない。
- 未到達のメモ2とその関連は不在。
- snapshot全体の所有者・参照整合性・重複を可能な範囲で検証。

IDで行を特定し、関連は複合キーごとに確認する。オブジェクトキー順・配列順に依存するJSON文字列整列は使わない。
差分は固定項目名とPASS/FAIL、revision/関連件数など安全な概要だけを表示。
本文・タイトル・タグ名・requestId等の実値、認証情報、エラー本文・スタックは出力・保存しない。

## 読み取り専用性とエラー分類

認証後のRPCはmemo_load_snapshotを1回のみ。ケース17診断の通信関数を変更せず再利用する。
通信関数は固定dev-sandbox origin、login/snapshotの2種類のみ受け付け、snapshot JSONは常に{}。
本体SQL311–319のmemo_load_snapshotはSELECTのSQL STABLE関数。
保存・要求再送・タグ削除・復旧・任意SQLを実行する経路はない。
認証APIはセッションを作り得るがメモ・タグ操作ではない。診断ファイル操作はreadFileだけで、結果の保存も行わない。
最大：認証1回、読み取りRPC1回。自動再試行なし。15秒期限・リダイレクト拒否。
fetch通信・HTTP応答・本文受信・JSON解析・取得後検証・記録読取/照合を区別し、安全な例外名/cause.codeだけ表示する。

## 限界

現在状態が全項目PASSでも元runのFAILをPASSにしない。当時のsnapshotは未保存で、直接原因はこの診断だけで確定しない。
過去の日時や対象外データの完全不変は証明できない。対象外は読み取りのみで変更しないが、当時の状態との比較はできない。
現在の差分は後日の操作によっても生じ得る。ケース18のテストコード、SQL、アプリ本体、元runと過去PASS記録は変更しない。
診断結果に関係なく保存再送・削除・復旧を行わない。実DB診断の実行は別途判断後。

```powershell
node --check tools/memo-db-test/inspect-tag-delete.mjs
node --check tools/memo-db-test/inspect-tag-delete-contract.mjs
node --check tools/memo-db-test/inspect-tag-delete-contract.test.mjs
node --test tools/memo-db-test/inspect-tag-delete-contract.test.mjs
```

模擬テストは元run4記録を読むが変更しない。実ネットワークは禁止。
