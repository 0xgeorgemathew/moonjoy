// Short-lived in-memory cache for ENS contract reads.
//
// Onchain ENS state remains canonical. This cache only avoids hitting the
// RPC on every MCP tool call. TTLs are deliberately short so that when
// bootstrap transactions confirm, subsequent reads pick up the new state.
//
// Safe for a single Next.js server process. Across processes each instance
// holds its own cache, which is acceptable because the TTL is short and the
// chain is the source of truth.

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const DEFAULT_TTL_MS = 30_000;
const IMMUTABLE_TTL_MS = 24 * 60 * 60 * 1000;

const caches = new Map<string, Map<string, CacheEntry<unknown>>>();
const inFlightReads = new Map<string, Promise<unknown>>();

function getBucket(name: string): Map<string, CacheEntry<unknown>> {
  let bucket = caches.get(name);
  if (!bucket) {
    bucket = new Map();
    caches.set(name, bucket);
  }
  return bucket;
}

export async function cachedEnsRead<T>(
  bucketName: string,
  key: string,
  loader: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const bucket = getBucket(bucketName);
  const now = Date.now();
  const hit = bucket.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.value as T;
  }

  const inFlightKey = `${bucketName}:${key}`;
  const pending = inFlightReads.get(inFlightKey);
  if (pending) {
    return pending as Promise<T>;
  }

  const read = loader()
    .then((value) => {
      bucket.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      inFlightReads.delete(inFlightKey);
    });

  inFlightReads.set(inFlightKey, read);
  return read;
}

export function cachedEnsReadImmutable<T>(
  bucketName: string,
  key: string,
  loader: () => Promise<T>,
): Promise<T> {
  return cachedEnsRead(bucketName, key, loader, IMMUTABLE_TTL_MS);
}

export function invalidateEnsKey(bucketName: string, key: string): void {
  const bucket = caches.get(bucketName);
  if (bucket) {
    bucket.delete(key);
  }
  inFlightReads.delete(`${bucketName}:${key}`);
}

export function invalidateEnsBucket(bucketName: string): void {
  caches.delete(bucketName);
  for (const key of inFlightReads.keys()) {
    if (key.startsWith(`${bucketName}:`)) {
      inFlightReads.delete(key);
    }
  }
}

export function invalidateAllEnsCaches(): void {
  caches.clear();
  inFlightReads.clear();
}
