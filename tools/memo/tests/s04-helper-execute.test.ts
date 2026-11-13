import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sql = read('./db-audit/s04-helper-execute.sql');
const code = sql.replace(/--[^\n]*/g, '');
const audit = read('./db-audit/r02-preapply-catalog-audit.sql');
const schema = read('../doc/v1.1.0/memo_v1_1_schema_review8.sql');
const signatures = (name: string) => {
  const declaration = code.match(new RegExp(`${name} constant text\\[\\] := ARRAY\\[([\\s\\S]*?)\\];`));
  expect(declaration).not.toBeNull();
  return [...declaration![1]!.matchAll(/'([^']+)'/g)].map(match => match[1]!);
};

describe('S04 repository ACL boundary (SQL is never executed)', () => {
  it('uses exactly the existing four helpers and eight complete RPC signatures', () => {
    const helpers = signatures('helpers');
    const rpcs = signatures('rpcs');
    expect(helpers).toHaveLength(4);
    expect(rpcs).toHaveLength(8);
    expect(new Set([...helpers, ...rpcs]).size).toBe(12);
    for (const signature of helpers) expect(audit).toContain(`('helper','${signature}')`);
    for (const signature of rpcs) expect(audit).toContain(`('rpc','${signature}')`);
  });

  it('only revokes helper EXECUTE without widening or rewriting other permissions', () => {
    expect(code.match(/EXECUTE 'REVOKE/g)).toHaveLength(1);
    expect(code).toContain("' FROM PUBLIC, anon, authenticated RESTRICT'");
    expect(code).not.toMatch(/\b(GRANT|CASCADE|ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|COMMIT|ROLLBACK)\b/i);
    expect(code).toContain('FOREACH signature IN ARRAY helpers LOOP');
  });

  it('fails atomically on missing objects, unsafe attributes, owner shortage or inherited client reachability', () => {
    expect(code.match(/DO \$s04\$/g)).toHaveLength(1);
    expect(code).toMatch(/END;\s*\$s04\$;\s*$/);
    expect(code).not.toMatch(/EXCEPTION\s+WHEN/i);
    expect(code).toContain("prokind = 'f' AND NOT prosecdef");
    expect(code).toContain("prokind = 'f' AND prosecdef");
    expect(code).toContain("has_function_privilege(owner_oid, helper_oid, 'EXECUTE')");
    expect(code).toContain("has_function_privilege(client_oid, helper_oid, 'EXECUTE')");
    expect(code).toContain("pg_has_role(client_oid, r.oid, 'SET')");
    expect(code.indexOf("EXECUTE 'REVOKE")).toBeLessThan(code.indexOf('RPC owner permission insufficient'));
    expect(code).toContain("RAISE EXCEPTION 'S04: client permission remains'");
  });

  it('matches existing DEFINER RPC / INVOKER helper definitions and unchanged table DML boundary', () => {
    const functions = [...schema.matchAll(/create function public\.(memo_\w+)\([\s\S]*?\bas \$\$/gi)];
    expect(functions).toHaveLength(12);
    for (const fn of functions) {
      const helper = signatures('helpers').some(signature => signature.startsWith(`public.${fn[1]}(`));
      expect(/security definer/i.test(fn[0])).toBe(!helper);
    }
    expect(schema).toContain('no direct table mutations by app role');
    expect(schema).toContain('grant select on public.memos, public.tags, public.memo_tags to authenticated');
  });
});
