import { isDeepStrictEqual } from 'node:util';

export function diagnoseFetchError(error, log = console.log) {
  // 例外の任意文字列は出力しない。許可した名称・コードだけを表示する。
  const names = new Set(['AbortError', 'TimeoutError', 'TypeError', 'Error', 'AggregateError']);
  const codes = new Map([
    ['ENOTFOUND', 'DNS解決失敗'], ['EAI_AGAIN', 'DNS解決の一時的失敗'],
    ['ETIMEDOUT', '通信タイムアウト'], ['UND_ERR_CONNECT_TIMEOUT', '接続タイムアウト'],
    ['UND_ERR_HEADERS_TIMEOUT', 'ヘッダー受信タイムアウト'], ['UND_ERR_BODY_TIMEOUT', '本文受信タイムアウト'],
    ['ECONNRESET', '接続リセット'], ['EPIPE', '接続切断'], ['UND_ERR_SOCKET', 'ソケットエラー'],
    ['ECONNREFUSED', '接続拒否'], ['ENETUNREACH', 'ネットワーク到達不能'], ['EHOSTUNREACH', 'ホスト到達不能'],
    ['CERT_HAS_EXPIRED', 'TLS証明書期限切れ'], ['CERT_NOT_YET_VALID', 'TLS証明書有効期間外'],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'TLS自己署名証明書'], ['SELF_SIGNED_CERT_IN_CHAIN', 'TLS証明書チェーン検証失敗'],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'TLS証明書検証失敗'], ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'TLS発行者検証失敗'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'TLS証明書ホスト名不一致'], ['ERR_SSL_WRONG_VERSION_NUMBER', 'TLSプロトコルエラー'],
    ['UND_ERR_ABORTED', '要求中断'],
  ]);
  const name = names.has(error?.name) ? error.name : '不明';
  const code = codes.has(error?.cause?.code) ? error.cause.code : '不明';
  const category = name === 'TimeoutError' ? 'タイムアウト通知'
    : name === 'AbortError' ? '中断通知' : (codes.get(code) ?? '不明');
  log(`診断: fetch例外名=${name}、cause.code=${code}、分類=${category}`);
  log('診断: この例外だけではDBへの到達・適用有無や根本原因は断定できません。');
}

export async function evaluateConflictResponse(url, options, { fetchImpl, log = console.log, setStage = () => {} }) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation required');
  let expectedError = false;
  setStage('競合fetch通信（結果不明の可能性あり）');
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch (error) {
    diagnoseFetchError(error, log);
    throw new Error('conflict fetch failed');
  }
  log(`診断: HTTP ${response.status}、HTTP応答=${response.ok ? '成功（期待外）' : 'エラー'}`);
  if (!response.ok) {
    setStage('競合エラー応答本文の受信（通信・レスポンス処理）');
    const text = await response.text();
    setStage('競合エラー応答のJSON解析');
    const error = JSON.parse(text);
    setStage('競合エラー応答形式・一致判定');
    if (!error || typeof error !== 'object' || Array.isArray(error)
      || typeof error.code !== 'string' || typeof error.message !== 'string') throw new Error('verification failed');
    const statusMatches = response.status === 409;
    const codeMatches = error.code === 'PT409';
    const messageMatches = error.message === 'memo revision conflict';
    log(`診断: HTTP 409=${statusMatches ? '一致' : '不一致'}、SQLSTATE PT409=${codeMatches ? '一致' : '不一致'}、期待メッセージ=${messageMatches ? '一致' : '不一致'}`);
    expectedError = statusMatches && codeMatches && messageMatches;
  } else {
    setStage('期待外の成功レスポンス処理（本文破棄）');
    await response.body?.cancel();
  }
  return expectedError;
}

export function verifyConflictUnchanged(before, after, memoId, expectedError) {
  const check = (value) => { if (!value) throw new Error('verification failed'); };
  const originals = before.memos.filter((memo) => memo.id === memoId);
  const current = after.memos.filter((memo) => memo.id === memoId);
  check(originals.length === 1 && current.length === 1 && isDeepStrictEqual(current[0], originals[0]));
  const others = (rows) => rows.filter((memo) => memo.id !== memoId).sort((a, b) => a.id.localeCompare(b.id));
  check(after.memos.length === before.memos.length && isDeepStrictEqual(others(after.memos), others(before.memos)));
  check(isDeepStrictEqual(after.tags, before.tags) && isDeepStrictEqual(after.memoTags, before.memoTags));
  check(expectedError === true);
}

