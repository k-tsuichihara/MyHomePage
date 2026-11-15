import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { createProfileOwner, prepareProfileBase } from '../tests/persistence/profile-guard';
import { initializeContext, runOwnedCase } from '../tests/persistence/lifecycle';
import { prepareProductPreview, productPreviewOptions } from './product-preview';

declare const __MEMO_PREVIEW_CLOUD__: boolean;
const cloud = __MEMO_PREVIEW_CLOUD__;

// 既存cloud起動をlocalでも共有する。モードはbuild時に固定し、CLI/envでは指定させない。
if (process.argv.length !== 2) throw new Error('Custom preview arguments forbidden');
const root = new URL('../../', import.meta.url);
if (cloud) {
  const { verifyAuthArtifact } = await import(new URL('scripts/auth-sdk-patch.mjs', root).href);
  await verifyAuthArtifact(fileURLToPath(root), fileURLToPath(new URL('.product/cloud/memo-app.js', root)));
}
const owner = await createProfileOwner(await prepareProfileBase(fileURLToPath(root))), profile = await owner.create();
await runOwnedCase(owner, profile, async () => {
  await initializeContext(() => chromium.launchPersistentContext(profile, productPreviewOptions(cloud)), async context => {
    const url = await prepareProductPreview(context, root, cloud);
    const page = await context.newPage();
    // HTTPSの製品originをローカル資産から応答し、公開・HTTPサーバー・証明書変更を行わない。
    await page.goto(url);
    if (!cloud) process.stdout.write('Local product UAT: close the browser to finish. Dedicated test data is deleted on normal exit.\n');
    await new Promise<void>(resolve => context.once('close', () => resolve()));
  });
}, () => { process.stderr.write('Product preview stopped; owned profile preserved. No automatic retry.\n'); });
