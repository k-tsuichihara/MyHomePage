import type { Memo, Tag } from './types';

export type RpcName = 'memo_load_snapshot' | 'memo_save' | 'memo_resolve_request' | 'memo_change_state'
  | 'memo_delete_permanently' | 'memo_empty_trash' | 'memo_save_tag' | 'memo_delete_tag';
export type RpcArgument = string | number | null | readonly string[] | readonly number[];
export interface CloudCall {
  readonly ownerId: string;
  readonly rpc: RpcName;
  readonly args: Readonly<Record<string, RpcArgument>>;
  /** SQL引数にない場合は送らず、削除操作のクライアント内識別にだけ使用する。 */
  readonly requestId: string | null;
}
/**
 * single-rpcは当該呼出し1回の正式RPC応答で、再試行・応答差替えがないとtransportが確認した場合だけ指定する。
 * プロキシ等の合成応答や出所/試行回数不明はunverified。HTTP/SQLSTATEだけでsingle-rpcに認定しない。
 * 本文解析不能・応答消失はrejectする。これは信頼する注入実装の契約で、暗号学的な出所証明ではない。
 */
export interface CloudTransportResponse { readonly provenance: 'single-rpc' | 'unverified'; readonly status: number; readonly body: unknown }
export type CloudTransport = (rpc: RpcName, args: CloudCall['args']) => Promise<CloudTransportResponse>;
export type ConflictReason = 'used-memo-id' | 'memo-revision' | 'state-revision' | 'delete-not-found-or-revision'
  | 'trash-snapshot' | 'trash-revision' | 'tag-revision';
export type FailureReason = 'communication' | 'invalid-response' | 'owner-mismatch' | 'unclassified-http' | 'unverified-response';
export type CloudResult<T> = { readonly kind: 'ok'; readonly value: T; readonly call: CloudCall }
  | { readonly kind: 'not-attempted'; readonly reason: 'invalid-input' }
  | { readonly kind: 'rejected'; readonly reason: 'conflict'; readonly conflict: ConflictReason; readonly call: CloudCall }
  | { readonly kind: 'rejected'; readonly reason: 'permission' | 'invalid-argument' | 'constraint' | 'not-found'; readonly call: CloudCall }
  | { readonly kind: 'failed' | 'unknown'; readonly reason: FailureReason; readonly call: CloudCall };
export interface CloudSaveInput {
  readonly memoId: string; readonly title: string; readonly body: string; readonly tagIds: readonly string[];
  readonly expectedRevision: number | null; readonly requestId: string;
}
export interface CloudMutation { readonly expectedRevision: number; readonly requestId: string }
export interface CloudTarget { readonly id: string; readonly revision: number }
export interface CloudSaved { readonly memo: Memo; readonly tagIds: readonly string[] }
export type CloudSaveOutcome = { readonly kind: 'saved'; readonly value: CloudSaved; readonly currentMayDiffer: true }
  | { readonly kind: 'previously-applied-deleted' };
export type CloudResolution = CloudSaveOutcome | { readonly kind: 'no-record' };
export type CloudStateOutcome = { readonly kind: 'changed'; readonly memo: Memo; readonly currentMayDiffer: true }
  | { readonly kind: 'previously-applied-deleted' };
export type { Memo, Tag };
