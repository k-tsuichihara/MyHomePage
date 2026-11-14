import { createMemoSdkAuth } from './auth-sdk';
import { createMemoRpcSender, MEMO_RPC_ORIGIN } from './cloud-rpc-sender';
import { createCloudController } from './cloud-controller';
import { createStorageTargetController } from './storage-target-controller';
import { createProductLocalApp } from './product-local-app';
import { createProductBrowserLocalDependencies } from './product-browser-local';
import type { ProductBrowserEnvironment } from './product-browser-local';
import type { AuthStorage } from './auth-client';
import type { AuthenticatedRpcSender } from './auth-session';

/** 製品用composition。試験用Permitを転用せず、既存製品page境界＋専用Authキーを使う。 */
export function createProductCloudApp(doc: Document, env: ProductBrowserEnvironment,
  publicKey: string, authStorage: AuthStorage, transport: typeof fetch) {
  const local = createProductBrowserLocalDependencies(env);
  const sender: AuthenticatedRpcSender = (accessToken, rpc, args) => createMemoRpcSender({
    origin: MEMO_RPC_ORIGIN, publishableKey: publicKey, accessToken,
  }, (url, init) => transport(url, init))(rpc, args);
  const owned = createMemoSdkAuth({ url: MEMO_RPC_ORIGIN, publicKey }, authStorage, transport, sender);
  const controller = createCloudController(owned.session);
  try {
    return createProductLocalApp(doc, local, undefined, { ...owned.session, dispose: owned.dispose },
      { controller, target: createStorageTargetController() });
  } catch {
    controller.dispose(); void owned.dispose().catch(() => {});
    throw new Error('Product cloud composition unavailable');
  }
}

/** 公開キーもビルドへ埋め込まない。入力操作が、復元通信を開始し得る明示境界。 */
export function mountProductCloudSetup(doc: Document, env: ProductBrowserEnvironment, transport: typeof fetch) {
  // 通常製品と同じpage検査を、設定入力やAuth Storage取得より前に行う。
  createProductBrowserLocalDependencies(env);
  const status = doc.getElementById('product-status');
  const section = doc.createElement('section'); section.setAttribute('aria-label', '開発クラウド候補の接続設定');
  const notice = doc.createElement('p'); notice.textContent = '承認済みdev-sandbox専用の未公開候補です。開始すると保存済みAuthの復元通信が発生する場合があります。実行には別途承認が必要です。';
  const label = doc.createElement('label'); label.textContent = '開発用publishable key';
  const input = doc.createElement('input'); input.type = 'password'; input.autocomplete = 'off'; label.append(input);
  const start = doc.createElement('button'); start.type = 'button'; start.textContent = '承認済みクラウド接続を開始';
  const feedback = doc.createElement('p'); feedback.setAttribute('role', 'status');
  section.append(notice, label, start, feedback); status?.after(section);
  let app: ReturnType<typeof createProductCloudApp> | undefined, closed = false;
  start.onclick = () => {
    if (closed || app || start.disabled) return;
    let key = input.value; input.value = '';
    // 任意URLや秘密鍵は受け取らない。RPC senderと同じpublishable形式に限定する。
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key) || key.length <= 15) {
      key = ''; feedback.textContent = '開発用publishable keyの形式を確認してください。接続は開始していません。'; return;
    }
    start.disabled = true;
    try {
      const storage: AuthStorage = {
        getItem: name => doc.defaultView!.localStorage.getItem(name),
        setItem: (name, value) => doc.defaultView!.localStorage.setItem(name, value),
        removeItem: name => doc.defaultView!.localStorage.removeItem(name),
      };
      app = createProductCloudApp(doc, env, key, storage, transport); section.remove();
    } catch { feedback.textContent = '接続準備を開始できませんでした。自動再試行しません。'; }
    finally { key = ''; }
  };
  const dispose = () => {
    const result = app?.dispose();
    if (result === 'busy' || result === 'pending') return result;
    closed = true; input.value = ''; start.onclick = null; section.remove();
    doc.defaultView?.removeEventListener('pagehide', dispose); return 'applied' as const;
  };
  doc.defaultView?.addEventListener('pagehide', dispose);
  return { dispose };
}
