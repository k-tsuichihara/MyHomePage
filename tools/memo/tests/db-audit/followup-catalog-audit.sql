-- 追加監査案・未実行。PG17を想定。実行はREADME-FOLLOWUP.mdの別承認後のみ。
-- カタログのSELECTだけ。本文/式の全文/ユーザーデータ/パスワードを取得しない。
-- S01: 戻り値OID。同名表示ではなくpublic表の行型OIDと比較。欠落をfalseにしない。
WITH expected(signature, relation) AS (VALUES
 ('public.memo_change_state(pg_catalog.uuid,pg_catalog.int8,pg_catalog.uuid,pg_catalog.text)','public.memos'),
 ('public.memo_save_tag(pg_catalog.uuid,pg_catalog.text,pg_catalog.int8)','public.tags'))
SELECT e.signature, p.oid AS function_oid, p.prokind, p.proretset,
       p.prorettype AS actual_type_oid, c.reltype AS expected_row_type_oid,
       tn.nspname AS actual_type_schema, t.typname AS actual_type_name,
       t.typtype, t.typrelid AS actual_type_relation_oid, c.oid AS expected_relation_oid,
       CASE WHEN p.oid IS NULL OR c.oid IS NULL OR t.oid IS NULL THEN 'UNKNOWN'
            WHEN p.prokind<>'f' OR p.proretset OR p.prorettype<>c.reltype OR t.typrelid<>c.oid
            THEN 'REVIEW' ELSE 'OID-MATCH' END AS oid_result
FROM expected e
LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(e.signature)::pg_catalog.oid
LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass(e.relation)
LEFT JOIN pg_catalog.pg_type t ON t.oid=p.prorettype
LEFT JOIN pg_catalog.pg_namespace tn ON tn.oid=t.typnamespace
ORDER BY e.signature;

-- S02: 正確な12署名の存在/所有者。全overload本文や別スキーマを取得しない。
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
 SELECT e.*, p.oid, p.proowner, p.proacl, p.prokind, p.prosecdef
 FROM expected e LEFT JOIN pg_catalog.pg_proc p
 ON p.oid=pg_catalog.to_regprocedure(e.signature)::pg_catalog.oid
)
SELECT f.kind, f.signature, f.oid AS function_oid, f.prokind, f.prosecdef,
       f.proowner AS owner_oid, r.rolname AS owner_name,
       f.proacl IS NULL AS acl_is_null
FROM functions f LEFT JOIN pg_catalog.pg_roles r ON r.oid=f.proowner
ORDER BY f.kind, f.signature;

-- S03: 補助4関数の明示ACLとNULL時の組込既定展開を区別。空ACLも欠落扱いしない。
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
 SELECT e.*, p.oid, p.proowner, p.proacl, p.prokind, p.prosecdef
 FROM expected e LEFT JOIN pg_catalog.pg_proc p
 ON p.oid=pg_catalog.to_regprocedure(e.signature)::pg_catalog.oid
)
SELECT f.signature, f.oid AS function_oid, f.prokind,
       CASE WHEN f.oid IS NULL THEN 'missing'
            WHEN f.proacl IS NULL THEN 'builtin-default-expanded'
            ELSE 'explicit-acl' END AS acl_source,
       CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE gr.rolname::text END AS grantee,
       a.grantee AS grantee_oid, ga.rolname AS grantor, a.privilege_type, a.is_grantable
FROM functions f
LEFT JOIN LATERAL pg_catalog.aclexplode(
 CASE WHEN f.oid IS NOT NULL AND f.prokind='f'
 THEN coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner)) END) a ON true
LEFT JOIN pg_catalog.pg_roles gr ON gr.oid=a.grantee
LEFT JOIN pg_catalog.pg_roles ga ON ga.oid=a.grantor
WHERE f.kind='helper' ORDER BY f.signature, a.grantee, a.privilege_type;

-- S04: 関連主体の実効EXECUTEとschema USAGE。PUBLICはロールOIDとして照会しない。
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
 SELECT e.*, p.oid, p.proowner, p.proacl, p.prokind, p.prosecdef
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
       CASE WHEN s.oid IS NOT NULL AND n.oid IS NOT NULL
            THEN pg_catalog.has_schema_privilege(s.oid,n.oid,'USAGE') END AS public_usage
FROM seeds s LEFT JOIN pg_catalog.pg_roles r ON r.oid=s.oid
CROSS JOIN functions f LEFT JOIN pg_catalog.pg_namespace n ON n.nspname='public'
WHERE f.kind='helper' ORDER BY s.source, r.rolname, f.signature;

-- S05: 指定CHECK/一意indexの登録された直接関数依存だけ。式・本文を逆解析しない。
WITH expected(kind, relation, object_name, helper_signature) AS (VALUES
 ('check','public.memos','memo_title_check','public.memo_valid_text(pg_catalog.text,pg_catalog.text)'),
 ('check','public.memos','memo_body_check','public.memo_valid_text(pg_catalog.text,pg_catalog.text)'),
 ('check','public.tags','tag_name_check','public.memo_valid_text(pg_catalog.text,pg_catalog.text)'),
 ('index','public.tags','tags_name_per_user','public.memo_tag_key(pg_catalog.text)')),
objects AS (
 SELECT e.*, c.oid AS table_oid, co.oid AS object_oid,
        'pg_catalog.pg_constraint'::pg_catalog.regclass::pg_catalog.oid AS object_class_oid,
        co.convalidated AS valid, NULL::boolean AS ready, NULL::boolean AS is_unique,
        co.contype::text AS object_kind
 FROM expected e LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass(e.relation)
 LEFT JOIN pg_catalog.pg_constraint co ON co.conrelid=c.oid AND co.conname=e.object_name
 WHERE e.kind='check'
 UNION ALL
 SELECT e.*, c.oid, ix.oid,
        'pg_catalog.pg_class'::pg_catalog.regclass::pg_catalog.oid,
        i.indisvalid, i.indisready, i.indisunique, ix.relkind::text
 FROM expected e LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass(e.relation)
 LEFT JOIN pg_catalog.pg_namespace ns ON ns.nspname='public'
 LEFT JOIN pg_catalog.pg_class ix ON ix.relnamespace=ns.oid AND ix.relname=e.object_name
 LEFT JOIN pg_catalog.pg_index i ON i.indexrelid=ix.oid AND i.indrelid=c.oid
 WHERE e.kind='index'
)
SELECT o.kind, o.relation, o.object_name, o.table_oid, o.object_oid, o.object_kind,
       o.valid, o.ready, o.is_unique, o.helper_signature,
       pg_catalog.to_regprocedure(o.helper_signature)::pg_catalog.oid AS expected_helper_oid,
       d.refobjid AS referenced_function_oid, n.nspname AS referenced_schema,
       p.proname AS referenced_name, d.deptype,
       CASE WHEN o.object_oid IS NULL OR d.refobjid IS NULL THEN NULL
            ELSE d.refobjid=pg_catalog.to_regprocedure(o.helper_signature)::pg_catalog.oid END AS expected_dependency
FROM objects o
LEFT JOIN pg_catalog.pg_depend d ON d.classid=o.object_class_oid AND d.objid=o.object_oid
 AND d.refclassid='pg_catalog.pg_proc'::pg_catalog.regclass AND d.objsubid=0
LEFT JOIN pg_catalog.pg_proc p ON p.oid=d.refobjid
LEFT JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
ORDER BY o.kind, o.object_name, d.refobjid;

-- S06: 関連主体から上位への全到達ロールと辺。UNIONで循環/複数経路の再訪を抑制。
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
 SELECT e.*, p.oid, p.proowner, p.proacl, p.prokind, p.prosecdef
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
