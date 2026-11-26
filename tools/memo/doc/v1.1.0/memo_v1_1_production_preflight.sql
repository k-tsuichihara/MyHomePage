-- v1.1.0 本番適用前・最小カタログ確認 / REVIEW ONLY / 未実行
-- 対象k-life-log/Project RefとSQL Editor実行roleをHumanが照合し、読取実行の別承認後だけ使用。
-- SQLだけではprojectを証明しない。名前一致/DB versionをproject識別の代わりにしない。
-- production_apply.sqlのpreflightから対象名・判定を再利用。データ行/関数本文/ACL原本/秘密値は取得しない。
-- ユーザー定義関数/RPCを呼ばない。DO/DDL/DML/GRANTなし。エラーなら停止、補完・再試行なし。
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

-- 単一SELECTで必ず5行を返す。check_no順に全行を確認する。
-- detailsは従来の個別結果、collision_countはcheck_no=5で0を期待する。
WITH
check1 AS (
SELECT current_user AS execution_role,
       pg_catalog.current_setting('server_version') AS server_version,
       pg_catalog.current_setting('server_version_num')::integer / 10000 = 17 AS pg17,
       pg_catalog.current_setting('server_encoding') AS server_encoding,
       pg_catalog.current_setting('server_encoding') = 'UTF8' AS utf8,
       pg_catalog.current_setting('transaction_read_only') = 'on' AS read_only
),
check2 AS (
SELECT pg_catalog.to_regclass('auth.users') IS NOT NULL AS auth_users_exists,
       pg_catalog.to_regprocedure('auth.uid()') IS NOT NULL AS auth_uid_exists,
       EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='anon') AS anon_exists,
       EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated') AS authenticated_exists
),
crypto AS (
 SELECT e.oid,e.extnamespace FROM pg_catalog.pg_extension e WHERE e.extname='pgcrypto'
), digest AS (SELECT pg_catalog.to_regprocedure('extensions.digest(bytea,text)')::oid AS oid),
check3 AS (
SELECT EXISTS (SELECT 1 FROM crypto) AS pgcrypto_exists,
       EXISTS (SELECT 1 FROM crypto e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace
          WHERE n.nspname='extensions') AS pgcrypto_in_extensions,
       (SELECT oid IS NOT NULL FROM digest) AS digest_exists,
       EXISTS (SELECT 1 FROM pg_catalog.pg_depend d,crypto e,digest f
          WHERE d.classid='pg_catalog.pg_proc'::regclass AND d.objid=f.oid
            AND d.refclassid='pg_catalog.pg_extension'::regclass AND d.refobjid=e.oid AND d.deptype='e') AS digest_is_pgcrypto_member
),
check4 AS (
SELECT coalesce(pg_catalog.has_schema_privilege(current_user,pg_catalog.to_regnamespace('public')::oid,'USAGE'),false) AS public_usage,
       coalesce(pg_catalog.has_schema_privilege(current_user,pg_catalog.to_regnamespace('public')::oid,'CREATE'),false) AS public_create,
       coalesce(pg_catalog.has_schema_privilege(current_user,pg_catalog.to_regnamespace('extensions')::oid,'USAGE'),false) AS extensions_usage,
       coalesce(pg_catalog.has_function_privilege(current_user,pg_catalog.to_regprocedure('extensions.digest(bytea,text)')::oid,'EXECUTE'),false) AS digest_execute,
       coalesce(pg_catalog.has_schema_privilege(current_user,pg_catalog.to_regnamespace('auth')::oid,'USAGE'),false) AS auth_usage,
       coalesce(pg_catalog.has_function_privilege(current_user,pg_catalog.to_regprocedure('auth.uid()')::oid,'EXECUTE'),false) AS auth_uid_execute,
       coalesce(pg_catalog.has_table_privilege(current_user,pg_catalog.to_regclass('auth.users')::oid,'REFERENCES'),false) AS auth_users_references
),
target(name) AS (SELECT unnest(ARRAY['memos','memo_id_registry','memo_requests','tags','memo_tags','tags_name_per_user','memos_owner_updated','memos_owner_trash','memo_tags_owner_tag','memo_edge_spaces','memo_trim_edges','memo_valid_text','memo_tag_key','memo_load_snapshot','memo_save','memo_resolve_request','memo_change_state','memo_delete_permanently','memo_empty_trash','memo_save_tag','memo_delete_tag'])),
collisions AS (
 SELECT 'relation' AS object_kind,c.relname AS object_name
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN target t ON t.name=c.relname
 WHERE n.nspname='public'
 UNION ALL
 SELECT 'function',p.proname
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN target t ON t.name=p.proname
 WHERE n.nspname='public'
 UNION ALL
 SELECT 'type',y.typname
 FROM pg_catalog.pg_type y JOIN pg_catalog.pg_namespace n ON n.oid=y.typnamespace JOIN target t ON t.name=y.typname
 WHERE n.nspname='public'
),
results AS (
 SELECT 1 AS check_no, 'server'::text AS check_name,
        coalesce(c.pg17 AND c.utf8 AND c.read_only,false) AS passed,
        NULL::bigint AS collision_count, pg_catalog.to_jsonb(c) AS details FROM check1 c
 UNION ALL
 SELECT 2, 'supabase_prerequisites',
        coalesce(c.auth_users_exists AND c.auth_uid_exists AND c.anon_exists AND c.authenticated_exists,false),
        NULL::bigint, pg_catalog.to_jsonb(c) FROM check2 c
 UNION ALL
 SELECT 3, 'pgcrypto',
        coalesce(c.pgcrypto_exists AND c.pgcrypto_in_extensions AND c.digest_exists AND c.digest_is_pgcrypto_member,false),
        NULL::bigint, pg_catalog.to_jsonb(c) FROM check3 c
 UNION ALL
 SELECT 4, 'execution_privileges',
        coalesce(c.public_usage AND c.public_create AND c.extensions_usage AND c.digest_execute
          AND c.auth_usage AND c.auth_uid_execute AND c.auth_users_references,false),
        NULL::bigint, pg_catalog.to_jsonb(c) FROM check4 c
 UNION ALL
 SELECT 5, 'object_collisions', count(*)=0, count(*),
        pg_catalog.jsonb_build_object('objects',coalesce(
          pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('object_kind',object_kind,'object_name',object_name)
            ORDER BY object_kind,object_name),'[]'::jsonb)) FROM collisions
)
SELECT check_no,check_name,passed,collision_count,details FROM results ORDER BY check_no;
COMMIT;

-- 判定: 5行すべてpassed=true、check_no=5のcollision_count=0 / details.objects=[]。
-- check_no=1のexecution_roleは予定主体とHumanが照合。衝突時はdetails.objectsの対象名/種別を確認し停止。
-- 結果欠落/NULL/権限エラー/想定外は停止。falseをtrueへ読み替えない。
-- この確認後の他DDL/権限変更は未保証。適用SQL側の同じガードは残し、同時変更のない時間枠で別途承認する。
-- S04の新関数owner権限・client継承権限等は適用transaction内の既存検査で確認し、事前結果だけで全適用成功を保証しない。
