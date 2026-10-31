import { describe, expect, it, vi } from 'vitest';
import { createLocalMemoController } from '../src/local-memo-controller';
import type { LocalControllerDependencies } from '../src/local-memo-controller';
import type { ControllerCommand, Mutation } from '../src/local-app-state';
import type { LocalLoadResult } from '../src/local-data-store';
import { isDirty } from '../src/editor-state';
import { createPendingMigration } from '../src/migration';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../src/local-migration';
import { MEMO, OTHER, TAG, TAG2, NOW, state, token, saveFixture } from './local-save-fixtures';

function fixture(initial = state(), custom?: (store: LocalControllerDependencies['store']) => LocalControllerDependencies['store']) {
  const f = saveFixture(initial);
  const port = custom ? custom(f.store) : f.store;
  const store = { load: vi.fn(port.load), save: vi.fn(port.save), changeState: vi.fn(port.changeState),
    saveTag: vi.fn(port.saveTag), deleteTag: vi.fn(port.deleteTag), deletePermanently: vi.fn(port.deletePermanently), emptyTrash: vi.fn(port.emptyTrash) };
  let n = 100;
  const controller = createLocalMemoController({ store, createId: () => token(++n) });
  return { ...f, store, controller, dispatch: controller.dispatch, get: controller.getState };
}
async function editing(f: ReturnType<typeof fixture>) {
  expect(await f.dispatch({ kind: 'load' })).toEqual({ kind: 'done' });
  expect(await f.dispatch({ kind: 'edit', id: MEMO })).toEqual({ kind: 'done' });
}
async function approve(f: ReturnType<typeof fixture>) {
  const ticket = f.get().confirmation;
  if (!ticket) throw new Error('Expected confirmation');
  return f.dispatch({ kind: 'confirm', token: ticket.token, accepted: true });
}
async function mutate(f: ReturnType<typeof fixture>, operation: Mutation) {
  const result = await f.dispatch({ kind: 'mutate', operation });
  if (result.kind === 'confirmation-required') return approve(f);
  return result;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve };
}
function modify(f: ReturnType<typeof fixture>, update: (value: ReturnType<typeof state>) => void) {
  const value = JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!) as ReturnType<typeof state>;
  update(value); f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify(value));
}

describe('ローカル機能の一連の接続', () => {
  it('読込→検索→詳細→前後→編集→保存→一覧復帰で条件・スクロールを保持', async () => {
    const f = fixture(); await f.dispatch({ kind: 'load' });
    await f.dispatch({ kind: 'query', options: { text: '', selectedTagIds: [TAG], sort: 'created-asc' }, scrollTop: 87.5 });
    await f.dispatch({ kind: 'detail', id: MEMO });
    await f.dispatch({ kind: 'adjacent', direction: 'next' }); expect(f.get().route).toEqual({ kind: 'detail', id: OTHER });
    await f.dispatch({ kind: 'adjacent', direction: 'previous' }); expect(f.get().route).toEqual({ kind: 'detail', id: MEMO });
    await f.dispatch({ kind: 'edit', id: MEMO });
    await f.dispatch({ kind: 'draft', value: { title: ' 保存後 ', body: ' 本文 ', tagIds: [TAG] } });
    await f.dispatch({ kind: 'save' });
    expect(f.get().write.kind).toBe('succeeded'); expect(f.get().route.kind).toBe('detail');
    expect(isDirty(f.get().editor!)).toBe(false); expect(f.get().editorIssue).toBeNull();
    await f.dispatch({ kind: 'list' });
    expect(f.get().route.kind).toBe('list'); expect(f.get().list!.scrollTop).toBe(87.5);
    expect(f.get().list!.result.query).toEqual({ view: 'normal', text: '', selectedTagIds: [TAG], sort: 'created-asc' });
    expect(f.store.save).toHaveBeenCalledTimes(1); expect(f.storage.writes).toHaveLength(1);
    expect(f.get().data!.memos[0]!.title).toBe('保存後');
  });
  it('両キーなしは読込だけでは書かず、明示的な新規保存だけ一回書く', async () => {
    const f = fixture(); f.storage.values.clear();
    await f.dispatch({ kind: 'load' }); expect(f.get().data!.memos).toEqual([]); expect(f.storage.writes).toHaveLength(0);
    await f.dispatch({ kind: 'new' }); const id = f.get().editor!.id;
    await f.dispatch({ kind: 'draft', value: { title: '新規', body: '', tagIds: [] } }); await f.dispatch({ kind: 'save' });
    expect(f.get().data!.memos[0]!.id).toBe(id); expect(f.get().editor!.expectedRevision).toBe(1);
    expect(f.storage.writes).toHaveLength(1);
  });
  it('検索結果外の詳細は勝手に前後メモへ置換しない', async () => {
    const f = fixture(); await f.dispatch({ kind: 'load' });
    await f.dispatch({ kind: 'query', options: { text: '対象外' }, scrollTop: 0 }); await f.dispatch({ kind: 'detail', id: MEMO });
    expect(await f.dispatch({ kind: 'adjacent', direction: 'next' })).toMatchObject({ kind: 'blocked', reason: 'not-in-result' });
    expect(f.get().route).toEqual({ kind: 'detail', id: MEMO });
  });
  it('一覧件数とタグ使用件数は別々に算出する', async () => {
    const f = fixture(); await f.dispatch({ kind: 'load' });
    await f.dispatch({ kind: 'query', options: { text: '元の' }, scrollTop: 0 });
    expect(f.get().list!.result.resultCount).toBe(1); expect(f.get().usage[0]!.count).toBe(2);
  });
});

describe('書込と非同期の安全性', () => {
  it('保存中は追加編集だけ許可し、二重書込・遷移・loadを抑止', async () => {
    const gate = deferred<void>();
    const f = fixture(state(), store => ({ ...store, save: async input => { await gate.promise; return store.save(input); } }));
    await editing(f); const saving = f.dispatch({ kind: 'save' });
    for (const command of [{ kind: 'save' }, { kind: 'list' }, { kind: 'load' },
      { kind: 'mutate', operation: { kind: 'state', id: OTHER, action: 'pin', expectedRevision: 1 } }] as ControllerCommand[]) {
      expect(await f.dispatch(command)).toMatchObject({ kind: 'blocked', reason: 'writing' });
    }
    await f.dispatch({ kind: 'draft', value: { title: '追加入力', body: '\u0000', tagIds: [TAG2] } });
    gate.resolve(); await saving;
    expect(f.store.save).toHaveBeenCalledTimes(1); expect(f.get().editor!.draft.body).toBe('\u0000');
    expect(isDirty(f.get().editor!)).toBe(true); expect(f.get().route.kind).toBe('edit'); expect(f.get().editor!.screen).toBe('edit');
    expect(f.get().editor!.expectedRevision).toBe(4); expect(f.get().editorIssue).toBeNull();
  });
  it('保存中に変更して元へ戻した場合はcleanな詳細へ進む', async () => {
    const gate = deferred<void>();
    const f = fixture(state(), store => ({ ...store, save: async input => { await gate.promise; return store.save(input); } }));
    await editing(f); const raw = f.get().editor!.draft, saving = f.dispatch({ kind: 'save' });
    await f.dispatch({ kind: 'draft', value: { ...raw, title: '一時変更' } });
    await f.dispatch({ kind: 'draft', value: raw }); gate.resolve(); await saving;
    expect(isDirty(f.get().editor!)).toBe(false); expect(f.get().route.kind).toBe('detail');
  });
  it('保存確定後の再読込失敗を独立して保持し、自動再試行しない', async () => {
    const f = fixture(); await editing(f);
    f.store.load.mockResolvedValueOnce({ kind: 'unavailable', reason: 'storage-failure' });
    await f.dispatch({ kind: 'save' });
    expect(f.get().write.kind).toBe('succeeded'); expect(f.get().read).toEqual({ kind: 'failed', reason: 'storage-failure' });
    expect(f.get().editor!.save.kind).toBe('saved'); expect(f.get().editor!.expectedRevision).toBe(4);
    expect(f.store.save).toHaveBeenCalledTimes(1); expect(f.storage.writes).toHaveLength(1);
    expect(await f.dispatch({ kind: 'save' })).toMatchObject({ reason: 'not-ready' });
  });
  it('保存後の再読込待ち中にも追加編集を保持する', async () => {
    const f = fixture(); await editing(f); const gate = deferred<LocalLoadResult>();
    f.store.load.mockReturnValueOnce(gate.promise);
    const saving = f.dispatch({ kind: 'save' });
    await vi.waitFor(() => expect(f.get().write.kind).toBe('succeeded'));
    await f.dispatch({ kind: 'draft', value: { title: '再読込待ちの追加', body: '', tagIds: [] } });
    gate.resolve(await f.store.load()); await saving;
    expect(f.get().route.kind).toBe('edit'); expect(f.get().editor!.draft.title).toBe('再読込待ちの追加'); expect(isDirty(f.get().editor!)).toBe(true);
  });
  it('古いloadが後から戻っても新しいload結果を上書きしない', async () => {
    const f = fixture(); await f.dispatch({ kind: 'load' }); const gate = deferred<LocalLoadResult>();
    f.store.load.mockReturnValueOnce(gate.promise); const old = f.dispatch({ kind: 'load' });
    modify(f, value => { value.memos[0]!.title = '最新'; value.memos[0]!.revision++; });
    await f.dispatch({ kind: 'load' }); gate.resolve({ kind: 'loaded', value: state() });
    expect(await old).toEqual({ kind: 'ignored' }); expect(f.get().data!.memos[0]!.title).toBe('最新');
  });
  it('書込開始以前の遅いloadは、保存後の一覧を上書きしない', async () => {
    const f = fixture(); await editing(f); const gate = deferred<LocalLoadResult>();
    f.store.load.mockReturnValueOnce(gate.promise); const old = f.dispatch({ kind: 'load' });
    await f.dispatch({ kind: 'load' }); await f.dispatch({ kind: 'save' });
    gate.resolve({ kind: 'loaded', value: state() }); expect(await old).toEqual({ kind: 'ignored' });
    expect(f.get().data!.memos[0]!.revision).toBe(4); expect(f.get().editor!.expectedRevision).toBe(4);
  });
  it('ストアの競合拒否を保持し、cleanでも離脱確認を要求する', async () => {
    const f = fixture(); await editing(f); modify(f, value => { value.memos[0]!.revision++; });
    await f.dispatch({ kind: 'save' }); expect(f.get().write).toMatchObject({ kind: 'rejected', reason: 'conflict' });
    expect(isDirty(f.get().editor!)).toBe(false); expect(f.store.load).toHaveBeenCalledTimes(1);
    expect((await f.dispatch({ kind: 'list' })).kind).toBe('confirmation-required'); expect(f.get().confirmation!.reason).toBe('rejected');
  });
  it('書込後例外は不明要求を保持し、読込が一致しても成功扱いしない', async () => {
    const f = fixture(); await editing(f); f.storage.afterSet = () => { throw new Error('PRIVATE'); };
    await f.dispatch({ kind: 'save' }); expect(f.get().write.kind).toBe('unknown'); expect(f.get().unresolved).toHaveLength(1);
    expect(f.store.load).toHaveBeenCalledTimes(1); expect(f.store.save).toHaveBeenCalledTimes(1);
    delete f.storage.afterSet; await f.dispatch({ kind: 'load' });
    expect(f.get().data!.memos[0]!.revision).toBe(4); expect(f.get().write.kind).toBe('unknown');
    expect(f.get().editor!.save.kind).toBe('unknown'); expect(f.get().unresolved).toHaveLength(1);
    expect(f.get().editorIssue).toBe('changed'); expect(f.storage.writes).toHaveLength(1);
  });
  it('ポート例外も不明として保持し、元例外を状態へ混入させない', async () => {
    const f = fixture(); await editing(f); f.store.save.mockRejectedValueOnce(new Error('PRIVATE'));
    await f.dispatch({ kind: 'save' }); expect(f.get().write.kind).toBe('unknown');
    expect(JSON.stringify(f.get())).not.toContain('PRIVATE'); expect(f.get().editor!.unresolved).toHaveLength(1);
  });
  it('未書込の不明結果は明示loadと再確認後だけ新IDで再保存する', async () => {
    const f = fixture(); await editing(f); f.store.save.mockResolvedValueOnce({ kind: 'unknown', reason: 'storage-failure', writeOutcome: 'unverified' });
    await f.dispatch({ kind: 'save' }); const oldId = f.get().unresolved[0]!.requestId;
    await f.dispatch({ kind: 'load' }); expect((await f.dispatch({ kind: 'save' })).kind).toBe('confirmation-required');
    expect(f.store.save).toHaveBeenCalledTimes(1); await approve(f);
    expect(f.store.save).toHaveBeenCalledTimes(2); expect(f.get().unresolved[0]!.requestId).toBe(oldId);
    expect(f.get().write.kind).toBe('succeeded'); expect(f.get().editor!.unresolved).toHaveLength(1);
  });
});

describe('読込による不整合通知と互換性保護', () => {
  it.each(['changed', 'missing', 'trashed', 'missing-tag'] as const)('%sを通知しドラフト・revisionを変えない', async mode => {
    const f = fixture(); await editing(f);
    await f.dispatch({ kind: 'draft', value: { title: ' 未保存 ', body: '\ud800', tagIds: [TAG] } });
    const editor = f.get().editor;
    modify(f, value => {
      if (mode === 'changed') { value.memos[0]!.body = '他更新'; value.memos[0]!.revision++; }
      if (mode === 'trashed') value.memos[0]!.deletedAt = NOW;
      if (mode === 'missing') { value.memos.shift(); value.memoTags = value.memoTags.filter(row => row.memoId !== MEMO); }
      if (mode === 'missing-tag') { value.tags.shift(); value.memoTags = []; }
    });
    await f.dispatch({ kind: 'load' }); expect(f.get().editor).toBe(editor); expect(f.get().editorIssue).toBe(mode);
    expect(await f.dispatch({ kind: 'save' })).toMatchObject({ kind: 'blocked', reason: mode }); expect(f.store.save).not.toHaveBeenCalled();
  });
  it('新規編集IDが別経路で作成されても自動採番し直さない', async () => {
    const f = fixture(); await f.dispatch({ kind: 'load' }); await f.dispatch({ kind: 'new' }); const editor = f.get().editor!;
    modify(f, value => { value.memos.push({ ...value.memos[0]!, id: editor.id }); });
    await f.dispatch({ kind: 'load' }); expect(f.get().editor).toBe(editor); expect(f.get().editorIssue).toBe('id-exists');
  });
  it.each(['legacy', 'pending', 'broken', 'failure', 'locks'])('%sを空データとして扱わず、保存・移行しない', async mode => {
    const f = fixture(); f.storage.values.clear();
    if (mode === 'legacy') f.storage.values.set(OLD_STORAGE_KEY, '[]');
    if (mode === 'pending') f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify(createPendingMigration('[]', () => MEMO)));
    if (mode === 'broken') f.storage.values.set(NEW_STORAGE_KEY, '{}');
    if (mode === 'failure') f.store.load.mockRejectedValueOnce(new Error('PRIVATE'));
    if (mode === 'locks') f.store.load.mockResolvedValueOnce({ kind: 'unavailable', reason: 'locks-unavailable' });
    expect(await f.dispatch({ kind: 'load' })).toMatchObject({ kind: 'blocked' });
    expect(f.get().data).toBeNull(); expect(f.get().list).toBeNull(); expect(f.get().read.kind).toBe('failed');
    expect(await f.dispatch({ kind: 'new' })).toMatchObject({ reason: 'not-ready' }); expect(f.storage.writes).toHaveLength(0);
    if (mode === 'legacy') expect(f.storage.values.get(OLD_STORAGE_KEY)).toBe('[]');
  });
  it('再読込失敗でも以前のデータ・一覧・ドラフトを保持する', async () => {
    const f = fixture(); await editing(f); const before = f.get();
    f.store.load.mockResolvedValueOnce({ kind: 'unavailable', reason: 'invalid-data' }); await f.dispatch({ kind: 'load' });
    expect(f.get().data).toBe(before.data); expect(f.get().list).toBe(before.list); expect(f.get().editor).toBe(before.editor);
    await f.dispatch({ kind: 'draft', value: { ...before.editor!.draft, body: '失敗後の入力' } });
    expect(f.get().editor!.draft.body).toBe('失敗後の入力');
  });
  it('completeの旧キー・移行メタデータを保存・再読込で変更しない', async () => {
    const original = { ...state(), migration: { status: 'complete' as const, legacySnapshot: '[]' } };
    const f = fixture(original); f.storage.values.set(OLD_STORAGE_KEY, '[]'); await editing(f); await f.dispatch({ kind: 'save' });
    expect(f.storage.values.get(OLD_STORAGE_KEY)).toBe('[]');
    expect(JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!).migration).toEqual(original.migration);
  });
});

describe('タグ・状態操作と確認の接続', () => {
  it('タグ作成・改名・ピン・ゴミ箱・復元・タグ削除を同じストアで接続', async () => {
    const f = fixture(); await f.dispatch({ kind: 'load' });
    await mutate(f, { kind: 'save-tag', id: token(20), name: ' 新タグ ', expectedRevision: null });
    await mutate(f, { kind: 'save-tag', id: token(20), name: '改名', expectedRevision: 1 });
    expect(f.get().data!.tags[2]!.name).toBe('改名');
    await mutate(f, { kind: 'state', id: OTHER, action: 'pin', expectedRevision: 1 });
    expect(f.get().data!.memos[1]!.pinnedAt).toBe(NOW);
    await mutate(f, { kind: 'state', id: OTHER, action: 'trash', expectedRevision: 2 });
    expect(f.get().usage[0]!.count).toBe(1);
    await mutate(f, { kind: 'state', id: OTHER, action: 'restore', expectedRevision: 3 });
    expect(f.get().usage[0]!.count).toBe(2);
    await mutate(f, { kind: 'delete-tag', id: TAG, expectedRevision: 1 });
    expect(f.get().data!.tags.some(row => row.id === TAG)).toBe(false);
    expect(f.get().data!.memoTags).toEqual([]); expect(f.get().data!.memos[0]!.revision).toBe(4);
    expect(f.storage.writes).toHaveLength(6);
  });
  it.each([{ kind: 'delete-tag', id: TAG, expectedRevision: 1 }, { kind: 'state', id: OTHER, action: 'trash', expectedRevision: 1 }] satisfies Mutation[])
  ('操作・対象・revisionを確認に固定し、キャンセルでは書かない %j', async operation => {
    const f = fixture(); await f.dispatch({ kind: 'load' });
    const input = { kind: 'mutate' as const, operation };
    const result = await f.dispatch(input); expect(result.kind).toBe('confirmation-required');
    const ticket = f.get().confirmation!;
    expect(ticket.command).toEqual(input); expect(ticket.generation).toBe(f.get().generation); expect(Object.isFrozen(operation)).toBe(false);
    expect(f.storage.writes).toHaveLength(0);
    await f.dispatch({ kind: 'confirm', token: ticket.token, accepted: false }); expect(f.storage.writes).toHaveLength(0);
  });
  it('確認後の対象更新・loadで旧確認は失効する', async () => {
    const f = fixture(); await f.dispatch({ kind: 'load' });
    await f.dispatch({ kind: 'mutate', operation: { kind: 'delete-tag', id: TAG, expectedRevision: 1 } }); const ticket = f.get().confirmation!;
    modify(f, value => { value.tags[0]!.revision++; }); await f.dispatch({ kind: 'load' });
    expect(await f.dispatch({ kind: 'confirm', token: ticket.token, accepted: true })).toMatchObject({ reason: 'stale-confirmation' });
    expect(f.storage.writes).toHaveLength(0);
  });
  it('確認後の未観測revision変更はストアのロック内照合で拒否', async () => {
    const f = fixture(); await f.dispatch({ kind: 'load' });
    await f.dispatch({ kind: 'mutate', operation: { kind: 'delete-tag', id: TAG, expectedRevision: 1 } });
    modify(f, value => { value.tags[0]!.revision++; }); await approve(f);
    expect(f.get().write).toMatchObject({ kind: 'rejected', reason: 'conflict' }); expect(f.storage.writes).toHaveLength(0);
  });
  it('検索条件変更・別確認でも古い確認を実行しない', async () => {
    const f = fixture(); await f.dispatch({ kind: 'load' });
    await f.dispatch({ kind: 'mutate', operation: { kind: 'delete-tag', id: TAG, expectedRevision: 1 } }); const first = f.get().confirmation!;
    await f.dispatch({ kind: 'query', options: {}, scrollTop: 5 });
    expect(await f.dispatch({ kind: 'confirm', token: first.token, accepted: true })).toMatchObject({ reason: 'stale-confirmation' });
    await f.dispatch({ kind: 'mutate', operation: { kind: 'delete-tag', id: TAG2, expectedRevision: 2 } });
    expect(await f.dispatch({ kind: 'confirm', token: first.token, accepted: true })).toMatchObject({ reason: 'stale-confirmation' });
    expect(f.storage.writes).toHaveLength(0);
  });
  it('確認されたコマンドは入力の後続変更から独立する', async () => {
    const f = fixture(); await f.dispatch({ kind: 'load' });
    const operation: Mutation = { kind: 'delete-tag', id: TAG2, expectedRevision: 2 };
    await f.dispatch({ kind: 'mutate', operation }); operation.id = TAG; operation.expectedRevision = 1;
    await approve(f); expect(f.get().data!.tags.map(row => row.id)).toEqual([TAG]);
  });
  it('編集画面での追加操作は抑止し、離脱確認でドラフトを保持する', async () => {
    const f = fixture(); await editing(f); await f.dispatch({ kind: 'draft', value: { title: '未保存', body: '', tagIds: [TAG] } });
    expect(await f.dispatch({ kind: 'mutate', operation: { kind: 'delete-tag', id: TAG, expectedRevision: 1 } })).toMatchObject({ reason: 'editor-active' });
    await f.dispatch({ kind: 'list' }); const old = f.get().confirmation!;
    await f.dispatch({ kind: 'draft', value: { title: '確認後の編集', body: '', tagIds: [TAG] } });
    expect(await f.dispatch({ kind: 'confirm', token: old.token, accepted: true })).toMatchObject({ reason: 'stale-confirmation' });
    await f.dispatch({ kind: 'list' }); await approve(f);
    expect(f.get().retainedEditors[0]!.draft.title).toBe('確認後の編集'); expect(f.get().route.kind).toBe('list');
  });
  it('ストアインスタンスを再生成せず、操作間のrequestId再利用拒否を維持', async () => {
    const f = fixture();
    const controller = createLocalMemoController({ store: f.store, createId: () => token(1) });
    await controller.dispatch({ kind: 'load' });
    await controller.dispatch({ kind: 'mutate', operation: { kind: 'state', id: OTHER, action: 'pin', expectedRevision: 1 } });
    await controller.dispatch({ kind: 'mutate', operation: { kind: 'save-tag', id: token(2), name: '新タグ', expectedRevision: null } });
    expect(controller.getState().write).toMatchObject({ kind: 'rejected', reason: 'request-id-reused' }); expect(f.storage.writes).toHaveLength(1);
  });
  it('追加操作の結果不明も要求を残し、再読込で成功へ昇格しない', async () => {
    const f = fixture(); await f.dispatch({ kind: 'load' });
    f.storage.afterSet = () => { throw new Error('PRIVATE'); };
    await mutate(f, { kind: 'state', id: OTHER, action: 'trash', expectedRevision: 1 });
    expect(f.get().write.kind).toBe('unknown'); const attempt = f.get().unresolved[0]!;
    delete f.storage.afterSet; await f.dispatch({ kind: 'load' });
    expect(f.get().data!.memos[1]!.deletedAt).toBe(NOW); expect(f.get().write.kind).toBe('unknown');
    expect(f.get().unresolved[0]).toBe(attempt); expect(f.storage.writes).toHaveLength(1);
    expect(await f.dispatch({ kind: 'mutate', operation: { kind: 'save-tag', id: token(10), name: '新規', expectedRevision: null } })).toMatchObject({ kind: 'confirmation-required' });
    expect(f.get().confirmation!.reason).toBe('unknown'); expect(f.store.saveTag).not.toHaveBeenCalled();
    await approve(f); expect(f.get().write.kind).toBe('succeeded'); expect(f.get().unresolved[0]).toBe(attempt);
  });
  it('実行済み確認の再利用で二重削除しない', async () => {
    const f = fixture(); await f.dispatch({ kind: 'load' });
    await f.dispatch({ kind: 'mutate', operation: { kind: 'delete-tag', id: TAG2, expectedRevision: 2 } });
    const ticket = f.get().confirmation!; await approve(f);
    expect(await f.dispatch({ kind: 'confirm', token: ticket.token, accepted: true })).toMatchObject({ reason: 'stale-confirmation' });
    expect(f.store.deleteTag).toHaveBeenCalledTimes(1); expect(f.storage.writes).toHaveLength(1);
  });
  it('対象revisionの異なる操作はポート呼出し前に拒否', async () => {
    const f = fixture(); await f.dispatch({ kind: 'load' });
    expect(await f.dispatch({ kind: 'mutate', operation: { kind: 'delete-tag', id: TAG2, expectedRevision: 1 } })).toMatchObject({ reason: 'target-changed' });
    expect(f.store.deleteTag).not.toHaveBeenCalled();
  });
});

describe('公開境界と入力の独立性', () => {
  it('返却状態を凍結し、入力検索条件を凍結・変更しない', async () => {
    const f = fixture(); await f.dispatch({ kind: 'load' });
    const options = { selectedTagIds: [TAG], text: ' 元の ' };
    await f.dispatch({ kind: 'query', options, scrollTop: 1 }); options.selectedTagIds.length = 0;
    expect(f.get().list!.result.query.selectedTagIds).toEqual([TAG]); expect(options.text).toBe(' 元の ');
    expect(Object.isFrozen(options)).toBe(false); expect(Object.isFrozen(f.get().data!.memos[0])).toBe(true);
  });
  it('新規ドラフトの不在タグを通知し、除去後だけ保存を許可', async () => {
    const f = fixture(); await f.dispatch({ kind: 'load' }); await f.dispatch({ kind: 'new' });
    await f.dispatch({ kind: 'draft', value: { title: '新規', body: '', tagIds: [token(99)] } });
    expect(f.get().editorIssue).toBe('missing-tag'); expect(await f.dispatch({ kind: 'save' })).toMatchObject({ reason: 'missing-tag' });
    await f.dispatch({ kind: 'draft', value: { title: '新規', body: '', tagIds: [] } });
    expect(f.get().editorIssue).toBeNull(); await f.dispatch({ kind: 'save' }); expect(f.get().write.kind).toBe('succeeded');
  });
  it('空の保存応答でもbusyを残さず、不明要求とドラフトを保持', async () => {
    const f = fixture(); await editing(f);
    f.store.save.mockResolvedValueOnce(undefined as never); await f.dispatch({ kind: 'save' });
    expect(f.get().write.kind).toBe('unknown'); expect(f.get().editor!.save.kind).toBe('unknown');
    expect(f.get().unresolved).toHaveLength(1);
  });
  it('不正入力やID生成失敗ではポートを呼ばず、実値を返さない', async () => {
    const f = fixture(); await f.dispatch({ kind: 'load' });
    expect(await f.dispatch({ kind: 'edit', id: 'PRIVATE' })).toEqual({ kind: 'blocked', reason: 'invalid-input' });
    const c = createLocalMemoController({ store: f.store, createId: () => { throw new Error('PRIVATE'); } });
    await c.dispatch({ kind: 'load' }); expect(await c.dispatch({ kind: 'new' })).toEqual({ kind: 'blocked', reason: 'invalid-input' });
    expect(f.storage.writes).toHaveLength(0);
  });
});

describe('レビュー回帰：自動再読込の競合と確認の再入', () => {
  const orders = ['old-first', 'new-first'] as const;
  const outcomes = ['success', 'failure'] as const;
  const cases = outcomes.flatMap(oldOutcome => outcomes.flatMap(newOutcome => orders.map(order => ({ oldOutcome, newOutcome, order }))));
  it.each(cases)('保存後load=$oldOutcome、後続load=$newOutcome、完了順=$orderでも最新世代だけを反映', async ({ oldOutcome, newOutcome, order }) => {
    const f = fixture(); await editing(f);
    const automatic = deferred<LocalLoadResult>(), manual = deferred<LocalLoadResult>();
    f.store.load.mockReturnValueOnce(automatic.promise).mockReturnValueOnce(manual.promise);
    const saving = f.dispatch({ kind: 'save' });
    await vi.waitFor(() => expect(f.store.load).toHaveBeenCalledTimes(2));
    expect(f.get().write.kind).toBe('succeeded'); expect(f.get().read.kind).toBe('loading');
    const savedEditor = f.get().editor, beforeData = f.get().data;
    const oldSnapshot = JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!) as ReturnType<typeof state>;
    const newSnapshot = structuredClone(oldSnapshot); newSnapshot.memos[0]!.title = '後続読込の値'; newSnapshot.memos[0]!.revision++;
    const oldResult: LocalLoadResult = oldOutcome === 'success' ? { kind: 'loaded', value: oldSnapshot }
      : { kind: 'unavailable', reason: 'storage-failure' };
    const newResult: LocalLoadResult = newOutcome === 'success' ? { kind: 'loaded', value: newSnapshot }
      : { kind: 'unavailable', reason: 'invalid-data' };
    const loading = f.dispatch({ kind: 'load' });
    expect(f.store.load).toHaveBeenCalledTimes(3);
    if (order === 'old-first') {
      automatic.resolve(oldResult); await saving;
      // 古い成功でもreadyへ進まず、古い失敗でも最新loadをfailedにしない。
      expect(f.get().read.kind).toBe('loading'); expect(f.get().data).toBe(beforeData);
      manual.resolve(newResult); await loading;
    } else {
      manual.resolve(newResult); await loading; const latest = f.get();
      automatic.resolve(oldResult); await saving;
      expect(f.get()).toBe(latest);
    }
    expect(f.get().write.kind).toBe('succeeded'); expect(f.get().editor).toBe(savedEditor);
    expect(f.get().editor!.expectedRevision).toBe(4); expect(f.store.save).toHaveBeenCalledTimes(1);
    expect(f.storage.writes).toHaveLength(1);
    if (newOutcome === 'success') {
      expect(f.get().read.kind).toBe('ready'); expect(f.get().data!.memos[0]!.title).toBe('後続読込の値');
      expect(f.get().list!.result.items.find(row => row.memo.id === MEMO)!.memo.title).toBe('後続読込の値');
      expect(f.get().editorIssue).toBe('changed');
    } else {
      expect(f.get().read).toEqual({ kind: 'failed', reason: 'invalid-data' }); expect(f.get().data).toBe(beforeData);
    }
  });
  it('古い自動loadのPromise拒否も最新の成功を上書きしない', async () => {
    const f = fixture(); await editing(f);
    let reject!: (error: Error) => void;
    const old = new Promise<LocalLoadResult>((_resolve, fail) => { reject = fail; });
    f.store.load.mockReturnValueOnce(old);
    const saving = f.dispatch({ kind: 'save' }); await vi.waitFor(() => expect(f.store.load).toHaveBeenCalledTimes(2));
    await f.dispatch({ kind: 'load' }); const latest = f.get();
    reject(new Error('PRIVATE')); await saving;
    expect(f.get()).toBe(latest); expect(f.get().read.kind).toBe('ready'); expect(f.get().write.kind).toBe('succeeded');
  });
  it('最新loadのPromise拒否後に古い自動loadが成功してもfailedを保持', async () => {
    const f = fixture(); await editing(f); const old = deferred<LocalLoadResult>();
    f.store.load.mockReturnValueOnce(old.promise);
    const saving = f.dispatch({ kind: 'save' }); await vi.waitFor(() => expect(f.store.load).toHaveBeenCalledTimes(2));
    f.store.load.mockRejectedValueOnce(new Error('PRIVATE')); await f.dispatch({ kind: 'load' }); const latest = f.get();
    old.resolve({ kind: 'loaded', value: state() }); await saving;
    expect(f.get()).toBe(latest); expect(f.get().read).toEqual({ kind: 'failed', reason: 'storage-failure' });
    expect(f.get().write.kind).toBe('succeeded');
  });
  it('同一確認の並行実行・microtask再入・ポート内再入でも削除は一回だけ', async () => {
    const f = fixture(); await f.dispatch({ kind: 'load' });
    await f.dispatch({ kind: 'mutate', operation: { kind: 'delete-tag', id: TAG2, expectedRevision: 2 } });
    const token = f.get().confirmation!.token, gate = deferred<void>();
    const original = f.store.deleteTag.getMockImplementation()!;
    let reentered: ReturnType<typeof f.dispatch> | undefined;
    f.store.deleteTag.mockImplementationOnce(async input => {
      reentered = f.dispatch({ kind: 'confirm', token, accepted: true });
      await gate.promise; return original(input);
    });
    const first = f.dispatch({ kind: 'confirm', token, accepted: true });
    const second = f.dispatch({ kind: 'confirm', token, accepted: true });
    const microtask = Promise.resolve().then(() => f.dispatch({ kind: 'confirm', token, accepted: true }));
    for (const result of await Promise.all([second, microtask, reentered!])) expect(result).toEqual({ kind: 'blocked', reason: 'writing' });
    expect(f.store.deleteTag).toHaveBeenCalledTimes(1); expect(f.get().confirmation).toBeNull();
    gate.resolve(); await first;
    expect(f.storage.writes).toHaveLength(1); expect(f.store.deleteTag).toHaveBeenCalledTimes(1);
    expect(await f.dispatch({ kind: 'confirm', token, accepted: true })).toMatchObject({ reason: 'stale-confirmation' });
  });
  it('結果不明後の再保存確認を二重実行しても追加saveは一回だけ', async () => {
    const f = fixture(); await editing(f);
    f.store.save.mockResolvedValueOnce({ kind: 'unknown', reason: 'storage-failure', writeOutcome: 'unverified' });
    await f.dispatch({ kind: 'save' }); await f.dispatch({ kind: 'load' }); await f.dispatch({ kind: 'save' });
    const token = f.get().confirmation!.token, gate = deferred<void>(), original = f.store.save.getMockImplementation()!;
    f.store.save.mockImplementationOnce(async input => { await gate.promise; return original(input); });
    const first = f.dispatch({ kind: 'confirm', token, accepted: true });
    expect(await f.dispatch({ kind: 'confirm', token, accepted: true })).toMatchObject({ reason: 'writing' });
    gate.resolve(); await first;
    expect(f.store.save).toHaveBeenCalledTimes(2); expect(f.storage.writes).toHaveLength(1); expect(f.get().unresolved).toHaveLength(1);
  });
  it('保存Promise解決後settleSave直前の編集を最新ドラフトとして保持する', async () => {
    const f = fixture(); await editing(f); const original = f.store.save.getMockImplementation()!;
    f.store.save.mockImplementationOnce(input => {
      const result = original(input);
      // await側の継続より先に登録し、解決済み応答の反映直前へ編集を差し込む。
      void result.then(() => f.dispatch({ kind: 'draft', value: { title: '応答直前の編集', body: '\u0000', tagIds: [TAG2] } }));
      return result;
    });
    await f.dispatch({ kind: 'save' });
    expect(f.get().editor!.draft.title).toBe('応答直前の編集'); expect(f.get().editor!.draft.body).toBe('\u0000');
    expect(isDirty(f.get().editor!)).toBe(true); expect(f.get().route.kind).toBe('edit');
    expect(f.get().data!.memos[0]!.title).toBe('元のタイトル'); expect(f.get().editor!.expectedRevision).toBe(4);
    expect(f.store.save).toHaveBeenCalledTimes(1);
  });
});
