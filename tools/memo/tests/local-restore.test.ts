import { describe, it, expect, vi } from 'vitest';
import { parseBackupBytes, MAX_IMPORT_BYTES } from '../src/backup-json';
import { diagnoseBackup, planRestore, compareRestoreRow } from '../src/local-restore';
import type { RestoreV3 } from '../src/local-restore';
import { createLocalRestoreController } from '../src/local-restore-controller';
import { state, token, NOW, saveFixture } from './local-save-fixtures';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../src/local-migration';
import { createPendingMigration } from '../src/migration';

const bytes = (s: string) => new TextEncoder().encode(s);
function current(): RestoreV3 { return { ...state(), version: 3, migration: { status: 'not-required' }, deletedMemoIds: [token(90)] }; }
function envelope(data: unknown = current()) {
  const d = data as RestoreV3;
  return { format: 'myhomepage.memo.local-backup', backupVersion: 1, sourceStorageVersion: 3, exportedAt: NOW,
    data: { memos: d.memos, tags: d.tags, memoTags: d.memoTags, deletedMemoIds: d.deletedMemoIds } };
}
function backup(data = current()) { return diagnoseBackup(bytes(JSON.stringify(envelope(data)))); }
function ids(start = 100) { let n = start; return () => token(++n); }

describe('制限付きJSON走査', () => {
  it.each(['{"a":1,}', '[1,]', '{"a":1, }', '[1, ]', '{"a":[1,]}'])('末尾カンマは全体JSON.parseより前に拒否 %s', raw => {
    // キー文字列の復号用parseと、走査後の全体parseを区別する。
    const parse = vi.spyOn(JSON, 'parse');
    try {
      expect(() => parseBackupBytes(bytes(raw))).toThrow();
      expect(parse.mock.calls.some(args => args[0] === raw)).toBe(false);
    } finally { parse.mockRestore(); }
  });
  it.each(['{}', '[]', '{"a":"\\\"\\\\\\/\\b\\f\\n\\r\\t\\u0061"}', '{"a":[null,true,false,-1.2e+3]}'])('正常な構文とescape %s', raw => {
    expect(parseBackupBytes(bytes(raw))).toEqual(JSON.parse(raw));
  });
  it.each(['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"x":{"k":0,"k":1}}', '{"__proto__":{}}', '{"constructor":1}'])('重複・危険キーを拒否 %s', raw => {
    expect(() => parseBackupBytes(bytes(raw))).toThrow(); expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });
  it('別オブジェクトの同じキーは重複ではない', () => { expect(parseBackupBytes(bytes('[{"a":1},{"a":2}]'))).toHaveLength(2); });
  it.each(['{"a":}', '{"a":1,}', '[1,]', '01', '1.', '+1', '1e', 'true false', '"\\x20"', '"\\u000"', '"abc', '"a\nb"', '{a:1}', '\u00a0{}'])('構文エラー %s', raw => {
    expect(() => parseBackupBytes(bytes(raw))).toThrow();
  });
  it('文字列中の括弧・キー風文字列は深度や重複キーに数えない', () => {
    const value = { x: '{"a":1,"a":2}[[[[]]]]' }; expect(parseBackupBytes(bytes(JSON.stringify(value)))).toEqual(value);
  });
  it('深度32は受理し33は停止する', () => {
    expect(() => parseBackupBytes(bytes('['.repeat(32) + '0' + ']'.repeat(32)))).not.toThrow();
    expect(() => parseBackupBytes(bytes('['.repeat(33) + '0' + ']'.repeat(33)))).toThrow('depth');
  });
  it('不正UTF8・BOM・入力サイズ超過を拒否する', () => {
    expect(() => parseBackupBytes(new Uint8Array([0xc0, 0xaf]))).toThrow('utf8');
    expect(() => parseBackupBytes(new Uint8Array([0xef, 0xbb, 0xbf, 123, 125]))).toThrow('bom');
    expect(() => parseBackupBytes(new Uint8Array(MAX_IMPORT_BYTES + 1))).toThrow('size');
    const exact = new Uint8Array(MAX_IMPORT_BYTES).fill(32); exact[0] = 48;
    expect(parseBackupBytes(exact)).toBe(0);
  });
});

describe('バックアップの行別診断・変換', () => {
  it('正常行と不正行を分離し、重複元メモIDは各行として保持', () => {
    const d = current(); d.memos.push({ ...d.memos[0]! }, { ...d.memos[0]!, title: '' });
    const b = backup(d); expect(b.rows.map(r => !!r.memo)).toEqual([true, true, true, false]);
    expect(b.rows[0]!.tagIds).toEqual(b.rows[2]!.tagIds); expect(b.rows[2]!.warnings).toContain('duplicate-source-id');
  });
  it('同値タグIDの全定義を無効にし、関連は警告して除外する', () => {
    const d = current(); d.tags.push({ ...d.tags[0]!, id: d.tags[0]!.id.toUpperCase() });
    const b = backup(d); expect(b.tags).toHaveLength(1); expect(b.rows[0]!.memo).not.toBeNull(); expect(b.rows[0]!.tagIds).toEqual([]);
    expect(b.warnings.some(w => w.includes('missing-reference'))).toBe(true);
  });
  it('不正タグ定義も同IDの正常定義を無効にする', () => {
    const raw = envelope(); (raw.data.tags as unknown[]).push({ id: raw.data.tags[0]!.id, name: '' });
    const b = diagnoseBackup(bytes(JSON.stringify(raw))); expect(b.tags).toHaveLength(1);
  });
  it('有効な重複関連を警告統合し、参照不正・不存在は警告除外', () => {
    const d = current(); d.memoTags.push({ ...d.memoTags[0]! }, { memoId: token(999), tagId: d.tags[0]!.id }, { memoId: d.memos[0]!.id, tagId: 'invalid' });
    const b = backup(d); expect(b.rows[0]!.tagIds).toHaveLength(1); expect(b.warnings).toHaveLength(3);
  });
  it.each([null, {}, { memoId: 1, tagId: 'x' }, { memoId: 'x', tagId: 'x', extra: true }])('関連構造不正は全体停止 %j', link => {
    const raw = envelope(); (raw.data.memoTags as unknown[]).push(link); expect(() => diagnoseBackup(bytes(JSON.stringify(raw)))).toThrow();
  });
  it.each([['memos', 10001], ['tags', 5001], ['memoTags', 100001], ['deletedMemoIds', 100001]] as const)('件数制限 %s', (field, size) => {
    const raw = envelope(); (raw.data as unknown as Record<string, unknown>)[field] = Array(size).fill(null);
    expect(() => diagnoseBackup(bytes(JSON.stringify(raw)))).toThrow('count');
  });
  it('未知版・未知項目・色・不正履歴を拒否または行不正にする', () => {
    const raw = envelope(); raw.backupVersion = 2; expect(() => diagnoseBackup(bytes(JSON.stringify(raw)))).toThrow('format');
    const other = envelope(); (other.data.tags[0] as unknown as Record<string, unknown>).color = 'red';
    expect(diagnoseBackup(bytes(JSON.stringify(other))).tags).toHaveLength(1);
    const history = envelope(); history.data.deletedMemoIds = ['bad']; expect(() => diagnoseBackup(bytes(JSON.stringify(history)))).toThrow();
  });
  it('既存同名優先・決定的代表名・全正常タグ統合・原本不変', () => {
    const c = current(), source = current(); source.tags[0]!.id = token(200); source.tags[0]!.name = 'TAG';
    source.memoTags = [{ memoId: source.memos[0]!.id, tagId: token(200) }];
    source.tags.push({ id: token(300), name: 'NEW', createdAt: NOW, revision: 3 }, { id: token(299), name: 'new', createdAt: NOW, revision: 4 });
    const b = backup(source), before = JSON.stringify(c), original = JSON.stringify(b);
    const candidate = planRestore(c, b, [0], NOW, ids());
    expect(candidate.tags.slice(0, c.tags.length)).toEqual(c.tags); expect(candidate.tags.at(-1)!.name).toBe('new');
    expect(candidate.tags.at(-1)!.revision).toBe(1); expect(candidate.tags.at(-1)!.createdAt).toBe(NOW);
    expect(candidate.memoTags.at(-1)!.tagId).toBe(c.tags[0]!.id);
    expect(candidate.deletedMemoIds).toEqual(c.deletedMemoIds); expect(JSON.stringify(c)).toBe(before); expect(JSON.stringify(b)).toBe(original);
    expect(planRestore(c, { ...b, tags: [...b.tags].reverse() }, [0], NOW, ids())).toEqual(candidate);
  });
  it('一致でも新ID、pinは新時刻・trash日時は原値、履歴とmetadata不変', () => {
    const c = current(), source = current(); source.memos[0]!.deletedAt = source.memos[0]!.createdAt;
    source.deletedMemoIds = [token(999)]; const candidate = planRestore(c, backup(source), [0, 1], NOW, ids());
    expect(candidate.memos.slice(0, 2)).toEqual(c.memos);
    expect(candidate.memos[2]).toMatchObject({ title: source.memos[0]!.title, createdAt: NOW, updatedAt: NOW, pinnedAt: NOW, deletedAt: source.memos[0]!.deletedAt, revision: 1, lastRequestId: null });
    expect(candidate.memos[2]!.id).not.toBe(source.memos[0]!.id); expect(candidate.deletedMemoIds).toEqual([token(90)]);
    expect(candidate.migration).toEqual(c.migration);
  });
  it('比較は元ID・変換前・項目名のみ、選択は変更しない', () => {
    const c = current(), b = backup(); expect(compareRestoreRow(b.rows[0]!, b, c)).toEqual([]);
    const changed = current(); changed.memos[0]!.body += 'x'; changed.tags[0]!.name = 'changed';
    expect(compareRestoreRow(b.rows[0]!, b, changed)).toEqual(['body', 'tags']);
  });
  it('未選択・不正選択・現存／履歴ID衝突を拒否し自動再採番しない', () => {
    const c = current(), b = backup(); expect(() => planRestore(c, b, [], NOW, ids())).toThrow('selection');
    expect(() => planRestore(c, b, [99], NOW, ids())).toThrow('selection');
    expect(() => planRestore(c, b, [0], NOW, () => token(90))).toThrow('id-collision');
    expect(() => planRestore(c, b, [0], NOW, () => c.memos[0]!.id.toUpperCase())).toThrow('id-collision');
  });
  it('16 MiB超過は全体停止', () => {
    const c = current(), b = backup();
    const many = { ...b, rows: Array.from({ length: 1800 }, (_, index) => ({ ...b.rows[0]!, index, memo: { ...b.rows[0]!.memo!, body: 'x'.repeat(10000) } })) };
    expect(() => planRestore(c, many, many.rows.map(r => r.index), NOW, ids())).toThrow('candidate-size');
  });
  it('保存候補16 MiBちょうどは受理し1バイト超過を拒否', () => {
    const c = current(), b = backup();
    const many = { ...b, rows: Array.from({ length: 1700 }, (_, index) => ({ ...b.rows[0]!, index, memo: { ...b.rows[0]!.memo!, body: 'x'.repeat(9000) } })) };
    const selected = many.rows.map(r => r.index);
    let remaining = 16_777_216 - new TextEncoder().encode(JSON.stringify(planRestore(c, many, selected, NOW, ids()))).byteLength;
    expect(remaining).toBeGreaterThan(0);
    for (const row of many.rows) { const add = Math.min(1000, remaining); row.memo.body += 'x'.repeat(add); remaining -= add; }
    expect(remaining).toBe(0);
    expect(new TextEncoder().encode(JSON.stringify(planRestore(c, many, selected, NOW, ids()))).byteLength).toBe(16_777_216);
    many.rows[0]!.memo.title += 'a'; expect(() => planRestore(c, many, selected, NOW, ids())).toThrow('candidate-size');
  });
});

describe('固定確認と単一保存', () => {
  it.each(['load', 'prepareRestore', 'applyRestore'] as const)('遅延%s中の差替え・取消・連続操作は拒否し、確定候補を維持', async method => {
    const f = saveFixture(current());
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const store = { ...f.store };
    const delay = async () => { entered(); await gate; };
    if (method === 'load') store.load = async () => { await delay(); return f.store.load(); };
    if (method === 'prepareRestore') store.prepareRestore = async (...args) => { await delay(); return f.store.prepareRestore(...args); };
    if (method === 'applyRestore') store.applyRestore = async (...args) => { await delay(); return f.store.applyRestore(...args); };
    const controller = createLocalRestoreController({ store, createId: ids() });
    const fileCommand = { kind: 'file' as const, bytes: bytes(JSON.stringify(envelope())) };
    let pending: Promise<void>;
    if (method === 'load') pending = controller.dispatch(fileCommand);
    else {
      await controller.dispatch(fileCommand);
      await controller.dispatch({ kind: 'select', indexes: [0], selected: true });
      if (method === 'prepareRestore') pending = controller.dispatch({ kind: 'prepare' });
      else { await controller.dispatch({ kind: 'prepare' }); pending = controller.dispatch({ kind: 'confirm' }); }
    }
    await started;
    const before = controller.getState();
    await Promise.all([
      controller.dispatch({ kind: 'reset' }), controller.dispatch(fileCommand),
      controller.dispatch({ kind: 'cancel' }), controller.dispatch({ kind: 'prepare' }),
      controller.dispatch({ kind: 'confirm' }), controller.dispatch({ kind: 'select', indexes: [1], selected: true }),
    ]);
    expect(controller.getState()).toEqual(before); expect(f.storage.writes).toHaveLength(0);
    release(); await pending;
    expect(controller.getState().phase).toBe(method === 'load' ? 'review' : method === 'prepareRestore' ? 'confirmation' : 'applied');
    expect(f.storage.writes).toHaveLength(method === 'applyRestore' ? 1 : 0);
  });
  it.each(['quota', 'after-write', 'readback'] as const)('障害%sはunknown・無自動再送・同request再利用拒否', async fault => {
    const f = saveFixture(current()), original = f.storage.values.get(NEW_STORAGE_KEY);
    const plan = await f.store.prepareRestore(backup(), [0], ids(), current());
    if (fault === 'quota') f.storage.beforeSet = () => { throw new Error('PRIVATE'); };
    if (fault === 'after-write') f.storage.afterSet = () => { throw new Error('PRIVATE'); };
    if (fault === 'readback') f.storage.beforeGet = () => { if (f.storage.writes.length) throw new Error('PRIVATE'); };
    expect(await f.store.applyRestore({ token: plan.token, requestId: token(800) })).toMatchObject({ kind: 'unknown', writeOutcome: 'unverified' });
    expect(f.storage.writes).toHaveLength(fault === 'quota' ? 0 : 1);
    if (fault === 'quota') expect(f.storage.values.get(NEW_STORAGE_KEY)).toBe(original);
    expect(await f.store.applyRestore({ token: plan.token, requestId: token(800) })).toMatchObject({ kind: 'rejected', reason: 'request-id-reused' });
    expect(f.storage.writes).toHaveLength(fault === 'quota' ? 0 : 1);
  });
  it('同じ保存先・共通ロックの別ストア確認が先に適用されれば後続を拒否', async () => {
    const f = saveFixture(current());
    const { createLocalMemoStore } = await import('../src/local-memo-store');
    const second = createLocalMemoStore(f.deps);
    const a = await f.store.prepareRestore(backup(), [0], ids(100), current());
    const b = await second.prepareRestore(backup(), [1], ids(200), current());
    const results = await Promise.all([f.store.applyRestore({ token: a.token, requestId: token(800) }), second.applyRestore({ token: b.token, requestId: token(801) })]);
    expect(results.map(r => r.kind)).toEqual(['written', 'rejected']); expect(f.storage.writes).toHaveLength(1);
  });
  it('旧キー・completeのlegacySnapshotを保持し、未選択は準備前に拒否', async () => {
    const c = current(); c.migration = { status: 'complete', legacySnapshot: '[]' };
    const f = saveFixture(c); f.storage.values.set(OLD_STORAGE_KEY, '[]');
    await expect(f.store.prepareRestore(backup(), [], ids(), c)).rejects.toThrow('selection'); expect(f.storage.writes).toHaveLength(0);
    const plan = await f.store.prepareRestore(backup(), [0], ids(), c);
    expect((await f.store.applyRestore({ token: plan.token, requestId: token(800) })).kind).toBe('written');
    expect(f.storage.values.get(OLD_STORAGE_KEY)).toBe('[]'); expect(JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!).migration).toEqual(c.migration);
  });
  it('診断後の入力バイト変更・返却データ変更から独立する', () => {
    const raw = bytes(JSON.stringify(envelope())), diagnosed = diagnoseBackup(raw); raw.fill(0);
    expect(diagnosed.rows[0]!.memo!.title).toBe('元のタイトル');
    expect(() => { diagnosed.rows[0]!.tagIds.push(token(1)); }).toThrow();
  });
  it('確認前0書込・一回適用・共有A案・他データ不変', async () => {
    const f = saveFixture(current()), b = backup(); const expected = current();
    const plan = await f.store.prepareRestore(b, [0], ids(), expected); expect(f.storage.writes).toHaveLength(0);
    const result = await f.store.applyRestore({ token: plan.token, requestId: token(700) }); expect(result.kind).toBe('written'); expect(f.storage.writes).toHaveLength(1);
    const value = JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!);
    expect(value.memos.slice(0, 2)).toEqual(expected.memos); expect(value.tags).toEqual(expected.tags); expect(value.memoTags.slice(0, 2)).toEqual(expected.memoTags);
    expect(value.deletedMemoIds).toEqual(expected.deletedMemoIds);
    expect((await f.store.applyRestore({ token: plan.token, requestId: token(701) })).kind).toBe('rejected');
    expect(await f.store.saveTag({ requestId: token(700) })).toMatchObject({ kind: 'rejected', reason: 'request-id-reused' });
    expect(f.storage.writes).toHaveLength(1);
  });
  it.each([NEW_STORAGE_KEY, OLD_STORAGE_KEY])('確認後の%s変更で無書込拒否', async key => {
    const f = saveFixture(current()), p = await f.store.prepareRestore(backup(), [0], ids(), current());
    f.storage.values.set(key, 'changed'); expect((await f.store.applyRestore({ token: p.token, requestId: token(700) })).kind).toBe('rejected'); expect(f.storage.writes).toHaveLength(0);
  });
  it.each([null, state(), { ...createPendingMigration('[]', ids()), version: 3, deletedMemoIds: [] }, { version: 99 }])('非v3／pending／不存在で無書込 %j', async value => {
    const f = saveFixture(null); if (value !== null) f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify(value));
    await expect(f.store.prepareRestore(backup(), [0], ids(), current())).rejects.toThrow(); expect(f.storage.writes).toHaveLength(0);
  });
  it('cancel・再準備は古い確認を失効し、二重confirmは一回だけ', async () => {
    const f = saveFixture(current()), controller = createLocalRestoreController({ store: f.store, createId: ids() });
    await controller.dispatch({ kind: 'file', bytes: bytes(JSON.stringify(envelope())) });
    await controller.dispatch({ kind: 'select', indexes: [0], selected: true }); await controller.dispatch({ kind: 'prepare' });
    await controller.dispatch({ kind: 'cancel' }); await controller.dispatch({ kind: 'confirm' }); expect(f.storage.writes).toHaveLength(0);
    await controller.dispatch({ kind: 'prepare' }); await Promise.all([controller.dispatch({ kind: 'confirm' }), controller.dispatch({ kind: 'confirm' })]);
    expect(controller.getState().phase).toBe('applied'); expect(f.storage.writes).toHaveLength(1);
  });
});
