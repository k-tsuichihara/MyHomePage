# TypeScript製品UI統合：最初のlocal接続単位

R02の最初の実装単位として、公開切替前に製品用composition rootとブラウザ保存境界を整備する。正式根拠はReview8、既存の移行・保存・編集契約、`RELEASE-TRANSITION.md`である。

## 今回接続する範囲

- `product-local-app.ts`は、既存の移行controller、local store/controller、移行UI、メモUIだけを組み立てる。移行診断がreadyで、通常loadにも成功するまで操作UIを接続しない。
- `product-browser-local.ts`はHTTPS・top-level・secure context・既存`tools/memo/memo.html`パスを確認してからブラウザAPIを取得する。旧キーは読取専用、新キーだけを書込可能とし、他のStorageキーへアクセスしない。
- `build:product`はlocal製品入口を`.product/memo-app.js`へ生成する。Auth、Supabase、cloud、readonly trial、外部依存がbundleへ混入した場合は成果物を書かず失敗する。

## 今回は切り替えないもの

公開`memo.html`は引き続き旧`js/memo.js`を参照する。旧タブ併用、実ユーザーデータ移行、公開資産の版固定、停止保守版、音声入力の未達を解消・承認する前に公開入口を差し替えない。生成した`.product`はGit管理・Pages配信対象にしない。

C03の実Auth、C04の実HTTP・single-rpc認定、C05の製品UI切替も未結線のままとする。local/cloud間の自動同期・転送・fallbackは追加しない。

## AI Gate

- 製品ブラウザ境界が不正URL・非secure・frameをStorage取得前に拒否すること。
- project siteのpath prefixを許容しつつ、旧新2キー以外を読まず、旧キーを一切書かないこと。
- 移行readyと通常load成功後だけUIを接続し、disposeを伝播すること。
- product bundleにAuth／cloud／Supabase等が含まれないこと。
- typecheck、全Vitest、`build:product`、`git diff --check`を実行する。実Storage、実Auth、実RPC、DB、Pages公開は行わない。
