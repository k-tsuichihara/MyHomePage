import { expect, it, vi } from 'vitest';
import { createDuplicateEditor } from '../src/memo-duplicate';
import { createLocalMemoController } from '../src/local-memo-controller';
import { isDirty } from '../src/editor-state';
import { DUPLICATE_DRAFT_ID } from '../src/memo-duplicate';
import { NEW_STORAGE_KEY, OLD_STORAGE_KEY } from '../src/local-migration';
import { MEMO, OTHER, TAG, NOW, state, token, saveFixture } from './local-save-fixtures';

function fixture(createId?: () => string) {
  const f = saveFixture(); let next = 100;
  const generate = vi.fn(createId ?? (() => token(++next)));
  const controller = createLocalMemoController({ store: f.store, createId: generate });
  return { ...f, controller, send: controller.dispatch, get: controller.getState, generate };
}
async function copy(f: ReturnType<typeof fixture>) {
  await f.send({ kind: 'load' }); return f.send({ kind: 'duplicate', id: MEMO });
}
function modify(f: ReturnType<typeof fixture>, change: (value: ReturnType<typeof state>) => void) {
  const value = JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!) as ReturnType<typeof state>;
  change(value); f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify(value));
}

it('コピー値は原入力と独立し、空baselineによって直後から未保存となる', () => {
  const source = { memo: state().memos[0]!, tagIds: [TAG] };
  const editor = createDuplicateEditor('copy-session', source);
  source.memo.title = '後続変更'; source.tagIds.length = 0;
  expect(editor.draft).toEqual({ title: '元のタイトル', body: ' 本文\n', tagIds: [TAG] });
  expect(editor.expectedRevision).toBeNull(); expect(isDirty(editor)).toBe(true);
});
it('ゴミ箱を純粋な複製入口でも拒否する', () => {
  const memo = { ...state().memos[0]!, deletedAt: NOW };
  expect(() => createDuplicateEditor('session', { memo, tagIds: [] })).toThrow();
});
it('保存前は書込・永続ID採番0件、明示保存だけ新規作成し元メモを保護', async () => {
  const f = fixture(); const before = f.storage.values.get(NEW_STORAGE_KEY);
  expect(await copy(f)).toEqual({ kind: 'done' });
  expect(f.generate).not.toHaveBeenCalled(); expect(f.storage.writes).toHaveLength(0);
  expect(f.storage.values.get(NEW_STORAGE_KEY)).toBe(before);
  await f.send({ kind: 'save' });
  expect(f.get().write.kind).toBe('succeeded');
  const saved = f.get().data!.memos.find(row => row.id === token(102))!;
  expect(saved).toMatchObject({ title: '元のタイトル', body: ' 本文\n', revision: 1, createdAt: NOW, updatedAt: NOW,
    pinnedAt: null, deletedAt: null, lastRequestId: null });
  expect(f.get().data!.memos.find(row => row.id === MEMO)).toEqual(state().memos[0]);
  expect(f.get().data!.memoTags).toContainEqual({ memoId: saved.id, tagId: TAG });
  expect(f.storage.writes).toHaveLength(1);
});
it.each(['list', 'duplicate'] as const)('複製直後の%sは確認し、キャンセルで入力を保持', async kind => {
  const f = fixture(); await copy(f); const editor = f.get().editor;
  const result = await f.send(kind === 'list' ? { kind } : { kind, id: OTHER });
  expect(result.kind).toBe('confirmation-required');
  await f.send({ kind: 'confirm', token: f.get().confirmation!.token, accepted: false });
  expect(f.get().editor).toBe(editor); expect(f.storage.writes).toHaveLength(0);
});
it('既存編集中の未保存値をコピーせず、承認後に保存済み値を使う', async () => {
  const f = fixture(); await f.send({ kind: 'load' }); await f.send({ kind: 'edit', id: MEMO });
  await f.send({ kind: 'draft', value: { title: '未保存', body: '', tagIds: [] } });
  await f.send({ kind: 'duplicate', id: MEMO }); const ticket = f.get().confirmation!;
  await f.send({ kind: 'confirm', token: ticket.token, accepted: true });
  expect(f.get().editor!.draft.title).toBe('元のタイトル');
  expect(f.get().retainedEditors[0]!.draft.title).toBe('未保存');
  expect(await f.send({ kind: 'confirm', token: ticket.token, accepted: true })).toMatchObject({ reason: 'stale-confirmation' });
});
it('離脱確認後の編集と再読込は確認を失効させ、コピーを上書きしない', async () => {
  const f = fixture(); await copy(f); await f.send({ kind: 'list' }); const ticket = f.get().confirmation!;
  await f.send({ kind: 'draft', value: { title: '追加入力', body: ' ', tagIds: [TAG] } });
  modify(f, value => { value.memos[0]!.title = '別タブ変更'; }); await f.send({ kind: 'load' });
  expect(await f.send({ kind: 'confirm', token: ticket.token, accepted: true })).toMatchObject({ reason: 'stale-confirmation' });
  expect(f.get().editor!.draft.title).toBe('追加入力'); expect(f.generate).not.toHaveBeenCalled();
});
it.each(['trashed', 'missing', 'failed'] as const)('%sからは複製せず書かない', async mode => {
  const f = fixture();
  if (mode === 'trashed') modify(f, value => { value.memos[0]!.deletedAt = NOW; });
  if (mode === 'missing') modify(f, value => { value.memos = value.memos.filter(row => row.id !== MEMO); value.memoTags = value.memoTags.filter(row => row.memoId !== MEMO); });
  if (mode === 'failed') f.storage.beforeGet = () => { throw new Error('synthetic'); };
  await f.send({ kind: 'load' }); expect((await f.send({ kind: 'duplicate', id: MEMO })).kind).toBe('blocked');
  expect(f.get().editor).toBeNull(); expect(f.storage.writes).toHaveLength(0);
});
it('ID衝突は既存saveで拒否し、上書き・再採番・ドラフト破棄しない', async () => {
  let n = 0; const f = fixture(() => ++n === 1 ? token(200) : MEMO);
  await copy(f); await f.send({ kind: 'save' });
  expect(f.get().write).toMatchObject({ kind: 'rejected', reason: 'id-exists' });
  expect(f.get().editor!.draft.title).toBe('元のタイトル'); expect(f.generate).toHaveBeenCalledTimes(2);
  expect(f.storage.writes).toHaveLength(0);
  expect(f.get().editor!.id).toBe(MEMO);
  expect(f.get().write).toMatchObject({ attempt: { input: { id: MEMO, expectedRevision: null } } });
  await f.send({ kind: 'load' }); expect(f.get().editorIssue).toBe('id-exists');
  expect(await f.send({ kind: 'save' })).toMatchObject({ reason: 'id-exists' });
  expect(f.generate).toHaveBeenCalledTimes(2);
});
it.each(['quota', 'after-write', 'readback'] as const)('%sでも結果不明を保持し自動再送しない', async mode => {
  const f = fixture(); await copy(f);
  if (mode === 'quota') f.storage.beforeSet = () => { throw new Error('QuotaExceededError'); };
  if (mode === 'after-write') f.storage.afterSet = () => { throw new Error('synthetic'); };
  if (mode === 'readback') f.storage.afterSet = () => { f.storage.beforeGet = () => { throw new Error('synthetic'); }; };
  await f.send({ kind: 'save' }); expect(f.get().write.kind).toBe('unknown');
  expect(f.get().editor!.draft.title).toBe('元のタイトル'); expect(f.get().unresolved).toHaveLength(1);
  expect(f.storage.writes.length).toBe(mode === 'quota' ? 0 : 1);
  expect((await f.send({ kind: 'save' })).kind).toBe('blocked');
});
it('二重保存を一回に制限し、保存中追加編集を消さない', async () => {
  const f = fixture(); await copy(f);
  const pending = f.send({ kind: 'save' });
  expect(f.get().editor!.id).toBe(token(102));
  expect(f.get().editor!.save).toMatchObject({ attempt: { request: { id: token(102) } } });
  expect(await f.send({ kind: 'save' })).toMatchObject({ reason: 'writing' });
  expect(await f.send({ kind: 'duplicate', id: MEMO })).toMatchObject({ reason: 'writing' });
  await f.send({ kind: 'draft', value: { title: '追加', body: ' ', tagIds: [TAG] } });
  expect(f.get().editor!.id).toBe(token(102));
  expect(f.get().route).toEqual({ kind: 'edit', id: token(102) });
  await pending; expect(f.get().route.kind).toBe('edit'); expect(isDirty(f.get().editor!)).toBe(true);
  expect(f.get().editor!.save.kind).toBe('saved');
  expect(f.get().editor!.draft.title).toBe('追加'); expect(f.storage.writes).toHaveLength(1);
});
it('旧キー・移行snapshotを保持して既存経路から保存', async () => {
  const f = fixture();
  const legacy = JSON.stringify([{ id: 'old', title: '旧', text: '', createdAt: NOW, updatedAt: NOW }]);
  f.storage.values.set(OLD_STORAGE_KEY, legacy);
  modify(f, value => { value.migration = { status: 'complete', legacySnapshot: legacy }; });
  await copy(f); await f.send({ kind: 'save' });
  expect(f.storage.values.get(OLD_STORAGE_KEY)).toBe(legacy);
  expect(JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!).migration).toEqual({ status: 'complete', legacySnapshot: legacy });
});
it('保存前の別タブ作成によるID衝突も書き込まず拒否する', async () => {
  const f = fixture(); await copy(f);
  modify(f, value => { value.memos.push({ ...value.memos[1]!, id: token(102), title: '別タブの新規' }); });
  await f.send({ kind: 'save' });
  expect(f.get().write).toMatchObject({ kind: 'rejected', reason: 'id-exists' });
  expect(f.storage.writes).toHaveLength(0);
  expect(JSON.parse(f.storage.values.get(NEW_STORAGE_KEY)!).memos[2].title).toBe('別タブの新規');
});
it('複製後のタグ削除はドラフトを維持し保存を拒否する', async () => {
  const f = fixture(); await copy(f);
  modify(f, value => { value.tags = []; value.memoTags = []; });
  await f.send({ kind: 'save' });
  expect(f.get().write).toMatchObject({ kind: 'rejected', reason: 'invalid-tag' });
  expect(f.get().editor!.draft.tagIds).toEqual([TAG]); expect(f.storage.writes).toHaveLength(0);
});
it.each(['pending', 'invalid'] as const)('%sへ変化した保存先を複製で初期化しない', async mode => {
  const f = fixture(); await copy(f);
  if (mode === 'invalid') f.storage.values.set(NEW_STORAGE_KEY, '{');
  else f.storage.values.set(NEW_STORAGE_KEY, JSON.stringify({ ...state(), migration: { status: 'pending', legacySnapshot: '[]' } }));
  const raw = f.storage.values.get(NEW_STORAGE_KEY);
  await f.send({ kind: 'save' });
  expect(f.get().write.kind).toBe('rejected'); expect(f.get().editor!.draft.title).toBe('元のタイトル');
  expect(f.storage.values.get(NEW_STORAGE_KEY)).toBe(raw); expect(f.storage.writes).toHaveLength(0);
});

it.each(['saved', 'rejected', 'unknown'] as const)('初回保存%sでeditor・route・送信IDを開始時から一致させる', async outcome => {
  const f = fixture(); await copy(f);
  if (outcome === 'rejected') modify(f, value => { value.tags = []; value.memoTags = []; });
  if (outcome === 'unknown') f.storage.beforeSet = () => { throw new Error('synthetic quota'); };
  const pending = f.send({ kind: 'save' });
  const writing = f.get();
  expect(writing.editor!.id).toBe(token(102));
  expect(writing.editor!.id).not.toBe(DUPLICATE_DRAFT_ID);
  expect(writing.route).toEqual({ kind: 'edit', id: token(102) });
  expect(writing.editor!.save).toMatchObject({ kind: 'saving', attempt: { request: { id: token(102), expectedRevision: null } } });
  expect(writing.write).toMatchObject({ kind: 'writing', attempt: { input: { id: token(102), requestId: token(101) } } });
  expect(await f.send({ kind: 'save' })).toMatchObject({ reason: 'writing' });
  await pending;
  expect(f.get().editor!.id).toBe(token(102));
  expect(f.get().route).toMatchObject({ id: token(102) });
  expect(f.get().editor!.save.kind).toBe(outcome);
  if (outcome === 'saved') expect(f.get().write.kind).toBe('succeeded');
});

it('書込前例外の結果不明後、loadと明示承認した再保存で永続IDを維持する', async () => {
  const f = fixture(); await copy(f);
  f.storage.beforeSet = () => { throw new Error('synthetic quota'); };
  await f.send({ kind: 'save' });
  expect(f.get().editor!.save).toMatchObject({ kind: 'unknown', attempt: { request: { id: token(102), requestId: token(101) } } });
  delete f.storage.beforeSet;
  // 仮IDと同値の実在メモがあっても、初回採番済みの新IDとは混同しない。
  modify(f, value => { value.memos.push({ ...value.memos[1]!, id: DUPLICATE_DRAFT_ID }); });
  await f.send({ kind: 'load' });
  expect(f.get().editorIssue).toBeNull(); expect(f.get().editor!.id).toBe(token(102));
  expect(f.storage.writes).toHaveLength(0);
  expect((await f.send({ kind: 'save' })).kind).toBe('confirmation-required');
  const ticket = f.get().confirmation!;
  const pending = f.send({ kind: 'confirm', token: ticket.token, accepted: true });
  expect(f.get().write).toMatchObject({ kind: 'writing', attempt: { input: { id: token(102), requestId: token(103), expectedRevision: null } } });
  expect(await f.send({ kind: 'confirm', token: ticket.token, accepted: true })).toMatchObject({ reason: 'writing' });
  await pending;
  expect(f.get().editor!.save.kind).toBe('saved'); expect(f.get().write.kind).toBe('succeeded');
  expect(f.get().unresolved[0]!.input).toMatchObject({ id: token(102), requestId: token(101) });
  expect(f.get().editor!.unresolved[0]!.request.id).toBe(token(102));
  expect(f.storage.writes).toHaveLength(1); expect(f.generate).toHaveBeenCalledTimes(3);
});

it('書込済み結果不明後のloadは実IDの存在を通知し、仮IDへの再保存を発行しない', async () => {
  const f = fixture(); await copy(f);
  f.storage.afterSet = () => { throw new Error('synthetic response lost'); };
  await f.send({ kind: 'save' }); delete f.storage.afterSet;
  await f.send({ kind: 'load' });
  expect(f.get().editorIssue).toBe('id-exists'); expect(f.get().editor!.id).toBe(token(102));
  expect(f.get().editor!.save).toMatchObject({ kind: 'unknown', attempt: { request: { id: token(102) } } });
  expect(await f.send({ kind: 'save' })).toMatchObject({ kind: 'confirmation-required' });
  const ticket = f.get().confirmation!;
  expect(await f.send({ kind: 'confirm', token: ticket.token, accepted: true })).toMatchObject({ reason: 'id-exists' });
  expect(f.storage.writes).toHaveLength(1); expect(f.generate).toHaveBeenCalledTimes(2);
});
it('保存拒否後も採番済みIDを保持し、条件を直した次の明示保存で使用する', async () => {
  const f = fixture(); await copy(f);
  modify(f, value => { value.tags = []; value.memoTags = []; });
  await f.send({ kind: 'save' });
  expect(f.get().editor!.id).toBe(token(102));
  modify(f, value => { value.tags = state().tags; }); await f.send({ kind: 'load' });
  expect(f.get().editorIssue).toBeNull(); expect(f.get().editor!.save.kind).toBe('rejected');
  await f.send({ kind: 'save' });
  expect(f.get().write).toMatchObject({ kind: 'succeeded', attempt: { input: { id: token(102), requestId: token(103), expectedRevision: null } } });
  expect(f.get().editor!.save.kind).toBe('saved'); expect(f.get().editor!.id).toBe(token(102));
  expect(f.storage.writes).toHaveLength(1); expect(f.generate).toHaveBeenCalledTimes(3);
});
