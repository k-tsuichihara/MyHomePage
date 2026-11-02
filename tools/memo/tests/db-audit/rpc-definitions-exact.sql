-- 未実行の取得案。接続・実行・保管は別承認。RPCや返されたDDLを実行しない。
-- publicの8つの完全署名のみ。補助関数・想定外overloadの本文を取得しない。
-- 全8件の存在/種別/同名候補数が適合しない場合、全definitionをNULLにする。
-- カタログだけを読む。実権限・負荷・クライアントの切詰めは未検証。
WITH expected(seq, name, signature) AS (VALUES
 (1, 'memo_save', 'public.memo_save(pg_catalog.uuid,pg_catalog.text,pg_catalog.text,pg_catalog.uuid[],pg_catalog.int8,pg_catalog.uuid)'),
 (2, 'memo_load_snapshot', 'public.memo_load_snapshot()'),
 (3, 'memo_change_state', 'public.memo_change_state(pg_catalog.uuid,pg_catalog.int8,pg_catalog.uuid,pg_catalog.text)'),
 (4, 'memo_delete_permanently', 'public.memo_delete_permanently(pg_catalog.uuid,pg_catalog.int8)'),
 (5, 'memo_empty_trash', 'public.memo_empty_trash(pg_catalog.uuid[],pg_catalog.int8[])'),
 (6, 'memo_resolve_request', 'public.memo_resolve_request(pg_catalog.uuid,pg_catalog.uuid,pg_catalog.text,pg_catalog.text,pg_catalog.uuid[],pg_catalog.int8)'),
 (7, 'memo_save_tag', 'public.memo_save_tag(pg_catalog.uuid,pg_catalog.text,pg_catalog.int8)'),
 (8, 'memo_delete_tag', 'public.memo_delete_tag(pg_catalog.uuid,pg_catalog.int8)')
), resolved AS (
 SELECT e.*, pg_catalog.to_regprocedure(e.signature)::pg_catalog.oid AS target_oid,
        (SELECT count(*) FROM pg_catalog.pg_proc q
         JOIN pg_catalog.pg_namespace n ON n.oid=q.pronamespace
         WHERE n.nspname='public' AND q.proname=e.name) AS same_name_count
 FROM expected e
), checked AS (
 SELECT r.*, p.prokind,
        CASE WHEN p.oid IS NOT NULL AND p.prokind='f' THEN pg_catalog.pg_get_function_identity_arguments(p.oid) END AS actual_arguments,
        CASE WHEN p.oid IS NOT NULL AND p.prokind='f' THEN pg_catalog.pg_get_function_result(p.oid) END AS actual_result,
        CASE WHEN r.same_name_count=0 THEN 'missing'
             WHEN r.target_oid IS NULL THEN 'signature-mismatch'
             WHEN r.same_name_count<>1 THEN 'unexpected-overload'
             WHEN p.prokind IS DISTINCT FROM 'f' THEN 'wrong-kind'
             ELSE 'exact' END AS target_status
 FROM resolved r LEFT JOIN pg_catalog.pg_proc p ON p.oid=r.target_oid
), gate AS (
 SELECT count(*)=8 AND count(DISTINCT signature)=8
        AND count(DISTINCT target_oid)=8
        AND bool_and(target_status='exact') AS acquisition_allowed
 FROM checked
), extracted AS MATERIALIZED (
 SELECT c.*, g.acquisition_allowed,
        CASE WHEN g.acquisition_allowed AND c.prokind='f' AND c.target_oid IS NOT NULL
             THEN pg_catalog.pg_get_functiondef(c.target_oid) END AS definition
 FROM checked c CROSS JOIN gate g
)
SELECT seq, signature AS expected_signature, target_oid, same_name_count,
       target_status, actual_arguments, actual_result, acquisition_allowed,
       pg_catalog.current_setting('transaction_read_only') AS transaction_read_only,
       pg_catalog.current_setting('statement_timeout') AS statement_timeout,
       pg_catalog.current_setting('lock_timeout') AS lock_timeout,
       pg_catalog.octet_length(pg_catalog.convert_to(definition,'UTF8')) AS definition_utf8_bytes,
       pg_catalog.md5(pg_catalog.convert_to(definition,'UTF8')) AS definition_utf8_md5,
       definition
FROM extracted ORDER BY seq;
