# 開発DB定義監査：差分記録チェックリスト

[監査手順](DEV-DB-AUDIT.md)に従い、実行承認後に記入する。**現在は全項目未確認。SQL案は未実行。** 正式Review8との比較とセキュリティ上の判断を分け、想定外の差分を自動修正しない。

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

## 5. 差分記録テンプレート

| 項目/A番号 | 正式根拠 | 判定 | サニタイズ差分要約 | 影響・停止要否 | 次の判断/承認 |
|---|---|---|---|---|---|
| 実行前プロジェクト確認 | オーナー確認 | 未確認 | 未取得 | 接続前ゲート | 未承認 |
| A01〜17 | Review8/本手順 | 未確認 | 未実行 | 各項目確認待ち | 未承認 |
| 任意関数全文 | Review8 SQL/6関数パッチ | 未確認 | 未取得 | 本体一致を未判定 | 別承認 |
| PostgREST版 | オーナーの運用情報 | 未確認 | 未取得 | HTTP分類を未実証 | 別承認 |

一致でも実接続試験・本番適用・公開の承認とはしない。差分の修正案は別作業として先生/オーナーが判断する。
