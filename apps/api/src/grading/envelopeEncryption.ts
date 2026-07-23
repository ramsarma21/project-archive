import crypto from "node:crypto";

export interface EncryptedResponse {
  ciphertext: Buffer;
  ciphertextIv: Buffer;
  ciphertextTag: Buffer;
  wrappedKey: Buffer;
  wrappedKeyIv: Buffer;
  wrappedKeyTag: Buffer;
  keyVersion: string;
}

function masterKey(): Buffer {
  const encoded = process.env.GRADING_ENCRYPTION_KEY_BASE64?.trim();
  if (!encoded) {
    throw new Error("GRADING_STORAGE_UNAVAILABLE");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32) {
    throw new Error("GRADING_STORAGE_UNAVAILABLE");
  }
  return key;
}

function keyVersion(): string {
  const value = process.env.GRADING_ENCRYPTION_KEY_VERSION?.trim();
  if (!value || !/^[A-Za-z0-9._:-]{1,80}$/.test(value)) {
    throw new Error("GRADING_STORAGE_UNAVAILABLE");
  }
  return value;
}

function encryptAesGcm(
  plaintext: Buffer,
  key: Buffer,
  aad: Buffer,
): { ciphertext: Buffer; iv: Buffer; tag: Buffer } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

function decryptAesGcm(
  ciphertext: Buffer,
  iv: Buffer,
  tag: Buffer,
  key: Buffer,
  aad: Buffer,
): Buffer {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function responseEncryptionAad(input: {
  profileId: string;
  attemptId: string;
  promptId: string;
}): Buffer {
  return Buffer.from(
    `project-archive:open-response:v1:${input.profileId}:${input.attemptId}:${input.promptId}`,
    "utf8",
  );
}

export function encryptResponseText(
  responseText: string,
  aad: Buffer,
): EncryptedResponse {
  const dataKey = crypto.randomBytes(32);
  const payload = encryptAesGcm(Buffer.from(responseText, "utf8"), dataKey, aad);
  const wrappingAad = Buffer.from(
    `project-archive:open-response-key:${keyVersion()}`,
    "utf8",
  );
  const wrapped = encryptAesGcm(dataKey, masterKey(), wrappingAad);
  dataKey.fill(0);
  return {
    ciphertext: payload.ciphertext,
    ciphertextIv: payload.iv,
    ciphertextTag: payload.tag,
    wrappedKey: wrapped.ciphertext,
    wrappedKeyIv: wrapped.iv,
    wrappedKeyTag: wrapped.tag,
    keyVersion: keyVersion(),
  };
}

export function decryptResponseText(
  encrypted: EncryptedResponse,
  aad: Buffer,
): string {
  if (encrypted.keyVersion !== keyVersion()) {
    throw new Error("GRADING_KEY_VERSION_UNAVAILABLE");
  }
  const wrappingAad = Buffer.from(
    `project-archive:open-response-key:${encrypted.keyVersion}`,
    "utf8",
  );
  const dataKey = decryptAesGcm(
    encrypted.wrappedKey,
    encrypted.wrappedKeyIv,
    encrypted.wrappedKeyTag,
    masterKey(),
    wrappingAad,
  );
  try {
    return decryptAesGcm(
      encrypted.ciphertext,
      encrypted.ciphertextIv,
      encrypted.ciphertextTag,
      dataKey,
      aad,
    ).toString("utf8");
  } finally {
    dataKey.fill(0);
  }
}

