import { createHash } from 'node:crypto';
import type { NotifiedItem } from './types';

export type OutboxStatus = 'pending' | 'sending' | 'delivered' | 'blocked' | 'uncertain';

export interface OutboxReceipt {
  key: string;
  entry: NotifiedItem;
}

export interface OutboxMessage {
  id: string;
  createdAt: string;
  text: string;
  receipts: OutboxReceipt[];
  status: OutboxStatus;
  attempts: number;
  claimedAt?: string;
  nextAttemptAt?: string;
  lastError?: string;
}

export interface NotificationOutbox {
  schemaVersion: 1;
  messages: OutboxMessage[];
}

export const emptyOutbox = (): NotificationOutbox => ({ schemaVersion: 1, messages: [] });

export function normalizeOutbox(value: unknown): NotificationOutbox {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid notification outbox object');
  const root = value as Record<string, unknown>;
  if (root.schemaVersion !== 1 || !Array.isArray(root.messages)) throw new Error('Unsupported notification outbox schema');
  const messages = root.messages.map((candidate): OutboxMessage => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Invalid notification outbox entry');
    const item = candidate as Record<string, unknown>;
    const validReceipts = Array.isArray(item.receipts) && item.receipts.length > 0 && item.receipts.every(receipt => {
      if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return false;
      const row = receipt as Record<string, unknown>;
      if (typeof row.key !== 'string' || !row.key || !row.entry || typeof row.entry !== 'object' || Array.isArray(row.entry)) return false;
      const entry = row.entry as Record<string, unknown>;
      return typeof entry.title === 'string' && Number.isFinite(entry.price) && Number.isFinite(entry.percent) &&
        typeof entry.timestamp === 'string' && !Number.isNaN(Date.parse(entry.timestamp)) && typeof entry.type === 'string';
    });
    const valid = typeof item.id === 'string' && typeof item.text === 'string' &&
      validReceipts && typeof item.createdAt === 'string' && !Number.isNaN(Date.parse(item.createdAt)) &&
      ['pending', 'sending', 'delivered', 'blocked', 'uncertain'].includes(String(item.status)) &&
      Number.isInteger(item.attempts) && (item.attempts as number) >= 0 &&
      (item.nextAttemptAt === undefined || (typeof item.nextAttemptAt === 'string' && !Number.isNaN(Date.parse(item.nextAttemptAt))));
    if (!valid) throw new Error('Invalid notification outbox entry');
    return candidate as OutboxMessage;
  });
  return { schemaVersion: 1, messages };
}

export function pendingReceiptKeys(outbox: NotificationOutbox): Set<string> {
  return new Set(outbox.messages
    .filter(message => message.status !== 'delivered')
    .flatMap(message => message.receipts.map(receipt => receipt.key)));
}

export function enqueueMessage(
  outbox: NotificationOutbox,
  text: string,
  receipts: OutboxReceipt[],
  now = new Date(),
): OutboxMessage | undefined {
  const alreadyQueued = pendingReceiptKeys(outbox);
  const freshReceipts = receipts.filter(receipt => !alreadyQueued.has(receipt.key));
  if (freshReceipts.length === 0) return undefined;
  const id = createHash('sha256')
    .update(`${text}\0${freshReceipts.map(receipt => receipt.key).join('\0')}`)
    .digest('hex').slice(0, 24);
  const existing = outbox.messages.find(message => message.id === id);
  if (existing) return existing;
  const message: OutboxMessage = {
    id,
    createdAt: now.toISOString(),
    text,
    receipts: freshReceipts,
    status: 'pending',
    attempts: 0,
  };
  outbox.messages.push(message);
  return message;
}

/** A prior `sending` record is ambiguous after a process restart. Never resend it silently. */
export function claimNextMessage(outbox: NotificationOutbox, now = new Date()): OutboxMessage | undefined {
  for (const message of outbox.messages) {
    if (message.status === 'sending') {
      message.status = 'uncertain';
      message.lastError = 'Previous process ended before the delivery result was committed.';
    }
  }
  const next = outbox.messages.find(message =>
    message.status === 'pending' && (!message.nextAttemptAt || Date.parse(message.nextAttemptAt) <= now.getTime()));
  if (!next) return undefined;
  next.status = 'sending';
  next.attempts += 1;
  next.claimedAt = now.toISOString();
  delete next.nextAttemptAt;
  delete next.lastError;
  return next;
}

export type DeliveryOutcome =
  | { kind: 'delivered' }
  | { kind: 'retry'; error: string; retryAt: Date }
  | { kind: 'blocked'; error: string }
  | { kind: 'uncertain'; error: string };

export function classifyDeliveryFailure(code: string | undefined, error: string, now = new Date()): DeliveryOutcome {
  const httpStatus = /^HTTP_(\d{3})$/.exec(code ?? '')?.[1];
  if (httpStatus === '429') return { kind: 'retry', error, retryAt: new Date(now.getTime() + 15 * 60 * 1000) };
  if (httpStatus && Number(httpStatus) >= 500) return { kind: 'uncertain', error };
  if (httpStatus) return { kind: 'blocked', error };
  return { kind: 'uncertain', error };
}

export function recordDeliveryOutcome(outbox: NotificationOutbox, id: string, outcome: DeliveryOutcome): OutboxMessage {
  const message = outbox.messages.find(item => item.id === id);
  if (!message || message.status !== 'sending') throw new Error(`No claimed outbox message: ${id}`);
  if (outcome.kind === 'delivered') {
    message.status = 'delivered';
    message.lastError = undefined;
  } else {
    message.status = outcome.kind === 'retry' ? 'pending' : outcome.kind;
    message.lastError = outcome.error;
    if (outcome.kind === 'retry') message.nextAttemptAt = outcome.retryAt.toISOString();
  }
  return message;
}

export function pruneDelivered(outbox: NotificationOutbox, now = new Date(), retentionMs = 90 * 24 * 60 * 60 * 1000): void {
  const cutoff = now.getTime() - retentionMs;
  outbox.messages = outbox.messages.filter(message =>
    message.status !== 'delivered' || Date.parse(message.createdAt) >= cutoff);
}
