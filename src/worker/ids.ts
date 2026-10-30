export type RandomBytes = (length: number) => Uint8Array;

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const STORY_ID_LENGTH = 5;

// 256 isn't a multiple of 36, so bytes from this value up are skipped. Otherwise the first
// characters of the alphabet would come up more often.
const UNBIASED_BYTE_LIMIT = 256 - (256 % ALPHABET.length);

/** A random story ID: 5 characters from [a-z0-9]. */
export function newStoryId(randomBytes: RandomBytes = cryptoBytes): string {
  let id = "";

  while (id.length < STORY_ID_LENGTH) {
    for (const byte of randomBytes(STORY_ID_LENGTH - id.length)) {
      if (byte < UNBIASED_BYTE_LIMIT) {
        id += ALPHABET.charAt(byte % ALPHABET.length);
      }
    }
  }

  return id;
}

/** An opaque ID for a participant or a contribution. */
export function newId(): string {
  return crypto.randomUUID();
}

function cryptoBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}
