# 開発DB定義監査：差分チェックリストと手動実施記録

[監査手順](DEV-DB-AUDIT.md)に従う。**オーナーよりA01〜A17手動実施済みの報告あり。第6章に実施状況・結果要約を記録した。** 第1〜5章は準備時の細目/記録テンプレートであり、未提供の細目を一括でチェック済みにしない。正式Review8との比較とセキュリティ上の判断を分け、想定外の差分を自動修正しない。

記録ヘッダー：基準main SHA／正式SQLファイル版／対象プロジェクト確認根拠（接続文字列・キーは記載しない）／取得日時／実行者の権限区分／PG版／PostgREST版と根拠／承認範囲／出力切詰めの有無。

各行の記録欄は共通して `判定（一致・差分・未確認・対象外） / A番号 / 差分要約 / 影響 / 次の判断・承認` とする。生SQL結果をこのファイルへ貼らない。

## 1. 表・列・制約（A02〜05）

| 表 | 期待する列（正式SQL順） | 必須の構造 | 記録 |
|---|---|---|---|
| memos | id, user_id, title, body, created_at, updated_at, pinned_at, deleted_at, revision, last_request_id | id PK、(user_id,id) UNIQUE、user_id→auth.users CASCADE、タイトル/本文CHECK、revision安全整数CHECK | 未確認 |
| tags | id, user_id, name, created_at, revision | id PK、(user_id,id) UNIQUE、user_id→auth.users CASCADE、name CHECK、revision安全整数CHECK | 未確認 |
| memo_tags | user_id, memo_id, tag_id | (memo_id,tag_id) PK、(user_id,memo_id)→memos、(user_id,tag_id)→tags、両FK CASCADE | 未確認 |
| memo_id_registry | user_id, memo_id | (user_id,memo_id) PK、user_id→auth.users CASCADE。memo_idにmemosへのCASCADE FKを追加しない | 未確認 |
| memo_requests | user_id, request_id, memo_id, operation, payload_hash, result, deleted_redacted | (user_id,request_id) PK、user_id→auth.users CASCADE。メモ削除で台帳が連鎖消失するFKを追加しない | 未確認 |

- [ ] UUID列はuuid、日時はtimestamptz、revisionはbigint、title/body/name/operation/payload_hashはtext、resultはjsonb、deleted_redactedはboolean。
- [ ] memosのpinned_at/deleted_at/last_request_id、requests.resultはnullable。他の正式列はNOT NULL。
- [ ] body default空文字、created_at/updated_at default now()、revision default1、deleted_redacted default false。identity/generatedや未知defaultの追加なし。
- [ ] revisionは1〜9007199254740991。CHECKが未validationではない。FK先・削除規則・deferrable設定を原本と照合。
- [ ] タグの一意indexは(user_id, memo_tag_key(name) COLLATE "C")。lower(name)への置換なし、ASCII限定キー。
- [ ] memos_owner_updated(user_id,updated_at DESC)、memos_owner_trash(user_id,deleted_at)、memo_tags_owner_tag(user_id,tag_id)とPK/UNIQUE用indexが有効・ready。
- [ ] 未知列・余分なCHECK/UNIQUE/FK/indexも記録する。名前だけの一致では判定せず定義・型を比較。to_jsonbの未知列増加はクライアント全体拒否に影響。
- [ ] 表種別・所有者・追加トリガー/ルール（A16）が想定と異なれば停止して判断。

## 2. 8 RPCと4補助関数（A06/任意定義取得）

| 関数 | 正式な入力引数（順序・名前を照合） | 戻り値 | 記録 |
|---|---|---|---|
| memo_load_snapshot | なし | jsonb | 未確認 |
| memo_save | p_id uuid, p_title text, p_body text, p_tag_ids uuid[], p_expected_revision bigint, p_request_id uuid | jsonb | 未確認 |
| memo_resolve_request | p_id uuid, p_request_id uuid, p_title text, p_body text, p_tag_ids uuid[], p_expected_revision bigint | jsonb | 未確認 |
| memo_change_state | p_id uuid, p_expected_revision bigint, p_request_id uuid, p_action text | public.memos | 未確認 |
| memo_delete_permanently | p_id uuid, p_expected_revision bigint | void | 未確認 |
| memo_empty_trash | p_ids uuid[], p_revisions bigint[] | integer | 未確認 |
| memo_save_tag | p_id uuid, p_name text, p_expected_revision bigint | public.tags | 未確認 |
| memo_delete_tag | p_id uuid, p_expected_revision bigint | void | 未確認 |

- [ ] 8RPCはSECURITY DEFINER、`SET search_path = ''`、default引数・SETOF・未知overloadなし。ownerは実行者由来で固定名を仮定せず、用途と権限をオーナーが確認。
- [ ] 不在関数はpresent=false、逆解析等の結果はNULLとして記録する。CASEによる存在時評価を維持し、逆解析関数のNULL時動作を仮定しない。対象版の挙動は実行承認後に確認する。
- [ ] loadはlanguage SQL/STABLE。他7関数はplpgsql/VOLATILE。原本にないLEAKPROOF・parallel属性等を確認。
- [ ] 4補助関数：memo_edge_spaces()→text、memo_trim_edges(s text)→text、memo_valid_text(s text,field text)→boolean、memo_tag_key(s text)→text。IMMUTABLE、PARALLEL SAFE、空search_path、SECURITY INVOKER。
- [ ] 定義本文を取得できなければ以下の本体確認は未確認のまま残す。fingerprintだけで一致扱いしない。
- [ ] 入力の空白集合・コードポイント上限・制御文字・ASCIIタグキー・C照合が正式SQLどおり。拡張呼出しはextensions.digestを明示。
- [ ] 各RPCはauth.uid()の認証/所有者条件を持つ。loadは3集合全てを所有者で絞り、未認証時null。SQL文1つのsnapshot。
- [ ] save/state/削除/tag操作は共通のユーザー単位advisory transaction lock。期待revision、状態、タグ所有者を検証。
- [ ] 保存ハッシュはサーバー側UTF8変換・正規化タグ集合・全凍結要求を使用。台帳キー(user_id,request_id)で操作/対象/内容の混用を拒否。
- [ ] 要求照合はnullを未実行の証明とせず、saved履歴とpreviously-applied-deletedを分離。クライアントと新しいRPC/引数が混入していない。
- [ ] 業務競合はPT409と操作別の正式メッセージ。40001への旧定義が残っていない。P0002のmemo not foundとpreviously applied, memo deletedを区別。
- [ ] 完全削除はメモ・関連を除去しregistry保持、当該メモの台帳result=null/deleted_redacted=true。台帳自体を削除しない。
- [ ] 一括削除は全ID/revision集合一致で原子的に処理。タグ削除は関連メモ（ゴミ箱含む）のrevision更新とlast_request_id=nullを同じtransactionで行う。

本体の静的確認はデータの実在・要求履歴不変・原子性の実行保証とは別である。HTTP200/204、500/P0002、409/PT409、未知エラーのunknown分類はPostgREST版確認と別承認の実HTTP試験で確認する。

## 3. RLS・ACL・実効権限（A07〜14/17）

- [ ] 5表すべてRLS enabled。FORCE RLSは原本で明示されていないため実値とowner挙動を記録して判断。
- [ ] memos/tags/memo_tagsのSELECT policyはauthenticatedに`user_id = (select auth.uid())`。追加の全許可policy、PUBLIC/別role、INSERT/UPDATE/DELETE policyやWITH CHECKを確認。
- [ ] registry/requestsはクライアント用policyなし。RLSだけに依存せず、表・列ACLからもクライアント読取/DMLを禁止。
- [ ] authenticatedは3公開表のSELECTだけ。anonは5表の権限なし。PUBLIC由来や継承・列単位の権限を含め、DML/TRUNCATE/REFERENCES/TRIGGER許可なし。
- [ ] 8RPCのEXECUTEはauthenticatedのみ（owner/管理ロールの権利は別記）。PUBLIC/anonへの残存、grant option、同名overloadの公開を確認。
- [ ] 入力補助4関数は原本でPUBLIC EXECUTEをREVOKEしていない。8RPCと同じ期待値へ勝手に変更せず、実値と必要性を記録。
- [ ] schema USAGE、CREATE、owner属性、rolinherit/rolsuper/rolbypassrls、authenticator membershipを確認。一般クライアントが作成/昇格できる場合はセキュリティ差分として判断。原本にschema ACLの全設定はない。
- [ ] NULL ACL、PUBLIC、所有/継承を含む実効権限と明示ACLを照合。列権限・default privilegesも確認。直接membership出力だけで全継承経路を監査済みとしない。
- [ ] SQLセッションのロールと、HTTP側のJWT→ロール設定の対応は別途確認。管理ロールとして読めることをRLS試験の代用にしない。

## 4. 拡張・版・未確認事項

- [ ] A15：pgcryptoがextensionsに存在し、digest(bytea,text)→bytea（及び実在overload）が拡張に所属。別schemaなら停止し、移設/再インストールしない。
- [ ] A01：PostgreSQL版、server_encoding=UTF8、監査セッションのread-only/timeoutを記録。版に適合しないSQLは実行しない。
- [ ] PostgREST実版と根拠をオーナー確認。DB版/拡張版から推定しない。未確認ならHTTP契約ゲートは保留。
- [ ] 前回33試験は全ACL/直接DML/期限切れJWT/内部台帳/同時snapshotを網羅していない。今回のカタログ監査でもデータ整合性・実効RLS動作は未検証とする。
- [ ] 権限エラー/出力切詰め/オブジェクト欠落/同時変更があれば未確認。追加権限やSQL適用を自動実施しない。
- [ ] 生結果・定義全文・ロール/内部構造の情報露出をレビューし、PRへは差分要約だけを転記。

## 5. 差分記録テンプレート（PR #30準備時）

以下は準備時の未確認状態を保持したテンプレート。今回の手動監査報告の記録は第6章を参照する。

| 項目/A番号 | 正式根拠 | 判定 | サニタイズ差分要約 | 影響・停止要否 | 次の判断/承認 |
|---|---|---|---|---|---|
| 実行前プロジェクト確認 | オーナー確認 | 未確認 | 未取得 | 接続前ゲート | 未承認 |
| A01〜17 | Review8/本手順 | 未確認 | 未実行 | 各項目確認待ち | 未承認 |
| 任意関数全文 | Review8 SQL/6関数パッチ | 未確認 | 未取得 | 本体一致を未判定 | 別承認 |
| PostgREST版 | オーナーの運用情報 | 未確認 | 未取得 | HTTP分類を未実証 | 別承認 |

一致でも実接続試験・本番適用・公開の承認とはしない。差分の修正案は別作業として先生/オーナーが判断する。

## 6. 手動監査の実施・結果要約（2026-11-02記録）

基準main：`c47bdca43158b605edff9292ccb3f24c1c875755`。オーナーは先生との会話でSQL Editor結果を提示済み。[先生レビュー](https://github.com/k-tsuichihara/MyHomePage/pull/31#issuecomment-6567886934)の安全な実測要約を追記した。原本は本作業チャットには転記されておらず、AIはDBへ直接接続・生結果の独立照合をしていない。以下の「期待どおり」は報告範囲に限定し、要約にない値を補完しない。

以下は実施した手動SQLの番号。リポジトリのcatalog-audit.sql案とは一部対応が異なる。手動A09はシーケンスACL/存在確認、A12は関数の実効EXECUTE、A13はpublicスキーマの実効USAGE/CREATE。SQL案A09は列ACL、A12は実効列権限、A13は関数とスキーマ権限をまとめている。SQL案は変更せず、その細目を手動結果から一括合格扱いしない。

| 番号 | 実施状況（オーナー報告） | 結果・限界 |
|---|---|---|
| A01 | 手動実施済み | PostgreSQL 17.11、UTF8、postgres、transaction_read_only=off（A01照会時）、statement_timeout=2min、lock_timeout=0。以後のBEGIN READ ONLYの有効性を単独では証明しない |
| A02 | 手動実施済み | 既存5表の定義・権限は期待どおりとの報告。5表すべてRLS有効、FORCE RLS false |
| A03 | 手動実施済み | カラム定義は期待どおりとの報告。個別行は本レビュー要約に未転載 |
| A04 | 手動実施済み | 制約定義は期待どおりとの報告。個別行は本レビュー要約に未転載 |
| A05 | 手動実施済み | index定義は期待どおりとの報告。個別行は本レビュー要約に未転載 |
| A06 | 手動実施済み | 8RPC＋補助4関数の計12関数。定義メタデータは期待どおりとの報告。RPC本文の一致は未検証 |
| A07 | 手動実施済み | RLSポリシー定義はカタログ確認の範囲。ユーザー間の実動作は未検証 |
| A08 | 手動実施済み | 既存テーブル権限は期待どおりとの報告。ACL原本は未取得 |
| A09 | 手動実施済み | 手動SQLのシーケンスACL/追加存在確認でpublicシーケンス0件。SQL案A09の列ACLとは別 |
| A10 | 手動実施済み | 8RPC権限は期待どおりとの報告。補助4関数の公開EXECUTEは継続レビュー |
| A11 | 手動実施済み | 既存表の実効権限は期待どおりとの報告。RLSによる行可視性は未検証 |
| A12 | 手動実施済み | 関数の実効EXECUTEは期待どおりとの報告。補助4関数の公開EXECUTEは継続レビュー。SQL案A12の実効列権限とは別 |
| A13 | 手動実施済み | publicスキーマの実効USAGE/CREATEを確認。要約にないロール別真偽値は補完しない |
| A14 | 手動実施済み | 3ロールの属性実値は先生との会話で提示済み。本レビュー要約には各属性値の転記なし。全継承/実JWT割当の確認へ拡張しない |
| A15 | 手動実施済み | pgcrypto 1.3、配置extensions、所有者postgres。digestの個別overload/所属の詳細は要約から補完しない |
| A16 | 手動実施済み | 対象表の非内部トリガー・ルール0件との実測要約 |
| A17 | 手動実施済み | postgres/supabase_adminがpublicに今後作成する表へのanon/authenticatedの広範な権限、シーケンスSELECT/UPDATE/USAGE、関数EXECUTEのdefault ACLあり。既存5表・8RPCの制限済みACLとは別の将来リスク |

### 継続事項（未解決）

| ID | 項目 | 現在の扱い | 次に必要な判断・検証 |
|---|---|---|---|
| R01 | A17のdefault privileges | 既存ACL一致とは別の将来公開リスク | 作成ロール/schema/global/object種別/grantee/権限を確認し、新規作成時の権限レビューを計画。権限修正は別承認 |
| R02 | 補助4関数の公開EXECUTE | 正式SQLは8RPCと同じREVOKEを行っていない。公開維持/制限は未決 | 呼出し経路・必要性・制限時の影響を先生/オーナーがレビュー |
| R03 | RPC本文 | 未検証 | 全文取得/非公開レビューを別承認。fingerprintだけで一致判定しない |
| R04 | RLS/権限の実動作 | 今回未検証 | 合成A/Bでの実HTTP試験を別承認 |
| R05 | PostgREST版・実HTTP・adapter整合 | 未検証 | 版/出所と500/P0002等の実応答を別承認で確認 |
| R06 | 原本と実施条件の追跡 | 先生との会話で結果提示済み。本記録は先生レビューの実測要約に基づく | 実施日時・A14属性値等、要約にない細部は必要時にサニタイズした補足で確認。生結果/秘密情報はPRへ掲載しない |

手動監査済みと全機能の合格を区別する。DB接続・SQL実行・権限変更・公開をこの記録から追加承認しない。

R02の依存関係・主体別UNKNOWN・A/B/C比較・変更/復旧/試験計画は[補助EXECUTE制限設計](HELPER-EXECUTE-DESIGN.md)を参照。設計段階であり、R02は未解決のまま保持する。

## 7. RPC本文監査チェックリスト（準備時点：全項目未確認）

第7・8章は準備時点の状態を保持する。後続のオーナー手動実施報告とB項目別の進捗は第9章を参照する。

取得・比較・情報保護は[手順第11章](DEV-DB-AUDIT.md)に従う。B番号はA01〜A17のカタログ監査と区別する。各行の「未確認」は実測本文未取得を意味し、正式原本から期待値を整理しただけでは合格にしない。記録時は判定、完全な署名、取得日時、非公開原本識別子、比較元Git SHA/関数、差分要約、影響、判断者・次の承認を残す。

| ID/対象 | 本文で照合する正式契約・安全観点 | 判定 |
|---|---|---|
| B01 共通境界 | 第2章の署名・戻り値・SECURITY DEFINER・空search_path・owner/ACLと対応付け。全表アクセスのschema修飾、依存関数、動的SQL/未知の副作用の有無。ownerによるRLS回避を前提に本文の所有者制限を確認 | 未確認 |
| B02 認証・所有者 | loadは未認証時null。他7RPCはauth.uid()がNULLなら42501。ユーザー由来のIDだけを信用せず、各取得/更新/削除/関連/台帳に現在のuser_id条件がある | 未確認 |
| B03 競合・原子性 | 6変更RPCが同じhashtextextended(v_uid::text,911)によるpg_advisory_xact_lockを取得。save/stateのFOR UPDATEとrevision照合、その他の条件付きDML/集合検証を原本の順序で確認。複数変更は同一transaction、失敗例外が部分変更を確定させる形で握り潰されない。実競合/ロールバックは別試験 | 未確認 |
| B04 memo_save | 引数NULL/配列次元/重複/期待revision範囲、タグ所有者・本文検証。正規化済みタイトル/本文を暗黙補正しない。作成時だけregistry登録し再利用をPT409で拒否。更新は所有者・revision一致かつゴミ箱外。メモ/関連/台帳を一体更新し、原子的なmemo＋ソート済みtagIdsを返す | 未確認 |
| B05 save要求台帳 | サーバー構築のpayload（title/body/ソート済みtagIds/expectedRevision）とuser/request/operation/memoをUTF8→extensions.digest SHA256へ渡す。既存要求の対象/操作/ハッシュ不一致を22023で拒否。一致時は履歴結果、削除済みならreceipt。新規検証/変更との順序も原本どおりで、削除後のタグ存在検証による履歴返却妨害がない | 未確認 |
| B06 memo_load_snapshot | 単一SQL/STABLEでmemos/tags/memoTagsの3集合すべてを所有者で絞る。空集合は配列、未認証null。ゴミ箱の関連を落とさず、正式原本の配列順序と行フィールドを維持。後続の別SELECTによる混在を作らない | 未確認 |
| B07 memo_change_state | actionをpin/unpin/trash/restoreに限定。requestIdをaction・対象・期待revisionへ結び付け、混用拒否。履歴返却と現行更新を区別。ゴミ箱状態/revisionを検証し、本文/タグを変更しない。trash/restoreではpinned_at保持。更新日時/revision/last_request_idと台帳を一体更新 | 未確認 |
| B08 memo_delete_permanently | 所有者・ゴミ箱内・期待revisionで対象を限定。該当なしはPT409。関連はFK CASCADEとの対応を確認。registryと要求行は保持し、当該メモの全要求resultをNULL、deleted_redacted=trueにする。他ユーザー/他メモの台帳やタグを変更しない | 未確認 |
| B09 memo_empty_trash | NULL/次元/長さ/NULL要素/revision範囲を検証。確認IDの重複拒否、現行ゴミ箱全件数と全ID/revisionの一致をロック内で照合。一部一致で削除しない。対象の全台帳結果を秘匿化してから削除、registry/タグ保持、戻り値件数。0件も原本どおりに扱う | 未確認 |
| B10 memo_resolve_request | 読取専用で、saveと同一の全凍結要求からハッシュ再計算。所有者/対象/operation/hashを照合。不在nullを未実行証明にしない。saved/resultと削除済みreceiptを区別し、現在のタグ存在検証・台帳書換え・自動再送をしない | 未確認 |
| B11 memo_save_tag | 名前検証はmemo_valid_textとASCII限定tagKey一意indexの契約に従う。作成と改名をexpectedRevisionで区別。所有者/revision一致の改名だけ許可し、競合PT409。改名で関連メモのrevisionを変更しない | 未確認 |
| B12 memo_delete_tag | 共通ロック下で所有者を限定し、関連メモ全件（ゴミ箱内含む）のrevision+1/updated_at更新/last_request_id=NULL。その後タグを期待revisionで削除し、不一致はPT409を伝播して先行変更もtransaction全体で取消す構造。関連除去はFK依存。上限違反等を握り潰さない | 未確認 |
| B13 エラーと結果型 | Review8パッチの6関数8箇所の業務競合がPT409で正式メッセージを保持。save/stateのmemo not foundはP0002、stateのpreviously applied, memo deletedは別のP0002履歴。42501/22023/23505/制約例外を根拠なく変換しない。500/P0002等のHTTP分類は本文だけでは実証不能 | 未確認 |
| B14 依存先と権限境界 | 補助4関数のUnicode空白/コードポイント/禁止文字/ASCIIキー、pgcryptoのschemaと呼出し型、FK/CHECK/indexとの対応を確認。依存先本文が未取得ならその範囲を未確認。補助EXECUTE・A17は別判断、本文一致を権限安全の証明にしない | 未確認 |

### 提出前・次工程ゲート

- [ ] 対象8RPCの全署名/overloadとA06の存在確認を突合し、欠落・切詰めを一致扱いしていない。
- [ ] 原本・パッチ・統合仕様・型・アダプター間に矛盾があれば、推測で優先順位や仕様を変更せずまとめて報告した。
- [ ] 公開要約に関数本文・断片・生diff・秘密情報・実ユーザーデータが含まれないことを人が確認した。
- [ ] 不一致の修正、追加取得、Auth/RLS/HTTP・同時実行試験は別承認とし、監査の完了と実動作の合格を区別した。
- [ ] 保管期限・閲覧者・保全/破棄の状況と未確認項目を引き継いだ。今回はすべて未取得・未実行であり、チェック済みにしない。

## 8. 完全署名限定取得の実行確認（準備時点：全項目未実施）

[手順第12章](DEV-DB-AUDIT.md)とrpc-definitions-exact.sqlに対応する。以下は将来の承認後に使う確認欄であり、今回の静的点検で実施済みにしない。

- [ ] 開発プロジェクト/取得8署名/実行者/既存権限/期限/保管先/閲覧者/破棄担当を承認した。
- [ ] 同一専用transactionのREAD ONLYとtimeoutを取得前に確認した。セッション分断・設定不一致・権限不足では停止した。
- [ ] seq1〜8の各1行、署名とOID各8種類、全exact、same_name_count=1、acquisition_allowed=true、本文非NULLを確認した。欠落/重複/別署名/未知overloadは未確認で停止した。
- [ ] actual_arguments/actual_resultとA06を正式署名・引数名/default・戻り値へ照合した。存在だけで本文一致にしなかった。
- [ ] 非公開保存したdefinitionのUTF-8バイト数/MD5を各行照合し、行/セル切詰め・文字化け・改行変換・エスケープの誤比較がないことを確認した。
- [ ] 第7章B項目で原本/パッチと非公開比較し、安全な判定要約だけを公開した。依存先・実動作等の未検証範囲を維持した。
- [ ] 第11章の保持/保全/破棄手順を実施し、未破棄コピーや保持延長を記録した。

記録欄：取得日時 / SQL版・基準SHA / 実行条件確認 / 8行完全性 / 非公開原本識別子 / 判定・未確認理由 / 次の承認。本文や生結果は記入しない。取得後の完全性照合方法も実環境未検証であり、取得SQLの承認と監査合格は別とする。

## 9. 8RPC本文監査の手動報告・静的レビュー記録（2026-11-06記録）

[手順第13章](DEV-DB-AUDIT.md)のオーナー報告に基づく。第7章の確認粒度と第8章の準備履歴は保持する。本章はAIによる非公開原本の確認・DB独立検証ではなく、本文・ハッシュ値・生データは掲載しない。記録日は実施日時を意味しない。

### 取得・比較結果

- dev-sandbox、読取専用transaction、事前確定8RPCのみ取得。8/8がtarget_status=exact。
- CSVのUTF-8バイト数・MD5整合性検証は全件PASS。非公開ローカル保存済みとの報告。その他の実行条件や保管/破棄状況は推測しない。
- 正式SQLとの比較は8/8、本文完全一致0、改行正規化後一致8、改行以外の差分0。文字列比較であり実動作・安全性の証明ではない。
- 関数属性の簡易比較は6RPC MATCH。memo_change_state（public.memos / memos）、memo_save_tag（public.tags / tags）はREVIEW。実DB型OID同一性は未確認で、PASSへ変更しない。

### B項目別の静的確認範囲と残課題

全行「静的レビュー済み（報告範囲）」であり、最終PASSではない。第7章の詳細条件すべてが実測検証済みという意味ではない。

| ID | 静的レビュー済みの範囲（オーナー報告） | 未検証・継続確認 |
|---|---|---|
| B01 | SECURITY DEFINER・search_path等の設計 | 実権限・依存先、戻り値型2件の実DB型OIDは継続確認 |
| B02 | 認証・所有者制限の主要条件 | 実機の認証・所有者境界、RLS実動作 |
| B03 | 共通ロック・revision検証 | 実競合・並行実行・ロールバック |
| B04 | メモ保存の入力・タグ・revision検証 | 実入力拒否・保存・失敗時不変の実動作 |
| B05 | 要求台帳のハッシュ照合・履歴返却 | 実要求の照合・履歴保持・再送時の実挙動 |
| B06 | 所有者別の単一SQLスナップショット | 実ユーザー隔離・同時取得の整合性 |
| B07 | 状態変更の操作制限・revision検証 | 実遷移・競合・戻り値型OID（REVIEW） |
| B08 | 完全削除の所有者制限・台帳秘匿化 | 実削除・関連除去・台帳/registry保持・原子性 |
| B09 | 一括削除の件数・ID・revision照合 | 実集合競合・部分変更の防止・ロールバック |
| B10 | 要求結果照会の読取専用構造 | 実照合応答、null/receiptの実HTTP確認 |
| B11 | タグ保存の入力・所有者・revision検証 | 実保存・一意性/競合・戻り値型OID（REVIEW） |
| B12 | タグ削除時の関連メモrevision更新 | 実関連除去・上限/競合時の全体取消し |
| B13 | 主要エラーコード | 実エラー応答・HTTPマッピング・PostgREST版 |
| B14 | 補助関数の正式原本 | 実DB依存先・権限、補助4関数のPUBLIC EXECUTEの必要性/安全性 |

### 継続課題と記録の扱い

第6章R03（本文未検証）は当時の履歴として残し、今回の本文比較・静的レビュー報告による進捗は本章に追記した。実動作まで検証完了したとは扱わない。R01のA17、R02の補助EXECUTE、R04のRLS/権限実動作、R05のPostgREST/HTTPは未解決のまま維持する。戻り値型2件の実DB型OID確認を追加の継続課題とする。

第7・8章の未チェック欄を本報告だけで一括チェックしない。実施日時、比較スクリプト/改行正規化の詳細、timeout等の不足情報は必要時に安全な要約で補足し、非公開原本へのアクセスや追加DB照会を今回の記録作業から許可しない。

## 10. A17対応保留と将来の確認ゲート（2026-11-06決定）

R01/A17は未解決のまま保持する。現時点で新規テーブル・RPCの追加予定はなく、権限設定変更は当面行わない。[監査手順第14章](DEV-DB-AUDIT.md)にオーナー判断を記録した。第6章の監査履歴は変更せず、保留をPASSに置き換えない。

- [ ] 将来のDBオブジェクト追加を計画する際、作成前に対象のデフォルト権限を確認する。
- [ ] 作成後に実効権限・RLS・公開範囲を確認し、結果と未解決事項を記録する。
- [ ] 本番公開前に権限レビューを行い、オーナーが判断する。

上記は将来の必須確認事項で、今回は未実施。確認のためのDB接続・SQL実行・変更操作は別途承認が必要。既存ACLと将来のdefault ACLリスク、補助4関数EXECUTE等の別課題を混同しない。
