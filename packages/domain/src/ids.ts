/**
 * Stable application ID prefixes. IDs are `<PREFIX>_<ULID>`; the backend generates them,
 * except camera IDs, which the UI creates inside the DNA (ADR-016) with {@link newCameraId}.
 */
export const ID_PREFIX = {
  project: "PRJ",
  asset: "AST",
  version: "VER",
  object: "OBJ",
  camera: "CAM",
  job: "JOB",
  generation: "GEN",
  batch: "BAT",
  material: "MAT",
} as const;

const ULID = "[0-9A-HJKMNP-TV-Z]{26}";

export function isStableId(
  id: string,
  prefix: (typeof ID_PREFIX)[keyof typeof ID_PREFIX],
): boolean {
  return new RegExp(`^${prefix}_${ULID}$`).test(id);
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RANDOM_LEN = 16;
const MAX_TIME = 2 ** 48 - 1;

export type RandomSource = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array;

const cryptoRandom: RandomSource = (bytes) => {
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};

/**
 * Make a ULID generator (Crockford base32, 48-bit millisecond time + 80 random bits).
 * Monotonic: within the same millisecond (or if the clock goes backwards) the previous
 * random part is incremented, so IDs from one generator always sort in creation order.
 * `random` and `now` are injectable for tests.
 */
export function createUlidGenerator(
  random: RandomSource = cryptoRandom,
  now: () => number = Date.now,
): () => string {
  let lastTime = -1;
  let lastRandom: number[] = [];
  return () => {
    let time = Math.floor(now());
    if (!Number.isFinite(time) || time < 0 || time > MAX_TIME) {
      throw new RangeError(`ULID time out of range: ${time}`);
    }
    if (time <= lastTime) {
      time = lastTime;
      lastRandom = incrementBase32(lastRandom);
    } else {
      lastTime = time;
      // 256 is a multiple of 32, so masking keeps every digit uniform.
      lastRandom = Array.from(random(new Uint8Array(RANDOM_LEN)), (b) => b & 31);
    }
    return encodeTime(time) + lastRandom.map((d) => CROCKFORD[d]).join("");
  };
}

function encodeTime(time: number): string {
  let out = "";
  for (let i = 0; i < TIME_LEN; i++) {
    out = CROCKFORD[time % 32]! + out;
    time = Math.floor(time / 32);
  }
  return out;
}

function incrementBase32(digits: readonly number[]): number[] {
  const next = [...digits];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i]! < 31) {
      next[i] = next[i]! + 1;
      return next;
    }
    next[i] = 0;
  }
  throw new RangeError("ULID random part overflow within one millisecond");
}

export const newUlid = createUlidGenerator();

/** A fresh `CAM_<ULID>` for a camera created in the UI (ADR-016); time-ordered. */
export function newCameraId(): string {
  return `${ID_PREFIX.camera}_${newUlid()}`;
}
