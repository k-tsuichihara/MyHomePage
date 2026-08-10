# DB設計

## reading_books

|列名|型|内容|
|---|---|---|
|id|uuid|アプリ内ID|
|isbn|text|ISBN|
|title|text|タイトル|
|author|text|著者|
|category_id|int|カテゴリID|
|status|text|状態|
|read_date|date|読破日|
|rating|int|評価|
|memo|text|メモ|
|impression|text|感想|
|cover_url|text|表紙画像URL|
|created_at|timestamp|作成日時|
|updated_at|timestamp|更新日時|
|is_deleted|boolean|削除済みフラグ|

## 制約
- status は want_to_read / reading / read のどれか
- rating は 1〜5、ただし未評価なら null 可
- read_date は status = read のときだけ必要
- 特定ユーザーがログイン後、SELELCT/INSERT/UPDATE/DELETE可能。

## reading_categories

|列名|型|内容|
|---|---|---|
|id|int|カテゴリID|
|name|text|カテゴリ名|
|color|text|背景色|
|display_order|int|表示順|
|created_at|timestamp|作成日時|

## reading_books_public

公開一覧用ビュー（未ログイン）

テーブル「reading_books」のうち、一覧画面で使用する情報だけを公開する。
感想・メモなどの情報は含めない。

|列名|型|内容|
|---|---|---|
|id|uuid|アプリ内ID|
|title|text|タイトル|
|author|text|著者|
|category_id|int|カテゴリID|
|status|text|状態|
|read_date|date|読破日|
|rating|int|評価|
|category_name|text|カテゴリ名|
|category_color|text|背景色|

### 抽出条件
- reading_books.is_deletedがfalse
- reading_books.category_id = reading_category.id で外部結合

### 用途/方針
- 一覧表示用に必要な情報のみ返したかったため
- 個人を特定できるような情報（感想など）は含めたくなかったため
- SELECTに関しては権限設定なし