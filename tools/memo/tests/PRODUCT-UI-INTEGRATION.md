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

## 次の統合単位：未公開の製品HTML候補

`build:product`は`.product/site/tools/memo/memo.html`と相対参照のJS/CSSも生成する。公開HTMLのheader/footer・共通資産を保持し、main内部だけ既存メモUIのDOM契約へ接続する。現在は既存`tests/browser/preview.html`のmainを再利用し、DOM契約を重複管理しない。製品レイアウトの最終受入ではなく、将来の切替用候補である。通常の公開HTMLは変更しない。

追加CSSは`.memo-product`内だけに適用する。共通CSS/JSは元の相対参照を維持し、候補ディレクトリだけを単独デプロイできる完成パッケージとは扱わない。build成果物は引き続きGit除外である。

`product-html.test.ts`では生成HTMLの外枠・相対参照・ID重複・旧JS排除を検査し、Chromiumで実製品entry→composition→controller→合成Storageによる新規保存を検証する。全requestはrouteで合成応答または遮断し、実Storage/外部通信は使わない。

公開前の残条件は既存RELEASE-TRANSITION契約を維持する。未更新の旧タブは強制停止できず、旧キー変化の恒久照合方針は未確定。実移行前の原値保護・バックアップ・旧タブ終了案内、版固定/保守版、音声入力、Auth/cloud/UI接続は後続単位で扱う。旧公開版の個別/全削除と新版のゴミ箱/完全削除は同義ではない。音声は旧公開版にはなく、v1.1.0正式仕様の未達として残す。

## 製品候補の資産整合性

buildは製品JS・専用CSS2件のSHA-256を計算し、内容ハッシュ付きファイル名とSRIをHTMLへ設定する。同じHTMLが異なる内容の資産を受け取った場合はブラウザのSRI検証で拒否する。product entryは専用CSS2件のsheetと非空ルールをStorage取得前に確認する。CSS欠落・不一致では起動を停止し、JS欠落・不一致ではHTMLの「起動前」表示を維持する。共通CSS/JSはこの検査の対象外で、既存の相対参照を保持する。

Chromiumの合成応答で正常起動・CSS404・JS内容不一致・CSS内容不一致を検証し、異常ケースのStorage読取0件を確認する。buildは古いハッシュ資産を削除しないが、公開時の旧資産保管期間・配信手順・保守版は未確定である。SRIは配信元自体の侵害や正規の旧HTML再利用を防ぐ保証ではない。既に動作中の旧タブ停止、実データ移行承認、バックアップ/復旧を代行しない。

## 製品候補の読取専用バックアップ

通常load成功後、既存`createLocalBackup`と`mountBackupPreview`を製品compositionへ接続する。形式検証・共通ロック・全体出力・10 MiB・正常v3限定・旧キー/migration/ドラフト除外は[既存出力契約](LOCAL-BACKUP-EXPORT.md)を再利用する。起動や通常保存だけではバックアップを準備せず、準備とダウンロードはそれぞれ明示操作とする。v2は既存のv3-required表示で停止し、自動更新しない。

appのdisposeはバックアップUIへ伝播し、Blob URL解放・DOM除去・以後の準備拒否を行う。既に開始した読取の取消やOSへの保存完了は保証しない。Chromiumの合成Storageで製品entryから保存→バックアップ準備→ダウンロード→JSON内容/Storage無変更を検証する。移行前の旧原値バックアップ、v3導入、復元/回復UI、停止保守版は未接続であり、この出力だけで公開・実移行の保護完了とはしない。
