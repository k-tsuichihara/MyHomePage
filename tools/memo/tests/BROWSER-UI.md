# メモリ保存先による独立UI・ブラウザ検証

根拠：[review8統合仕様§1・2・5](../doc/v1.1.0/memo_v1_1_implementation_review8.md)、[正式画面設計](../doc/v1.1.0/memo_v1_1_layout_review2.drawio)、[ローカル制御層](LOCAL-CONTROLLER.md)、PR #12の承認条件。

## 範囲と構成

- 公開中のmemo.html、js/memo.js、css/memo.css、公開導線・共通資産は変更しない。独立した検証ページを127.0.0.1:4173で配信する。別ポートや公開環境へ自動フォールバックしない。
- tests/browser/preview.html・preview.css・preview.ts・preview-memory.ts・preview.spec.tsとsrc/ui/memo-preview.tsをGit管理する。ビルドした.preview、test-results、playwright-report、プロファイル等だけを除外する。Git除外はソースの機密保護ではなく、追跡ソースは公開リポジトリから閲覧可能。
- esbuildはtests/browser/preview.tsだけをブラウザ用ESMへバンドルする。型チェックは独立したtsc --noEmitで行い、既存TSファイル・旧JSへ出力しない。生成物を手で編集しない。
- src/ui/memo-preview.tsは既存controller.dispatch/getStateだけに接続。controllerのAPI・データ層を変更しない。購読APIを増やす代わりにrequestAnimationFrameで状態世代を観測し、非同期の中間状態も表示する。
- 初回loadはpreview.tsの起動接続が完了を待ち、成功後だけ通常UIをmountする。失敗時は移行診断画面と再診断導線を維持する。通常UI自身は初回loadを重複発行しない。
- 画面設計の一覧検索・並び替え・タグ領域・カードの縦スクロール・詳細前後移動・編集・タグ管理・ヘッダー／フッターを検証する。ピン操作はカードの︙内で行う。スマホは同じ操作を縦配置する。完全な視覚的一致や製品UIの受入完了を意味しない。
- 認証・音声・複製・完全削除・ゴミ箱一括削除は対象外。移行／復旧は[合成データ専用の診断UI](MIGRATION-UI.md)だけに接続する。実データの移行は行わない。複製は未接続と明記し、既存APIを独断で拡張しない。

## データ・ネットワーク保護

- 保存先はページ内の文字列変数、ロックは合成直列キューだけ。旧キーへの永続読書き・ユーザーデータの取込は行わない。ページ再読込ですべての合成データが初期値に戻る。
- 起動時にlocalStorage/sessionStorage/IndexedDB/Cache/Cookie/CookieStore、navigator.storage/serviceWorker、通信APIを禁止ガードへ置換する。既存の保存内容・Cookieは読まない。ガード試験も実APIへは到達しない。禁止API名だけの診断配列を検証用入口に持ち、通常操作でアクセス0件であることをE2Eで確認する。
- サーバーはループバックへ明示bindし、Host・Originを確認。GET/HEADと固定のHTML/JS/CSSだけを許可する。URLをファイルパスへ変換せず、リポジトリ・実設定・source map・テストログを配信しない。CSPで外部資産・通信・フレーム・ワーカー・フォーム送信を禁止し、Cookieを設定しない。
- E2Eは既定の使い捨てBrowserContext。実ユーザープロファイル・persistent context・storageStateを利用しない。service workerを無効化し、リクエストを127.0.0.1の検証originだけに限定する。テスト後Cookieが空であることも確認。
- 依存パッケージ／Playwright管理ブラウザの初回ダウンロードには別途ネットワークが必要。検証ページの実行時通信とは区別する。許可されていない接続を追加しない。

## 入力・結果表示

- 入力欄・フォームは固定DOMで、再描画で交換しない。composition中はdraft/query送信と画面切替を抑止し、compositionendで最新値を送る。フォーカス中の値を書き戻さず、選択範囲やカーソルを変更しない。
- ブラウザのUTF-16 maxlengthをコードポイント制約の代用にしない。保存時の既存入力検証へ委ね、入力中の不正値・空白を消去しない。表示にはtextContentを使い、本文プレビューでもサロゲートペアを切断しない。
- 保存成功／結果不明／拒否、read失敗、未保存追加編集を別々に表示。保存中も入力欄は編集可能。二重操作は既存controllerで拒否し、UIでも保存・遷移ボタンを抑止する。
- 確認には対象名・操作を表示し、controllerの表示時tokenを送る。編集後の確認は隠し、古いtokenを新しいtokenへ暗黙に差し替えない。非モーダルの確認表示なので入力を続けて失効させることができる。
- 検索・並び替え・スクロール時の選択タグはcontrollerの保持条件を使い、DOMから全選択を再構成しない。タグチェック変更はそのIDだけを追加／除外し、不在選択IDも維持する。解除は「タグ絞り込みを解除」の明示操作で行える。
- busy／読込未完了時はタグ絞込チェック自体を無効化する。controllerがqueryを拒否したのに見た目だけが変わることを防ぐ。入力ドラフトの編集可否は従来どおり維持する。

## 実行手順（tools/memoで実行）

```powershell
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd run typecheck
npm.cmd test
npm.cmd run build:preview
npm.cmd run test:e2e
# 手動で合成データだけを確認する場合（終了はCtrl+C）
npm.cmd run preview
```

E2Eは専用サーバーを起動・終了し、既存サーバーを再利用しない。4173番が使用中なら失敗させる。スクリーンショット・失敗時診断はtest-resultsへ保存しGit除外する。本文・タイトル・タグ実値を含む実ユーザーデータを試験材料にしない。

## テスト観点・残存リスク

一覧→詳細→前後→編集→保存→一覧、タグ管理・ピン・ゴミ箱／復元確認、未保存／拒否の離脱確認、保存中の追加入力・二重送信、結果不明、保存成功＋後続load失敗、合成compositionイベントによるDOM・フォーカス・選択範囲、375px幅・キーボード・上限エラー、HTML文字列の非実行、永続API禁止、配信allowlistを検証する。

期待値はReview8と承認済み契約から導き、試験に合わせた契約変更はしない。reload-failureシナリオは保存の読戻し検証を成功させた後のloadだけを失敗させ、unknownシナリオと区別する。

レビュー追試では合成slow-load／slow-mutationを追加し、確認のキャンセル・再表示・失効、保存応答後のフォーカス／別入力欄、一覧DOM再生成とスクロール、タグ操作中の選択保持をE2Eで検証する。確認は各renderが現在のcontroller状態から判定し、入力欄は固定DOM、カード交換は入力欄の外側で行うため、これらに関する本体処理は変更しない。再現した「不在タグIDの暗黙解除」「busy中のチェック表示だけの変更」だけを上記のUI修正で防ぎ、controller・保存APIは変更しない。

実OSの日本語IME、スマホ実機、他ブラウザ、実Web Locks・複数タブ共有・実容量制限は未検証。ブラウザのページ離脱イベントや外部リンクの製品版対応、フォーカス制御のアクセシビリティ監査も後続。実localStorage接続前には隔離origin・専用Context・合成データによる個別試験と承認が必要で、今回のメモリE2Eで安全ゲートを解除しない。公開切替・デプロイ・本番接続は行わない。
## Codexレビューの回帰検証

- 検索欄は書込中・読込未完了中に無効化し、受付不能な検索文字列と一覧結果の不一致を防ぐ。遅延書込・遅延読込の両方で検証する。
- 確認チケットが存在する間はスクロール位置だけのquery通知を控える。ゴミ箱移動・復元の確認をスクロールで失効させず、キャンセル・実行できることを検証する。編集・再読込等による世代変更の失効判定は変更しない。
- 詳細は読込がreadyのときだけsnapshotの内容を表示する。確定保存後の読込失敗時は取得不能を明示し、古い本文・タグや不在の断定を表示しない。保存成功の表示は独立して保持する。新規・更新の両方で検証する。
