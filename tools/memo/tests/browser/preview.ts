import { mountMemoPreview } from '../../src/ui/memo-preview';
import { createPreviewEnvironment } from './preview-memory';
import { createMigrationEnvironment } from './migration-memory';
import { createLocalMigrationController } from '../../src/local-migration-controller';
import { mountMigrationPreview } from '../../src/ui/migration-preview';
import { createLocalBackup } from '../../src/local-backup';
import { mountBackupPreview } from '../../src/ui/backup-preview';
import { mountRestorePreview } from '../../src/ui/restore-preview';

// アプリ側でも永続APIを利用不能にする。既存キーやCookieの内容は一切読まない。
const denied: string[] = [];
Object.defineProperty(window, '__previewDeniedAPIs', { value: denied });
const deny = (name: string) => () => { denied.push(name); throw new Error('API is disabled in memory preview'); };
for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookieStore']) {
  Object.defineProperty(window, name, { configurable: false, get: deny(name) });
}
Object.defineProperty(Document.prototype, 'cookie', { configurable: false, get: deny('cookie'), set: deny('cookie') });
for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker']) {
  Object.defineProperty(window, name, { configurable: false, value: deny(name) });
}
Object.defineProperty(navigator, 'sendBeacon', { configurable: false, value: deny('sendBeacon') });
if ('serviceWorker' in navigator) Object.defineProperty(navigator, 'serviceWorker', { configurable: false, get: deny('serviceWorker') });
if ('storage' in navigator) Object.defineProperty(navigator, 'storage', { configurable: false, get: deny('storage') });

const requested = new URL(location.href).searchParams.get('scenario') ?? 'normal';
const scenario = ['normal', 'slow', 'slow-load', 'slow-mutation', 'rejected', 'unknown', 'reload-failure',
  'delete', 'delete-slow', 'delete-unknown', 'delete-quota', 'delete-readback', 'backup'].includes(requested) ? requested : 'normal';
const migrationScenario = ['legacy', 'empty', 'invalid', 'pending', 'broken-pending', 'interrupted', 'readback-failure', 'no-locks',
  ...['empty', 'existing', 'migrated', 'recovered'].flatMap(source => [`handoff-${source}-pending`, `handoff-${source}-invalid`])].includes(requested) ? requested : null;
const environment = migrationScenario ? createMigrationEnvironment(migrationScenario) : createPreviewEnvironment(scenario);
let backupMounted = false;
const enter = async () => {
  await environment.controller.dispatch({ kind: 'load' });
  if (environment.controller.getState().read.kind !== 'ready') return false;
  if (!backupMounted) {
    mountBackupPreview(document, createLocalBackup({ ...environment.migration, now: () => new Date().toISOString() }));
    backupMounted = true;
    if ('restore' in environment) mountRestorePreview(document, environment.restore);
  }
  mountMemoPreview(document, environment.controller);
  return true;
};
if (scenario.startsWith('delete') || scenario === 'backup') {
  // 固定の合成v3だけを読込検証して入場する。旧v2移行診断の拒否契約は変えない。
  document.querySelector('.notice')!.textContent = '完全削除の隔離検証専用。合成メモリv3のみ。実データ・実保存先・認証・音声には接続しません。';
  void enter().then(ready => {
    document.getElementById('migration-view')!.hidden = ready;
    document.getElementById('memo-app')!.hidden = !ready;
    if (!ready) document.getElementById('migration-status')!.textContent = 'v3の読込検証に失敗したため停止しました。';
  });
} else mountMigrationPreview(document, createLocalMigrationController(environment.migration), enter);
