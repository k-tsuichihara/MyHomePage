-- 開発DB専用・未実行の監査案。実行承認後に各A番号を個別実行する。
-- SELECTとシステムカタログ/組込の定義・権限取得だけ。ユーザーデータ行やRPCは取得/実行しない。
-- 接続先確認、権限、読取専用セッション、クライアント側期限等はDEV-DB-AUDIT.mdを参照。

-- A01: セッション/PG版。PostgREST版やプロジェクト識別の証明にはならない。
SELECT pg_catalog.current_setting('server_version') AS server_version,
       pg_catalog.current_setting('server_version_num') AS server_version_num,
       pg_catalog.current_setting('server_encoding') AS server_encoding,
       pg_catalog.current_setting('transaction_read_only') AS transaction_read_only,
       pg_catalog.current_setting('statement_timeout') AS statement_timeout,
       pg_catalog.current_setting('lock_timeout') AS lock_timeout,
       current_user AS execution_role, session_user AS session_role;

-- A02: 存在・種別・所有者・RLS。欠落も1行として残す。
WITH expected(name) AS (VALUES ('memos'), ('tags'), ('memo_tags'), ('memo_id_registry'), ('memo_requests'))
SELECT e.name, c.oid IS NOT NULL AS present, c.relkind,
       CASE WHEN c.oid IS NOT NULL THEN pg_catalog.pg_get_userbyid(c.relowner) END AS owner,
       c.relrowsecurity, c.relforcerowsecurity
FROM expected e
LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
LEFT JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relname = e.name
ORDER BY e.name;

-- A03: カラム順・型・NULL・default・identity/generated。式は表示だけで評価しない。
SELECT c.relname, a.attnum, a.attname,
       pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
       a.attnotnull, a.attidentity, a.attgenerated,
       CASE WHEN d.oid IS NOT NULL THEN pg_catalog.pg_get_expr(d.adbin, d.adrelid) END AS default_expression,
       co.collname AS collation
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
LEFT JOIN pg_catalog.pg_collation co ON co.oid = a.attcollation
WHERE n.nspname = 'public' AND c.relname IN ('memos', 'tags', 'memo_tags', 'memo_id_registry', 'memo_requests')
ORDER BY c.relname, a.attnum;

-- A04: 制約・FKの参照先/削除動作・validation/deferrable。データの適合性検査ではない。
SELECT c.relname, k.conname, k.contype, k.convalidated, k.condeferrable, k.condeferred,
       pg_catalog.pg_get_constraintdef(k.oid, false) AS definition
FROM pg_catalog.pg_constraint k
JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('memos', 'tags', 'memo_tags', 'memo_id_registry', 'memo_requests')
ORDER BY c.relname, k.conname;

-- A05: index定義と有効性。index内容の走査・再作成はしない。
SELECT t.relname, i.relname AS index_name, x.indisprimary, x.indisunique, x.indisvalid, x.indisready,
       pg_catalog.pg_get_indexdef(x.indexrelid) AS definition
FROM pg_catalog.pg_index x
JOIN pg_catalog.pg_class t ON t.oid = x.indrelid
JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid
WHERE n.nspname = 'public' AND t.relname IN ('memos', 'tags', 'memo_tags', 'memo_id_registry', 'memo_requests')
ORDER BY t.relname, i.relname;

-- A06: 8RPC+4検証関数。同名の全overloadを表示し、関数不在も残す。
-- 存在しないOIDを逆解析関数へ渡さず、対象版のSTRICT属性に依存しない。
WITH expected(name) AS (VALUES
 ('memo_load_snapshot'), ('memo_save'), ('memo_resolve_request'), ('memo_change_state'),
 ('memo_delete_permanently'), ('memo_empty_trash'), ('memo_save_tag'), ('memo_delete_tag'),
 ('memo_edge_spaces'), ('memo_trim_edges'), ('memo_valid_text'), ('memo_tag_key'))
SELECT e.name, p.oid IS NOT NULL AS present, p.prokind,
       CASE WHEN p.oid IS NOT NULL THEN pg_catalog.pg_get_function_identity_arguments(p.oid) END AS identity_arguments,
       CASE WHEN p.oid IS NOT NULL THEN pg_catalog.pg_get_function_arguments(p.oid) END AS arguments_with_defaults,
       CASE WHEN p.oid IS NOT NULL THEN pg_catalog.pg_get_function_result(p.oid) END AS result_type,
       CASE WHEN p.oid IS NOT NULL THEN pg_catalog.pg_get_userbyid(p.proowner) END AS owner, l.lanname,
       p.prosecdef, p.provolatile, p.proparallel, p.proleakproof, p.proretset,
       CASE WHEN p.oid IS NOT NULL THEN ARRAY(SELECT pg_catalog.split_part(setting, '=', 1)
             FROM pg_catalog.unnest(p.proconfig) AS cfg(setting)) END AS config_names,
       CASE WHEN p.oid IS NOT NULL THEN ARRAY(SELECT setting FROM pg_catalog.unnest(p.proconfig) AS cfg(setting)
             WHERE pg_catalog.split_part(setting, '=', 1) = 'search_path') END AS search_path_settings,
       CASE WHEN p.oid IS NOT NULL AND p.prokind = 'f' THEN pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) END AS definition_fingerprint
FROM expected e
LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
LEFT JOIN pg_catalog.pg_proc p ON p.pronamespace = n.oid AND p.proname = e.name
LEFT JOIN pg_catalog.pg_language l ON l.oid = p.prolang
ORDER BY e.name, identity_arguments;

-- A07: ポリシー全件。PUBLIC=OID0、permissive/restrictive、USING/WITH CHECKを分ける。
SELECT c.relname, p.polname, p.polcmd, p.polpermissive,
       ARRAY(SELECT CASE WHEN role_oid = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(role_oid)::text END
             FROM pg_catalog.unnest(p.polroles) AS roles(role_oid)) AS roles,
       pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS using_expression,
       pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) AS with_check_expression
FROM pg_catalog.pg_policy p
JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('memos', 'tags', 'memo_tags', 'memo_id_registry', 'memo_requests')
ORDER BY c.relname, p.polname;

-- A08: table ACL。NULL ACLは組込defaultを展開し、PUBLICを落とさない。
SELECT c.relname, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee)::text END AS grantee,
       pg_catalog.pg_get_userbyid(a.grantor) AS grantor, a.privilege_type, a.is_grantable,
       c.relacl IS NULL AS uses_default_acl
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
WHERE n.nspname = 'public' AND c.relname IN ('memos', 'tags', 'memo_tags', 'memo_id_registry', 'memo_requests')
ORDER BY c.relname, grantee, a.privilege_type;

-- A09: column ACL（table ACLとは別）。権限のない行を0件と決めつけない。
SELECT c.relname, col.attname,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee)::text END AS grantee,
       a.privilege_type, a.is_grantable
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute col ON col.attrelid = c.oid AND col.attnum > 0 AND NOT col.attisdropped
CROSS JOIN LATERAL pg_catalog.aclexplode(col.attacl) a
WHERE n.nspname = 'public' AND c.relname IN ('memos', 'tags', 'memo_tags', 'memo_id_registry', 'memo_requests')
ORDER BY c.relname, col.attnum, grantee;

-- A10: function ACL。RPCにPUBLIC default EXECUTEが残っていないか、全overloadを確認。
SELECT p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee)::text END AS grantee,
       pg_catalog.pg_get_userbyid(a.grantor) AS grantor, a.privilege_type, a.is_grantable,
       p.proacl IS NULL AS uses_default_acl
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
WHERE n.nspname = 'public' AND p.proname IN
 ('memo_load_snapshot','memo_save','memo_resolve_request','memo_change_state',
  'memo_delete_permanently','memo_empty_trash','memo_save_tag','memo_delete_tag',
  'memo_edge_spaces','memo_trim_edges','memo_valid_text','memo_tag_key')
ORDER BY p.proname, identity_arguments, grantee;

-- A11: anon/authenticatedの実効table権限（所有/継承/PUBLICも含む）。RLSの行可視性は別問題。
WITH roles(name) AS (VALUES ('anon'), ('authenticated'))
SELECT roles.name AS role_name, r.oid IS NOT NULL AS role_present, c.relname, privilege,
       CASE WHEN r.oid IS NOT NULL THEN pg_catalog.has_table_privilege(r.oid, c.oid, privilege) END AS allowed
FROM roles LEFT JOIN pg_catalog.pg_roles r ON r.rolname = roles.name
CROSS JOIN pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) v(privilege)
WHERE n.nspname = 'public' AND c.relname IN ('memos', 'tags', 'memo_tags', 'memo_id_registry', 'memo_requests')
ORDER BY role_name, c.relname, privilege;

-- A12: 実効column権限。カラム単位のDML許可をtable ACLだけで見落とさない。
WITH roles(name) AS (VALUES ('anon'), ('authenticated'))
SELECT roles.name AS role_name, c.relname, a.attname, privilege,
       CASE WHEN r.oid IS NOT NULL THEN pg_catalog.has_column_privilege(r.oid, c.oid, a.attnum, privilege) END AS allowed
FROM roles LEFT JOIN pg_catalog.pg_roles r ON r.rolname = roles.name
CROSS JOIN pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) v(privilege)
WHERE n.nspname = 'public' AND c.relname IN ('memos', 'tags', 'memo_tags', 'memo_id_registry', 'memo_requests')
ORDER BY role_name, c.relname, a.attnum, privilege;

-- A13: 実効RPC EXECUTEとschema USAGE/CREATE。schema単位の露出も別に確認。
WITH roles(name) AS (VALUES ('anon'), ('authenticated'))
SELECT roles.name AS role_name, p.proname,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       CASE WHEN r.oid IS NOT NULL THEN pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE') END AS allowed
FROM roles LEFT JOIN pg_catalog.pg_roles r ON r.rolname = roles.name
CROSS JOIN pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN
 ('memo_load_snapshot','memo_save','memo_resolve_request','memo_change_state',
  'memo_delete_permanently','memo_empty_trash','memo_save_tag','memo_delete_tag',
  'memo_edge_spaces','memo_trim_edges','memo_valid_text','memo_tag_key')
ORDER BY role_name, p.proname, identity_arguments;

WITH roles(name) AS (VALUES ('anon'), ('authenticated'))
SELECT roles.name AS role_name, n.nspname,
       CASE WHEN r.oid IS NOT NULL THEN pg_catalog.has_schema_privilege(r.oid, n.oid, 'USAGE') END AS can_use,
       CASE WHEN r.oid IS NOT NULL THEN pg_catalog.has_schema_privilege(r.oid, n.oid, 'CREATE') END AS can_create
FROM roles LEFT JOIN pg_catalog.pg_roles r ON r.rolname = roles.name
CROSS JOIN pg_catalog.pg_namespace n WHERE n.nspname IN ('public', 'extensions')
ORDER BY role_name, n.nspname;

-- A14: 関連ロールの属性（パスワードなし）と直接のmembership。
SELECT r.rolname, r.rolsuper, r.rolinherit, r.rolcreaterole, r.rolcreatedb, r.rolcanlogin, r.rolbypassrls
FROM pg_catalog.pg_roles r
WHERE r.rolname IN ('anon','authenticated','authenticator') OR r.oid IN (
 SELECT p.proowner FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN
 ('memo_load_snapshot','memo_save','memo_resolve_request','memo_change_state',
  'memo_delete_permanently','memo_empty_trash','memo_save_tag','memo_delete_tag'))
ORDER BY r.rolname;

SELECT parent.rolname AS granted_role, member.rolname AS member_role, m.admin_option,
       pg_catalog.to_jsonb(m)->>'inherit_option' AS inherit_option,
       pg_catalog.to_jsonb(m)->>'set_option' AS set_option
FROM pg_catalog.pg_auth_members m
JOIN pg_catalog.pg_roles parent ON parent.oid = m.roleid
JOIN pg_catalog.pg_roles member ON member.oid = m.member
WHERE parent.rolname IN ('anon','authenticated','authenticator') OR member.rolname IN ('anon','authenticated','authenticator')
ORDER BY parent.rolname, member.rolname;

-- A15: pgcryptoの版/配置/所有者とdigest overload存在。digestや拡張コードは実行しない。
SELECT e.extname, e.extversion, n.nspname, pg_catalog.pg_get_userbyid(e.extowner) AS owner, e.extrelocatable
FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'pgcrypto';

SELECT n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       pg_catalog.pg_get_function_result(p.oid) AS result_type, e.extname
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
LEFT JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass AND d.objid = p.oid AND d.deptype = 'e'
LEFT JOIN pg_catalog.pg_extension e ON d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass AND e.oid = d.refobjid
WHERE p.proname = 'digest' AND n.nspname IN ('extensions','public')
ORDER BY n.nspname, identity_arguments;

-- A16: 対象表の追加ユーザートリガー/ルールを確認。元のDMLは実行しない。
SELECT c.relname, t.tgname, t.tgenabled, pg_catalog.pg_get_triggerdef(t.oid, false) AS definition
FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal AND n.nspname = 'public'
 AND c.relname IN ('memos','tags','memo_tags','memo_id_registry','memo_requests')
ORDER BY c.relname, t.tgname;

SELECT c.relname, r.rulename, pg_catalog.pg_get_ruledef(r.oid, false) AS definition
FROM pg_catalog.pg_rewrite r JOIN pg_catalog.pg_class c ON c.oid = r.ev_class
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('memos','tags','memo_tags','memo_id_registry','memo_requests')
ORDER BY c.relname, r.rulename;

-- A17: 関連schemaの明示ACLとdefault privileges。現在ACLとは別に将来の露出を確認。
SELECT n.nspname, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee)::text END AS grantee,
       a.privilege_type, a.is_grantable
FROM pg_catalog.pg_namespace n
CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) a
WHERE n.nspname IN ('public','extensions') ORDER BY n.nspname, grantee;

SELECT pg_catalog.pg_get_userbyid(d.defaclrole) AS creator_role, n.nspname, d.defaclnamespace = 0 AS global_scope,
       d.defaclobjtype, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee)::text END AS grantee,
       a.privilege_type, a.is_grantable
FROM pg_catalog.pg_default_acl d LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
WHERE (d.defaclnamespace = 0 OR n.nspname IN ('public','extensions'))
 AND d.defaclrole IN (
   SELECT c.relowner FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname IN ('memos','tags','memo_tags','memo_id_registry','memo_requests')
   UNION
   SELECT p.proowner FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname IN
    ('memo_load_snapshot','memo_save','memo_resolve_request','memo_change_state',
     'memo_delete_permanently','memo_empty_trash','memo_save_tag','memo_delete_tag'))
ORDER BY creator_role, global_scope, n.nspname, d.defaclobjtype, grantee;
