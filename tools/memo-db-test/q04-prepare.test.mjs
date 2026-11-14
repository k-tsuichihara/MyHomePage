import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { prepareS04 } from './q04-prepare.mjs';

test('S04原文を一度だけ内包し15s/3sとtransactionだけを追加する（SQL未実行）', async () => {
  const source = await readFile(new URL('../memo/tests/db-audit/s04-helper-execute.sql', import.meta.url), 'utf8');
  const { sql, metadata } = prepareS04(source);
  assert.equal(sql.split(source).length, 2);
  assert.match(sql, /BEGIN;\nSET LOCAL statement_timeout = '15s';\nSET LOCAL lock_timeout = '3s';/);
  assert.ok(sql.endsWith('\nCOMMIT;\n'));
  assert.equal(metadata.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(metadata.applied, false);
});
