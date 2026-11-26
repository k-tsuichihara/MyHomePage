-- v1.1.0 本番適用後・単一結果表版 / REVIEW ONLY / この版は未実行
-- 別途承認後、適用と同じproject/実行主体で全体実行。SQL自体はprojectを証明しない。
-- 24行を期待（summary 1 + 個別23）。全passed=trueかつsummaryの件数一致を確認する。
-- 個別の実測falseが期待される権限（anon/直接DML/helper等）は、そのfalse一致を検査する。
-- 欠落/NULL/判定falseはPASSにしない。detailsの所有者条件もHumanが確認する。
-- ユーザー行、Auth情報、関数本文、生ACL、秘密値は取得しない。RPC/独自helperは呼ばない。
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

WITH
server_check AS (
 SELECT current_user AS execution_role,
        pg_catalog.current_setting('server_version_num') AS server_version_num,
        pg_catalog.current_setting('server_encoding') AS server_encoding,
        pg_catalog.current_setting('transaction_read_only') AS transaction_read_only
),
crypto_check AS (
 SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace
          WHERE e.extname='pgcrypto' AND n.nspname='extensions') AS pgcrypto_in_expected_schema,
        pg_catalog.to_regprocedure('extensions.digest(bytea,text)') IS NOT NULL AS digest_exists
),
expected_tables(name) AS (SELECT unnest(ARRAY['memos','memo_id_registry','memo_requests','tags','memo_tags'])),
table_checks AS (
SELECT e.name, c.oid IS NOT NULL AS present, c.relrowsecurity AS rls_enabled,
       pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_select,
       pg_catalog.has_table_privilege('anon',c.oid,'SELECT') AS anon_select,
       pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS authenticated_direct_mutation,
       pg_catalog.has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS anon_direct_mutation
FROM expected_tables e LEFT JOIN pg_catalog.pg_namespace n ON n.nspname='public'
LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=e.name
),
expected_functions(kind,signature) AS (VALUES
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
),
function_checks AS (
SELECT e.kind,e.signature,p.oid IS NOT NULL AS present,p.prosecdef AS security_definer,
       p.proconfig @> ARRAY['search_path=""'] AS empty_search_path,
       p.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user) AS owned_by_execution_role,
       pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
       pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
       EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
           WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
FROM expected_functions e LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(e.signature)
),
expected_policies(table_name,policy_name) AS (VALUES
 ('memos','memos_read'),('tags','tags_read'),('memo_tags','memo_tags_read')
),
policy_checks AS (
 SELECT e.table_name,e.policy_name,p.oid IS NOT NULL AS present,
        p.polcmd='r' AS select_only,
        p.polroles=ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='authenticated')] AS authenticated_only,
        pg_catalog.pg_get_expr(p.polqual,p.polrelid) AS read_owner_condition,
        -- 元schemaの USING (user_id = (SELECT auth.uid())) を空白だけ正規化して照合する。
        -- 異なる表示/条件ならfalseで停止し、緩い部分一致で成功認定しない。
        pg_catalog.regexp_replace(pg_catalog.pg_get_expr(p.polqual,p.polrelid),'[[:space:]]','','g')
          = '(user_id=(SELECTauth.uid()ASuid))' AS owner_condition_matches
 FROM expected_policies e
 LEFT JOIN pg_catalog.pg_namespace n ON n.nspname='public'
 LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=e.table_name
 LEFT JOIN pg_catalog.pg_policy p ON p.polrelid=c.oid AND p.polname=e.policy_name
),
policy_count AS (
 SELECT count(*) AS actual_count
 FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname=ANY(ARRAY['memos','memo_id_registry','memo_requests','tags','memo_tags'])
),
checks AS (
 SELECT 10::bigint AS check_order,'server'::text AS category,'environment'::text AS object_name,
        coalesce(s.server_version_num::integer / 10000=17 AND s.server_encoding='UTF8'
          AND s.transaction_read_only='on',false) AS passed,
        pg_catalog.to_jsonb(s) AS details FROM server_check s
 UNION ALL
 SELECT 20,'pgcrypto','extensions.digest(bytea,text)',
        coalesce(c.pgcrypto_in_expected_schema AND c.digest_exists,false),pg_catalog.to_jsonb(c) FROM crypto_check c
 UNION ALL
 SELECT 100+row_number() OVER (ORDER BY t.name),'table','public.'||t.name,
        coalesce(t.present AND t.rls_enabled
          AND t.authenticated_select=(t.name IN ('memos','tags','memo_tags'))
          AND NOT t.anon_select AND NOT t.authenticated_direct_mutation AND NOT t.anon_direct_mutation,false),
        pg_catalog.to_jsonb(t) FROM table_checks t
 UNION ALL
 SELECT 200+row_number() OVER (ORDER BY f.kind,f.signature),f.kind,f.signature,
        coalesce(f.present AND f.security_definer=(f.kind='rpc') AND f.empty_search_path
          AND f.owned_by_execution_role AND f.authenticated_execute=(f.kind='rpc')
          AND NOT f.anon_execute AND NOT f.public_execute,false),
        pg_catalog.to_jsonb(f) FROM function_checks f
 UNION ALL
 SELECT 300+row_number() OVER (ORDER BY p.table_name,p.policy_name),'policy','public.'||p.table_name||'.'||p.policy_name,
        coalesce(p.present AND p.select_only AND p.authenticated_only AND p.owner_condition_matches,false),
        pg_catalog.to_jsonb(p) FROM policy_checks p
 UNION ALL
 SELECT 400,'policy_count','all_memo_tables',p.actual_count=3,
        pg_catalog.jsonb_build_object('actual',p.actual_count,'expected',3) FROM policy_count p
),
report AS (
 SELECT 0::bigint AS check_order,'summary'::text AS category,'overall'::text AS object_name,
        count(*)=23 AND coalesce(bool_and(passed),false) AS passed,
        pg_catalog.jsonb_build_object('checked_rows',count(*),'expected_rows',23,
          'passed_rows',count(*) FILTER (WHERE passed),'failed_rows',count(*) FILTER (WHERE passed IS NOT TRUE)) AS details
 FROM checks
 UNION ALL SELECT check_order,category,object_name,passed,details FROM checks
)
SELECT check_order,category,object_name,passed,details FROM report ORDER BY check_order;
COMMIT;

-- 期待値: summary + server + pgcrypto + table5 + rpc8/helper4 + policy3 + policy_count = 24行。
-- 全passed=true、summary checked_rows=23/failed_rows=0。
-- 表: 5表present/RLS=true。authenticated SELECTはmemos/tags/memo_tagsのみtrue。
-- 直接mutation/anon SELECTはすべてfalse。
-- 関数: 12関数present/empty_search_path/owned_by_execution_role=true。
-- 8 RPCだけDEFINER/authenticated EXECUTE=true。anon/PUBLIC EXECUTEは全てfalse、helperもclient EXECUTE=false。
-- policy: 3件だけ、SELECT/authenticatedのみ、user_id = (SELECT auth.uid())。
-- detailsがNULL/欠落/判定falseなら停止。所有者照合がfalseでも勝手なowner変更は行わない。
-- 別実行主体では所有者照合falseになり得る。適用と同じ主体を使い、結果を推測で成功認定しない。
-- SQL Editorの成功表示だけで本番適用/認証/データ分離の全体PASSとはしない。
