export type TWslLinkConnectionState =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'degraded'
  | 'reconnecting'
  | 'resuming'
  | 'backoff'
  | 'closed';

export type TWslLinkTransportKind = 'vsockGrpc' | 'mirroredQuic';

export type TWslLinkCircuitBreakerState = 'closed' | 'open' | 'halfOpen';

export interface IWslLinkMetrics {
  activeTransport: TWslLinkTransportKind | null;
  rttMs: number | null;
  reconnectsTotal: number;
  inflightRequests: number;
  outboxDepth: number;
  lastError: string | null;
}

export interface IWslLinkStatusPayload {
  state: TWslLinkConnectionState;
  maturity: 'yellow' | 'green' | 'red';
  protocolVersion: string;
  primaryTransport: TWslLinkTransportKind;
  fallbackTransport: TWslLinkTransportKind;
  vsockGrpcPort: number;
  mirroredQuicPort: number;
  circuitBreaker: TWslLinkCircuitBreakerState;
  metrics: IWslLinkMetrics;
  note: string;
}
