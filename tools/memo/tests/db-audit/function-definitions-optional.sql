-- 未実行・追加承認対象。定義に秘密の直書きがある可能性を考慮し、所有者が非公開で扱う。
-- 出力はSQLの文字列であり、実行する手順ではない。貼付け再実行・Git/PRへの原本添付は禁止。
-- 同名全overloadを表示する。関数は実行せず、定義だけを取り出す。
SELECT n.nspname, p.proname,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       pg_catalog.pg_get_functiondef(p.oid) AS definition
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname IN
 ('memo_load_snapshot','memo_save','memo_resolve_request','memo_change_state',
  'memo_delete_permanently','memo_empty_trash','memo_save_tag','memo_delete_tag',
  'memo_edge_spaces','memo_trim_edges','memo_valid_text','memo_tag_key')
ORDER BY p.proname, identity_arguments;
