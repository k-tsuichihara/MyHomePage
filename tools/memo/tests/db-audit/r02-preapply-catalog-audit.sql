-- R02適用前カタログ監査案・未実行。PostgreSQL 17を前提とする。
-- SELECTのみ。アプリ関数/RPCを呼ばず、本文・パスワード・ユーザーデータを取得しない。
-- 生ACL・OID・ロール名の出力は非公開。R02-PREAPPLY-AUDIT.mdの別承認手順に従う。
-- T00: 同一transactionの設定確認。プロジェクト識別の証明ではない。
SELECT current_user AS execution_role,
       pg_catalog.current_setting('server_version') AS server_version,
       pg_catalog.current_setting('server_encoding') AS server_encoding,
       pg_catalog.current_setting('transaction_read_only') AS read_only,
       pg_catalog.current_setting('statement_timeout') AS statement_timeout,
       pg_catalog.current_setting('lock_timeout') AS lock_timeout;

-- T01: 正確な12署名の存在/所有者。全overload本文や別スキーマを取得しない。
WITH expected(kind, signature) AS (VALUES
 ('rpc','public.memo_load_snapshot()'),
 ('rpc','public.memo_save(pg_catalog.uuid,pg_catalog.text,pg_catalog.text,pg_catalog.uuid[],pg_catalog.int8,pg_catalog.uuid)'),
 ('rpc','public.memo_resolve_request(pg_catalog.uuid,pg_catalog.uuid,pg_catalog.text,pg_catalog.text,pg_catalog.uuid[],pg_catalog.int8)'),
 ('rpc','public.memo_change_state(pg_catalog.uuid,pg_catalog.int8,pg_catalog.uuid,pg_catalog.text)'),
 ('rpc','public.memo_delete_permanently(pg_catalog.uuid,pg_catalog.int8)'),
 ('rpc','public.memo_empty_trash(pg_catalog.uuid[],pg_catalog.int8[])'),
 ('rpc','public.memo_save_tag(pg_catalog.uuid,pg_catalog.text,pg_catalog.int8)'),
 ('rpc','public.memo_delete_tag(pg_catalog.uuid,pg_catalog.int8)'),
 ('helper','public.memo_edge_spaces()'),
 ('helper','public.memo_trim_edges(pg_catalog.text)'),
 ('helper','public.memo_valid_text(pg_catalog.text,pg_catalog.text)'),
 ('helper','public.memo_tag_key(pg_catalog.text)')
), functions AS (
 SELECT e.*, p.oid, p.proowner, p.proacl, p.prokind, p.prosecdef, p.provolatile, p.proparallel, p.proleakproof, p.proconfig
 FROM expected e LEFT JOIN pg_catalog.pg_proc p
 ON p.oid=pg_catalog.to_regprocedure(e.signature)::pg_catalog.oid
)
SELECT f.kind, f.signature, f.oid AS function_oid, f.prokind, f.prosecdef,
       f.proowner AS owner_oid, r.rolname AS owner_name,
       f.proacl IS NULL AS acl_is_null,
       (SELECT count(*) FROM pg_catalog.pg_proc other
        JOIN pg_catalog.pg_namespace ns ON ns.oid=other.pronamespace
        WHERE ns.nspname='public' AND other.proname=pg_catalog.split_part(
          pg_catalog.split_part(f.signature,'(',1),'.',2)) AS same_name_count,
       CASE WHEN f.kind='helper' THEN f.provolatile END AS helper_volatility,
       CASE WHEN f.kind='helper' THEN f.proparallel END AS helper_parallel,
       CASE WHEN f.kind='helper' THEN f.proleakproof END AS helper_leakproof,
       CASE WHEN f.kind='helper' AND f.oid IS NOT NULL THEN ARRAY(
         SELECT setting FROM pg_catalog.unnest(f.proconfig) cfg(setting)
         WHERE pg_catalog.split_part(setting,'=',1)='search_path') END AS helper_search_path,
       CASE WHEN f.kind='helper' AND f.oid IS NOT NULL THEN ARRAY(
         SELECT pg_catalog.split_part(setting,'=',1) FROM pg_catalog.unnest(f.proconfig) cfg(setting)
         WHERE pg_catalog.split_part(setting,'=',1)<>'search_path') END AS other_config_names
FROM functions f LEFT JOIN pg_catalog.pg_roles r ON r.oid=f.proowner
ORDER BY f.kind, f.signature;

-- T02: 補助4関数の明示ACLとNULL時の組込既定展開を区別。空ACLも欠落扱いしない。
WITH expected(kind, signature) AS (VALUES
 ('rpc','public.memo_load_snapshot()'),
 ('rpc','public.memo_save(pg_catalog.uuid,pg_catalog.text,pg_catalog.text,pg_catalog.uuid[],pg_catalog.int8,pg_catalog.uuid)'),
 ('rpc','public.memo_resolve_request(pg_catalog.uuid,pg_catalog.uuid,pg_catalog.text,pg_catalog.text,pg_catalog.uuid[],pg_catalog.int8)'),
 ('rpc','public.memo_change_state(pg_catalog.uuid,pg_catalog.int8,pg_catalog.uuid,pg_catalog.text)'),
 ('rpc','public.memo_delete_permanently(pg_catalog.uuid,pg_catalog.int8)'),
 ('rpc','public.memo_empty_trash(pg_catalog.uuid[],pg_catalog.int8[])'),
 ('rpc','public.memo_save_tag(pg_catalog.uuid,pg_catalog.text,pg_catalog.int8)'),
 ('rpc','public.memo_delete_tag(pg_catalog.uuid,pg_catalog.int8)'),
 ('helper','public.memo_edge_spaces()'),
 ('helper','public.memo_trim_edges(pg_catalog.text)'),
 ('helper','public.memo_valid_text(pg_catalog.text,pg_catalog.text)'),
 ('helper','public.memo_tag_key(pg_catalog.text)')
), functions AS (
 SELECT e.*, p.oid, p.proowner, p.proacl, p.prokind, p.prosecdef, p.provolatile, p.proparallel, p.proleakproof, p.proconfig
 FROM expected e LEFT JOIN pg_catalog.pg_proc p
 ON p.oid=pg_catalog.to_regprocedure(e.signature)::pg_catalog.oid
)
SELECT f.signature, f.oid AS function_oid, f.prokind,
       CASE WHEN f.oid IS NULL THEN 'missing'
            WHEN f.prokind IS DISTINCT FROM 'f' THEN 'wrong-kind'
            WHEN f.proacl IS NULL THEN 'builtin-default-expanded'
            WHEN pg_catalog.cardinality(f.proacl)=0 THEN 'explicit-empty'
            ELSE 'explicit-acl' END AS acl_source,
       f.proacl AS stored_acl, f.proacl IS NULL AS stored_acl_is_null,
       pg_catalog.cardinality(f.proacl) AS stored_acl_cardinality,
       CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE gr.rolname::text END AS grantee,
       a.grantee AS grantee_oid, a.grantor AS grantor_oid, ga.rolname AS grantor, a.privilege_type, a.is_grantable
FROM functions f
LEFT JOIN LATERAL pg_catalog.aclexplode(
 CASE WHEN f.oid IS NOT NULL AND f.prokind='f'
 THEN coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner)) END) a ON true
LEFT JOIN pg_catalog.pg_roles gr ON gr.oid=a.grantee
LEFT JOIN pg_catalog.pg_roles ga ON ga.oid=a.grantor
WHERE f.kind='helper' ORDER BY f.signature, a.grantee, a.privilege_type;

-- T03: 関連主体の実効EXECUTEとschema USAGE。PUBLICはロールOIDとして照会しない。
WITH expected(kind, signature) AS (VALUES
 ('rpc','public.memo_load_snapshot()'),
 ('rpc','public.memo_save(pg_catalog.uuid,pg_catalog.text,pg_catalog.text,pg_catalog.uuid[],pg_catalog.int8,pg_catalog.uuid)'),
 ('rpc','public.memo_resolve_request(pg_catalog.uuid,pg_catalog.uuid,pg_catalog.text,pg_catalog.text,pg_catalog.uuid[],pg_catalog.int8)'),
 ('rpc','public.memo_change_state(pg_catalog.uuid,pg_catalog.int8,pg_catalog.uuid,pg_catalog.text)'),
 ('rpc','public.memo_delete_permanently(pg_catalog.uuid,pg_catalog.int8)'),
 ('rpc','public.memo_empty_trash(pg_catalog.uuid[],pg_catalog.int8[])'),
 ('rpc','public.memo_save_tag(pg_catalog.uuid,pg_catalog.text,pg_catalog.int8)'),
 ('rpc','public.memo_delete_tag(pg_catalog.uuid,pg_catalog.int8)'),
 ('helper','public.memo_edge_spaces()'),
 ('helper','public.memo_trim_edges(pg_catalog.text)'),
 ('helper','public.memo_valid_text(pg_catalog.text,pg_catalog.text)'),
 ('helper','public.memo_tag_key(pg_catalog.text)')
), functions AS (
 SELECT e.*, p.oid, p.proowner, p.proacl, p.prokind, p.prosecdef, p.provolatile, p.proparallel, p.proleakproof, p.proconfig
 FROM expected e LEFT JOIN pg_catalog.pg_proc p
 ON p.oid=pg_catalog.to_regprocedure(e.signature)::pg_catalog.oid
), seed_names(name) AS (VALUES ('anon'),('authenticated'),('authenticator')),
seeds AS (
 SELECT s.name AS source, r.oid FROM seed_names s
 LEFT JOIN pg_catalog.pg_roles r ON r.rolname=s.name
 UNION
 SELECT 'function-owner', proowner FROM functions WHERE prokind='f'
 UNION
 SELECT 'table-owner', c.relowner FROM pg_catalog.pg_class c
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN ('memos','tags','memo_tags','memo_id_registry','memo_requests')
), roles AS (SELECT DISTINCT oid FROM seeds WHERE oid IS NOT NULL)
SELECT s.source, r.rolname, s.oid AS role_oid, f.signature, f.oid AS function_oid,
       CASE WHEN s.oid IS NOT NULL AND f.oid IS NOT NULL AND f.prokind='f'
            THEN pg_catalog.has_function_privilege(s.oid,f.oid,'EXECUTE') END AS effective_execute,
       CASE WHEN s.oid IS NOT NULL AND f.oid IS NOT NULL AND f.prokind='f'
            THEN pg_catalog.has_function_privilege(s.oid,f.oid,'EXECUTE WITH GRANT OPTION') END AS effective_grant_option,
       CASE WHEN s.oid IS NOT NULL AND n.oid IS NOT NULL
            THEN pg_catalog.has_schema_privilege(s.oid,n.oid,'USAGE') END AS public_usage
FROM seeds s LEFT JOIN pg_catalog.pg_roles r ON r.oid=s.oid
CROSS JOIN functions f LEFT JOIN pg_catalog.pg_namespace n ON n.nspname='public'
WHERE f.kind='helper' ORDER BY s.source, r.rolname, f.signature;

-- T04: 指定CHECK/一意indexの登録された直接関数依存だけ。式・本文を逆解析しない。
WITH expected(kind, relation, object_name, helper_signature) AS (VALUES
 ('check','public.memos','memo_title_check','public.memo_valid_text(pg_catalog.text,pg_catalog.text)'),
 ('check','public.memos','memo_body_check','public.memo_valid_text(pg_catalog.text,pg_catalog.text)'),
 ('check','public.tags','tag_name_check','public.memo_valid_text(pg_catalog.text,pg_catalog.text)'),
 ('index','public.tags','tags_name_per_user','public.memo_tag_key(pg_catalog.text)')),
objects AS (
 SELECT e.*, c.oid AS table_oid, co.oid AS object_oid,
        'pg_catalog.pg_constraint'::pg_catalog.regclass::pg_catalog.oid AS object_class_oid,
        co.convalidated AS valid, NULL::boolean AS ready, NULL::boolean AS is_unique,
        co.contype::text AS object_kind, c.relkind::text AS table_kind,
        co.conrelid AS actual_table_oid, NULL::pg_catalog.oid AS pg_index_oid
 FROM expected e LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass(e.relation)
 LEFT JOIN pg_catalog.pg_constraint co ON co.conrelid=c.oid AND co.conname=e.object_name
 WHERE e.kind='check'
 UNION ALL
 SELECT e.*, c.oid, ix.oid,
        'pg_catalog.pg_class'::pg_catalog.regclass::pg_catalog.oid,
        i.indisvalid, i.indisready, i.indisunique, ix.relkind::text, c.relkind::text,
        i.indrelid, i.indexrelid
 FROM expected e LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass(e.relation)
 LEFT JOIN pg_catalog.pg_namespace ns ON ns.nspname='public'
 LEFT JOIN pg_catalog.pg_class ix ON ix.relnamespace=ns.oid AND ix.relname=e.object_name
 -- 所属違いをNULLへ隠さず、実際のindrelidを出して総合判定する。
 LEFT JOIN pg_catalog.pg_index i ON i.indexrelid=ix.oid
 WHERE e.kind='index'
), measured AS (
 SELECT o.*, h.oid AS expected_helper_oid, h.prokind AS helper_kind,
        count(*) OVER (PARTITION BY o.kind,o.relation,o.object_name) AS candidate_count,
        dep.function_dependency_count, dep.expected_dependency_count,
        dep.other_dependency_count
 FROM objects o
 LEFT JOIN pg_catalog.pg_proc h
 ON h.oid=pg_catalog.to_regprocedure(o.helper_signature)::pg_catalog.oid
 LEFT JOIN LATERAL (
   SELECT count(*) AS function_dependency_count,
          count(*) FILTER (WHERE d.refobjid=h.oid) AS expected_dependency_count,
          count(*) FILTER (WHERE d.refobjid IS DISTINCT FROM h.oid) AS other_dependency_count
   FROM pg_catalog.pg_depend d
   WHERE d.classid=o.object_class_oid AND d.objid=o.object_oid
     AND d.refclassid='pg_catalog.pg_proc'::pg_catalog.regclass
     AND d.objsubid=0
 ) dep ON true
)
SELECT m.kind, m.relation, m.object_name, m.table_oid, m.table_kind,
       m.object_oid, m.object_kind, m.actual_table_oid, m.pg_index_oid,
       m.candidate_count, m.valid, m.ready, m.is_unique,
       m.helper_signature, m.expected_helper_oid, m.helper_kind,
       m.function_dependency_count, m.expected_dependency_count, m.other_dependency_count,
       CASE
        WHEN m.table_oid IS NULL OR m.object_oid IS NULL OR m.expected_helper_oid IS NULL THEN 'UNKNOWN'
        WHEN m.candidate_count<>1 OR m.table_kind IS DISTINCT FROM 'r'
             OR m.helper_kind IS DISTINCT FROM 'f' THEN 'REVIEW'
        WHEN m.kind='check' AND m.object_kind IS DISTINCT FROM 'c' THEN 'REVIEW'
        WHEN m.kind='index' AND m.object_kind IS DISTINCT FROM 'i' THEN 'REVIEW'
        WHEN m.kind='index' AND m.pg_index_oid IS NULL THEN 'UNKNOWN'
        WHEN m.actual_table_oid IS DISTINCT FROM m.table_oid THEN 'REVIEW'
        WHEN m.valid IS DISTINCT FROM true THEN 'REVIEW'
        WHEN m.kind='index' AND (m.pg_index_oid IS DISTINCT FROM m.object_oid
             OR m.ready IS DISTINCT FROM true OR m.is_unique IS DISTINCT FROM true) THEN 'REVIEW'
        WHEN m.function_dependency_count=0 THEN 'UNKNOWN'
        WHEN m.function_dependency_count<>1 OR m.expected_dependency_count<>1
             OR m.other_dependency_count<>0 THEN 'REVIEW'
        ELSE 'CATALOG-MATCH'
       END AS overall_result
FROM measured m ORDER BY m.kind,m.object_name,m.object_oid;

-- T05: 関連主体から上位への全到達ロールと辺。UNIONで循環/複数経路の再訪を抑制。
-- pg_rolesの属性だけを選択。pg_authid/パスワード/全ロールの無制限出力は禁止。
WITH RECURSIVE expected(kind, signature) AS (VALUES
 ('rpc','public.memo_load_snapshot()'),
 ('rpc','public.memo_save(pg_catalog.uuid,pg_catalog.text,pg_catalog.text,pg_catalog.uuid[],pg_catalog.int8,pg_catalog.uuid)'),
 ('rpc','public.memo_resolve_request(pg_catalog.uuid,pg_catalog.uuid,pg_catalog.text,pg_catalog.text,pg_catalog.uuid[],pg_catalog.int8)'),
 ('rpc','public.memo_change_state(pg_catalog.uuid,pg_catalog.int8,pg_catalog.uuid,pg_catalog.text)'),
 ('rpc','public.memo_delete_permanently(pg_catalog.uuid,pg_catalog.int8)'),
 ('rpc','public.memo_empty_trash(pg_catalog.uuid[],pg_catalog.int8[])'),
 ('rpc','public.memo_save_tag(pg_catalog.uuid,pg_catalog.text,pg_catalog.int8)'),
 ('rpc','public.memo_delete_tag(pg_catalog.uuid,pg_catalog.int8)'),
 ('helper','public.memo_edge_spaces()'),
 ('helper','public.memo_trim_edges(pg_catalog.text)'),
 ('helper','public.memo_valid_text(pg_catalog.text,pg_catalog.text)'),
 ('helper','public.memo_tag_key(pg_catalog.text)')
), functions AS (
 SELECT e.*, p.oid, p.proowner, p.proacl, p.prokind, p.prosecdef, p.provolatile, p.proparallel, p.proleakproof, p.proconfig
 FROM expected e LEFT JOIN pg_catalog.pg_proc p
 ON p.oid=pg_catalog.to_regprocedure(e.signature)::pg_catalog.oid
), seed_names(name) AS (VALUES ('anon'),('authenticated'),('authenticator')),
seeds AS (
 SELECT s.name AS source, r.oid FROM seed_names s
 LEFT JOIN pg_catalog.pg_roles r ON r.rolname=s.name
 UNION
 SELECT 'function-owner', proowner FROM functions WHERE prokind='f'
 UNION
 SELECT 'table-owner', c.relowner FROM pg_catalog.pg_class c
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN ('memos','tags','memo_tags','memo_id_registry','memo_requests')
), roles AS (SELECT DISTINCT oid FROM seeds WHERE oid IS NOT NULL),
reachable(seed, oid) AS (
 SELECT oid,oid FROM roles
 UNION
 SELECT x.seed,m.roleid FROM reachable x
 JOIN pg_catalog.pg_auth_members m ON m.member=x.oid
)
SELECT s.rolname AS seed_role, r.rolname AS reached_role,
       r.rolsuper, r.rolinherit, r.rolbypassrls,
       pg_catalog.pg_has_role(x.seed,x.oid,'MEMBER') AS member_path,
       pg_catalog.pg_has_role(x.seed,x.oid,'USAGE') AS usable_without_set_role,
       pg_catalog.pg_has_role(x.seed,x.oid,'SET') AS can_set_role,
       parent.rolname AS directly_granted_role,
       m.admin_option, m.inherit_option, m.set_option
FROM reachable x
JOIN pg_catalog.pg_roles s ON s.oid=x.seed
JOIN pg_catalog.pg_roles r ON r.oid=x.oid
LEFT JOIN pg_catalog.pg_auth_members m ON m.member=x.oid
LEFT JOIN pg_catalog.pg_roles parent ON parent.oid=m.roleid
ORDER BY s.rolname,r.rolname,parent.rolname;
