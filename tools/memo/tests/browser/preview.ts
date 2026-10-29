import { mountMemoPreview } from '../../src/ui/memo-preview';
import { createPreviewEnvironment } from './preview-memory';
import { createMigrationEnvironment } from './migration-memory';
import { createLocalMigrationController } from '../../src/local-migration-controller';
import { mountMigrationPreview } from '../../src/ui/migration-preview';

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
const scenario = ['normal', 'slow', 'slow-load', 'slow-mutation', 'rejected', 'unknown', 'reload-failure'].includes(requested) ? requested : 'normal';
const migrationScenario = ['legacy', 'empty', 'invalid', 'pending', 'broken-pending', 'interrupted', 'readback-failure', 'no-locks'].includes(requested) ? requested : null;
const environment = migrationScenario ? createMigrationEnvironment(migrationScenario) : createPreviewEnvironment(scenario);
mountMigrationPreview(document, createLocalMigrationController(environment.migration), () => mountMemoPreview(document, environment.controller));
