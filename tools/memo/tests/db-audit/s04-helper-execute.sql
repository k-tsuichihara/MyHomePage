-- S04 / PostgreSQL 17 / REVIEW ONLY: 未適用。実行にはQ04の個別承認が必要。
-- 1文のDO全体が原子的。例外は握り潰さない。autocommitでは成功時に永続化する。
-- 同時DDL/権限変更のない時間枠でのみ使用。環境照合・時間上限は承認済み実行側の責務。
-- 追加GRANT・ロール作成・所有者変更・定義変更・自動復旧は行わない。
DO $s04$
DECLARE
  helpers constant text[] := ARRAY[
    'public.memo_edge_spaces()',
    'public.memo_trim_edges(pg_catalog.text)',
    'public.memo_valid_text(pg_catalog.text,pg_catalog.text)',
    'public.memo_tag_key(pg_catalog.text)'
  ];
  rpcs constant text[] := ARRAY[
    'public.memo_load_snapshot()',
    'public.memo_save(pg_catalog.uuid,pg_catalog.text,pg_catalog.text,pg_catalog.uuid[],pg_catalog.int8,pg_catalog.uuid)',
    'public.memo_resolve_request(pg_catalog.uuid,pg_catalog.uuid,pg_catalog.text,pg_catalog.text,pg_catalog.uuid[],pg_catalog.int8)',
    'public.memo_change_state(pg_catalog.uuid,pg_catalog.int8,pg_catalog.uuid,pg_catalog.text)',
    'public.memo_delete_permanently(pg_catalog.uuid,pg_catalog.int8)',
    'public.memo_empty_trash(pg_catalog.uuid[],pg_catalog.int8[])',
    'public.memo_save_tag(pg_catalog.uuid,pg_catalog.text,pg_catalog.int8)',
    'public.memo_delete_tag(pg_catalog.uuid,pg_catalog.int8)'
  ];
  signature text;
  rpc_signature text;
  helper_oid oid;
  rpc_oid oid;
  client_oid oid;
  owner_oid oid;
BEGIN
  -- 固定対象以外へ操作を広げない。DEFINER属性の変化は停止する。
  FOREACH signature IN ARRAY helpers LOOP
    helper_oid := pg_catalog.to_regprocedure(signature);
    IF helper_oid IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc WHERE oid = helper_oid AND prokind = 'f' AND NOT prosecdef
    ) THEN RAISE EXCEPTION 'S04: helper definition mismatch'; END IF;
  END LOOP;
  FOREACH signature IN ARRAY rpcs LOOP
    rpc_oid := pg_catalog.to_regprocedure(signature);
    IF rpc_oid IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc WHERE oid = rpc_oid AND prokind = 'f' AND prosecdef
    ) THEN RAISE EXCEPTION 'S04: RPC definition mismatch'; END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'S04: client role missing';
  END IF;

  -- RESTRICTにより付与連鎖の巻き込みを拒否する。必要な権限が不足しても追加しない。
  FOREACH signature IN ARRAY helpers LOOP
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || signature || ' FROM PUBLIC, anon, authenticated RESTRICT';
  END LOOP;

  FOREACH signature IN ARRAY helpers LOOP
    helper_oid := pg_catalog.to_regprocedure(signature);
    -- 8 RPC ownerすべてについて十分条件を検査。全ownerが全helperを使うという意味ではない。
    FOREACH rpc_signature IN ARRAY rpcs LOOP
      rpc_oid := pg_catalog.to_regprocedure(rpc_signature);
      SELECT proowner INTO STRICT owner_oid FROM pg_catalog.pg_proc WHERE oid = rpc_oid;
      IF NOT pg_catalog.has_function_privilege(owner_oid, helper_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'S04: RPC owner permission insufficient';
      END IF;
    END LOOP;
    FOR client_oid IN SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
      IF pg_catalog.has_function_privilege(client_oid, helper_oid, 'EXECUTE') OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles r
        WHERE pg_catalog.pg_has_role(client_oid, r.oid, 'SET')
          AND pg_catalog.has_function_privilege(r.oid, helper_oid, 'EXECUTE')
      ) THEN RAISE EXCEPTION 'S04: client permission remains'; END IF;
    END LOOP;
  END LOOP;
END;
$s04$;
