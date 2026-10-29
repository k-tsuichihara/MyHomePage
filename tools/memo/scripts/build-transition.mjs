import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url), out = new URL('.transition/', root);
await mkdir(out, { recursive: true });
// 公開中の旧JSをバイト変更せず試験用出力へコピーする。公開ファイル自体は編集しない。
await copyFile(new URL('js/memo.js', root), new URL('legacy.js', out));
const preview = await readFile(new URL('tests/browser/preview.html', root), 'utf8');
const legacy = '<div id="legacy-app" hidden><form id="memo-form"><input id="title"><textarea id="memo-text" maxlength="500"></textarea><button id="memo-submit-btn">追加</button><button type="button" id="memo-cancel-btn" hidden>編集キャンセル</button></form><button id="memo-clear-all-btn">すべて削除</button><ul id="memo-list"></ul><p id="memo-empty">空です</p></div>';
for (const release of ['sim-r1', 'sim-r2']) {
  await build({ entryPoints: [fileURLToPath(new URL('tests/release-transition/entry.ts', root))], outfile: fileURLToPath(new URL(`${release}.js`, out)), bundle: true, platform: 'browser', format: 'esm', target: 'es2022', define: { __RELEASE_ID__: JSON.stringify(release) } });
  await writeFile(new URL(`${release}.css`, out), `:root{--transition-release:${release}}\n[hidden]{display:none!important}\n${await readFile(new URL('tests/browser/preview.css', root), 'utf8')}`);
  for (const mode of ['seed', 'legacy', 'new', 'maintenance']) {
    let html = mode === 'new' ? preview.replace('<html lang="ja">', `<html lang="ja" data-release="${release}" data-mode="new">`)
      .replace('<body>', '<body><p id="boot-status" role="status">未起動：必要資産が未確認です。</p>')
      : `<!doctype html><html lang="ja" data-release="${release}" data-mode="${mode}"><head><meta charset="utf-8"><link rel="stylesheet" href="/preview.css"></head><body><p id="boot-status">未起動：必要資産が未確認です。</p>${mode === 'legacy' ? legacy : '<section id="maintenance" hidden></section>'}<script type="module" src="/preview.js"></script></body></html>`;
    html = html.replace('/preview.css', `/assets/${release}/style.css`).replace('/preview.js', `/assets/${release}/app.js`)
      .replace('検証専用・メモリ保存のみ。再読込で初期状態に戻ります。実データ・認証・音声・完全削除には接続しません。', '切り替えシミュレーション専用。合成データをテスト所有profileに保存します。本番接続ではありません。');
    await writeFile(new URL(`${mode}-${release}.html`, out), html);
  }
}
await build({ entryPoints: [fileURLToPath(new URL('tests/release-transition/run.ts', root))], outfile: fileURLToPath(new URL('run.mjs', out)), bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22' });
