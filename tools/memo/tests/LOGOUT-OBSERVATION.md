# UAT-07 logout不具合：原因調査結果と修正要約

## 確認できた事実

Humanが取得した固定コード106行から、logout成功・元の保存先変更pending解除・local復帰を確認した。その後、明示的な再loginが行われ、login成功後の自動cloud切替で新しい確認が生成された。「ダイアログを再表示しただけで再生成」という当初の見立てを訂正する。

原因は、logoutで離脱承認済みの保持cloud editorの単純dirtyを、再login後の保存先変更でも再評価したこと。logout操作所有権の修正案は今回採用しなかった。

## 採用した製品修正

成功したlogoutで承認した同一不変EditorStateとcloud所有userに限り、安全な単純dirtyを保存先変更の再確認対象から除外する。draft、保存拒否、UNKNOWN、未解決要求は削除しない。departureとC05 dirty算出を同じ条件に揃える。

cloud切替成功時に承認記録を消費し、現在editorの通常保護を戻す。editor変更、別user確定、dispose、logout未開始・失敗時などには古い記録を流用しない。暗黙保存・削除・コピーは追加しない。

## 一時診断の撤去

先生レビュー承認後、固定コード記録器、パネル、専用フック、観測build・起動経路、診断専用テスト12件を撤去した。通常build方式へ戻し、合成イベントfixture、不具合回帰試験、EditorState不変性試験は維持する。旧観測成果物も削除し、旧起動手順は提供しない。

実装・offline検証とHuman受入は区別する。UAT集計はPASS6/FAIL1/NOT STARTED1/SKIP2を維持し、Human残確認は[UAT正本](HUMAN-UAT-v1.1.0.md)を参照する。Playwright CLI終了処理課題は未解決・今回対象外。

今回の撤去作業では実通信・Human操作・DB操作・commit/push/PR作成・公開を行わない。
