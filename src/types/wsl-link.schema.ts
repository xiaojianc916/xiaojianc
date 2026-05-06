import { z } from 'zod';

export const wslLinkConnectionStateSchema = z.enum([
  'idle',
  'connecting',
  'ready',
  'degraded',
  'reconnecting',
  'resuming',
  'backoff',
  'closed',
]);

export const wslLinkTransportKindSchema = z.enum(['vsockGrpc', 'mirroredQuic']);

export const wslLinkCircuitBreakerStateSchema = z.enum(['closed', 'open', 'halfOpen']);

export const wslLinkMetricsSchema = z.object({
  activeTransport: wslLinkTransportKindSchema.nullable(),
  rttMs: z.number().int().nonnegative().nullable(),
  reconnectsTotal: z.number().int().nonnegative(),
  inflightRequests: z.number().int().nonnegative(),
  outboxDepth: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
});

export const wslLinkStatusPayloadSchema = z.object({
  state: wslLinkConnectionStateSchema,
  maturity: z.enum(['yellow', 'green', 'red']),
  protocolVersion: z.string().min(1),
  primaryTransport: wslLinkTransportKindSchema,
  fallbackTransport: wslLinkTransportKindSchema,
  vsockGrpcPort: z.number().int().min(1).max(65535),
  mirroredQuicPort: z.number().int().min(1).max(65535),
  circuitBreaker: wslLinkCircuitBreakerStateSchema,
  metrics: wslLinkMetricsSchema,
  note: z.string(),
});
