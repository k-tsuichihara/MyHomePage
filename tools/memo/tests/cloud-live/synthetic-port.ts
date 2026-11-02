import type { CloudTransport, CloudTransportResponse, RpcName } from '../../src/cloud-rpc-types';
import { freeze } from '../../src/cloud-rpc-validation';

export interface SyntheticReply {
  readonly rpc: RpcName; readonly response?: CloudTransportResponse; readonly fail?: true;
  /** 模擬遅延の解除専用。通信能力や呼出callbackは受け取らない。 */
  readonly wait?: Promise<void>;
}
export interface SyntheticPort { readonly calls: () => readonly RpcName[] }
const ports = new WeakMap<SyntheticPort, CloudTransport>();

/** 応答データだけから生成し、実fetch/transportをofflineランナーへ渡す経路を作らない。 */
export function createSyntheticPort(replies: readonly SyntheticReply[]): SyntheticPort {
  const queue = replies.map(reply => ({ rpc: reply.rpc, response: reply.response === undefined ? undefined : freeze(structuredClone(reply.response)), fail: reply.fail, wait: reply.wait }));
  const calls: RpcName[] = [];
  const port = Object.freeze({ calls: () => Object.freeze([...calls]) });
  ports.set(port, async rpc => {
    const next = queue[calls.length]; calls.push(rpc);
    if (!next || next.rpc !== rpc) throw Error('Synthetic sequence mismatch');
    await next.wait;
    if (next.fail || !next.response) throw Error('Synthetic communication failure');
    return next.response;
  });
  return port;
}
export function syntheticTransport(port: SyntheticPort): CloudTransport {
  const transport = ports.get(port);
  if (!transport) throw Error('Only owned synthetic data is allowed');
  return transport;
}
