-- v1.1.0 本番適用後の最小カタログ確認 / REVIEW ONLY / 未実行
-- 別途承認後、同じ本番projectで実行。全行期待どおりであることをHumanが確認する。
-- これは構造/権限の確認であり、実Auth/RLS分離の新しい実測証明ではない。
-- ユーザー行、Auth情報、関数本文、生ACL、秘密値は取得しない。RPC/独自helperは呼ばない。
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
SELECT pg_catalog.current_setting('server_version_num') AS server_version_num,
       pg_catalog.current_setting('server_encoding') AS server_encoding,
       pg_catalog.current_setting('transaction_read_only') AS transaction_read_only;
SELECT n.nspname='extensions' AS pgcrypto_in_expected_schema,
       pg_catalog.to_regprocedure('extensions.digest(bytea,text)') IS NOT NULL AS digest_exists
FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto';
WITH expected(name) AS (SELECT unnest(ARRAY['memos','memo_id_registry','memo_requests','tags','memo_tags']))
SELECT e.name, c.oid IS NOT NULL AS present, c.relrowsecurity AS rls_enabled,
       pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_select,
       pg_catalog.has_table_privilege('anon',c.oid,'SELECT') AS anon_select,
       pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS authenticated_direct_mutation,
       pg_catalog.has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS anon_direct_mutation
FROM expected e LEFT JOIN pg_catalog.pg_namespace n ON n.nspname='public'
LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=e.name ORDER BY e.name;
WITH expected(kind,signature) AS (VALUES
 ('rpc','public.memo_load_snapshot()'),
 ('rpc','public.memo_save(uuid,text,text,uuid[],bigint,uuid)'),
 ('rpc','public.memo_resolve_request(uuid,uuid,text,text,uuid[],bigint)'),
 ('rpc','public.memo_change_state(uuid,bigint,uuid,text)'),
 ('rpc','public.memo_delete_permanently(uuid,bigint)'),
 ('rpc','public.memo_empty_trash(uuid[],bigint[])'),
 ('rpc','public.memo_save_tag(uuid,text,bigint)'),
 ('rpc','public.memo_delete_tag(uuid,bigint)'),
 ('helper','public.memo_edge_spaces()'),
 ('helper','public.memo_trim_edges(text)'),
 ('helper','public.memo_valid_text(text,text)'),
 ('helper','public.memo_tag_key(text)')
)
SELECT e.kind,e.signature,p.oid IS NOT NULL AS present,p.prosecdef AS security_definer,
       p.proconfig @> ARRAY['search_path=""'] AS empty_search_path,
       p.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user) AS owned_by_execution_role,
       pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
       pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
       EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
           WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
FROM expected e LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(e.signature) ORDER BY e.kind,e.signature;
-- 所有者条件の式だけを確認。関数本文・ユーザーデータは含まない。
SELECT c.relname,p.polname,p.polcmd,
       p.polroles=ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='authenticated')] AS authenticated_only,
       pg_catalog.pg_get_expr(p.polqual,p.polrelid) AS read_owner_condition
FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname=ANY(ARRAY['memos','memo_id_registry','memo_requests','tags','memo_tags']) ORDER BY c.relname,p.polname;
COMMIT;
-- 期待値: 5表RLS=true。authenticated SELECTはmemos/tags/memo_tagsのみtrue。
-- 直接mutation/anon SELECTはすべてfalse。12関数が存在、8 RPCのみDEFINER/authenticated EXECUTE=true。
-- 全関数empty_search_path=true、anon/PUBLIC EXECUTE=false。helperのauthenticated EXECUTE=false。
-- read policyは3件・authenticatedのみ・auth.uid()による所有者条件。欠落/NULLはPASSにしない。
-- owned_by_execution_roleは適用と同じ実行主体でtrueを期待。違う主体では勝手に失敗/変更と断定しない。
