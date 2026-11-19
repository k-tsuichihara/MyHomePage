# メモ複製の契約・テスト方針

根拠はReview8統合仕様§5と正式drawio（一覧の︙、詳細の独立ボタン、タイトル・本文・タグをコピー、ピン非継承、手動保存）、PR #16の承認条件。

- 保存済み通常メモだけを複製し、編集中の未保存値は複製元にしない。localはゴミ箱・不在・読込不能時に拒否する。cloudは有効な編集contextの確認済みbaselineを利用し、一覧復帰loadの失敗だけでは複製入口を失わない。Auth/currentness失効、saving、UNKNOWN等の未解決要求は既存境界で停止する。
- 新規編集の空のbaselineにコピー値を設定し、直後から未保存確認を適用する。入力は独立したメモリ値で、複製元を変更しない。
- 保存前は仮の編集IDを用い、永続IDとして照合・保存しない。初回の明示保存時に新IDを採番する。保存APIやv2形式を変更せず、expectedRevision=nullで既存saveへ渡す。ID衝突時は上書きせず拒否し、自動採番し直さない。
- 既存の離脱確認・世代失効・結果不明要求保持・同時書込抑止を再利用する。保存成功前の再読込でコピー内容を再生成しない。タグが不在になれば既存のmissing-tag契約で停止する。
- 保存成功時のrevision=1、日時新規、pinnedAt/deletedAt/lastRequestId=nullは既存saveが設定する。複製元の更新日時・revision・内容は不変。

## Q05：通常画面を編集へ統一した後のcloud複製

cloud編集画面にも「前→複製→次」の独立ボタンを設け、一覧メニューと同じ`createDuplicateEditor`で新規editorを作る。pure関数は従来の検証済みMemo入力に加え、保存済みEditorStateのbaselineを受け付ける。baselineは既存の保存内容正規化を通し、dirtyな現在draft・元ID/revision/pin等のメタデータは引き継がない。別の保存済み値やrevision管理をUIへ持たない。

dirty/rejectedの離脱は既存requestNavigation/confirmNavigationのduplicate対象ticketを使う。cancel・確認後編集・Auth世代失効ではコピーを始めない。有効承認後だけ新IDと新sessionを既存createIdから生成し、空baseline・expectedRevision=nullの既存cloud新規editorへ接続する。未保存の新規/複製editorにはさらに複製する入口を出さず、save/resolve中・UNKNOWNでは開始を止める。既知のnot-foundも対象にしない。保存成功後の次の複製は更新された確認済みbaselineを使う。

押下だけではload/save/resolveもlocal writeも発生しない。保存は既存C04 save、UNKNOWN後は既存の明示resolveをそのまま使い、requestId生成・凍結・再送禁止は変更しない。cloudでは新規開始時点で既存createIdから保存先IDを作り、localの仮ID→初回保存時採番とは区別する。

## 検証

単体・結合：原文とタグのコピー、独立性、未保存確認、保存前書込0件・ID未採番、初回新規保存、保存後追加編集、離脱キャンセル・確認失効、二重操作、ID衝突、拒否・結果不明・容量例外、保存中操作拒否、旧キー・移行snapshot不変。

メモリE2E：一覧／詳細から複製、保存前の一覧件数不変、離脱確認・キャンセル、明示保存で非ピンの新規メモ、ゴミ箱で複製不可、遅延保存・追加編集と二重クリック、拒否・結果不明でも入力保持。既存全Vitest・メモリE2E・ビルドを回帰実行する。

公開画面・実ユーザーデータ・Supabase/Authには接続しない。完全削除・一括削除・ID永続registry・移行／復旧API変更は対象外。UIを共用する既存隔離永続化／切り替え試験は回帰確認するが、本番接続の承認とはしない。

## 実行結果（2026-10-29）

型チェックPASS、Vitest845件（既存825＋20）、メモリE2E48件（既存42＋6）、既存永続化E2E16件、切り替え20件（未検証0）、各ビルド・差分検査PASS。永続化専用HTMLも共通UIの複製ボタンに合わせた。追加前の専用HTMLでは起動停止を検出し、失敗profileはローカルに保全した。生profile・生成物はGit除外のまま。

複製固有のブラウザ試験は合成メモリのみ。実ユーザー保存先・本番配信・他ブラウザ・実機IME・ブラウザ終了後の未保存ドラフト復元は保証しない。永続化回帰は既存のテスト所有profile／専用origin限定で、今回の複製フローを本番へ接続する試験ではない。

## レビュー対応のID整合性

初回保存のbeginSaveが返す状態は採番済みIDを持ち、元からeditorと送信要求には反映されていた。一方、応答待ちのrouteだけが仮IDのままである不整合を再現したため、書込開始の同じ状態更新でrouteも採番済みIDへ揃える。

成功・拒否・結果不明それぞれについて、開始時からeditor.id／route.id／SaveAttempt.request.id／ControllerAttempt.input.idを直接照合する。追加入力・二重保存・ID衝突後のloadも検証する。結果不明後に実IDが不在なら、新たな明示承認・別requestIdで同じ採番済みメモIDを使用する。実IDが既に存在する場合のid-existsは正しい保護であり、成功へ昇格させず再保存を止める。旧不明要求は履歴としてメモリに保持し、仮IDへ戻したり自動再送したりしない。

レビュー回帰テスト6件を追加し、全Vitest851件・型チェックに成功。既存メモリE2E48件・永続化E2E16件・切り替え20件（未検証0）と各ビルドも回帰確認した。実ユーザーデータ・公開資産・保存／移行APIは変更しない。
