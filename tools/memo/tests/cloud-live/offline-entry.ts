import { runOffline } from './offline-scenario';

// 設定/環境変数/引数から実接続を有効化する経路を作らない。
if (process.argv.length !== 2) throw Error('Only fixed offline execution is allowed');
const evidence = await runOffline();
process.stdout.write(`${JSON.stringify({ mode: 'offline', sql: 'not-run', auth: 'not-run', events: evidence })}\n`);
if (evidence.some(event => event.outcome === 'STOP')) process.exitCode = 1;
