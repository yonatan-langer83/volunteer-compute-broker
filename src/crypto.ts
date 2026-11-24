import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export type SealedBox = {
  iv: string
  tag: string
  ct: string
}

export type Envelope = {
  v: 1
  alg: 'aes-256-gcm'
  dek: SealedBox
  data: SealedBox
}

export function loadMasterKey(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length !== 32) {
    throw new Error('BROKER_MASTER_KEY must decode to 32 bytes')
  }
  return decoded
}

export function generateMasterKey(): string {
  return randomBytes(32).toString('base64')
}

export function encryptSecret(plaintext: string, masterKey: Buffer): Envelope {
  assertMasterKey(masterKey)
  const dek = randomBytes(32)
  try {
    return {
      v: 1,
      alg: 'aes-256-gcm',
      dek: seal(masterKey, dek),
      data: seal(dek, Buffer.from(plaintext, 'utf8')),
    }
  } finally {
    dek.fill(0)
  }
}

export function decryptSecret(envelope: Envelope, masterKey: Buffer): string {
  assertMasterKey(masterKey)
  if (!isEnvelope(envelope)) throw new Error('decryption failed')
  let dek: Buffer | null = null
  try {
    dek = open(masterKey, envelope.dek)
    if (dek.length !== 32) throw new Error('decryption failed')
    return open(dek, envelope.data).toString('utf8')
  } catch (error) {
    if (error instanceof Error && error.message === 'decryption failed') throw error
    throw new Error('decryption failed')
  } finally {
    dek?.fill(0)
  }
}

export function parseEnvelope(json: string): Envelope {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    throw new Error('decryption failed')
  }
  if (!isEnvelope(value)) throw new Error('decryption failed')
  return value
}

function seal(key: Buffer, plaintext: Buffer): SealedBox {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ciphertext.toString('base64'),
  }
}

function open(key: Buffer, box: SealedBox): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(box.ct, 'base64')), decipher.final()])
}

function assertMasterKey(masterKey: Buffer): void {
  if (masterKey.length !== 32) throw new Error('BROKER_MASTER_KEY must decode to 32 bytes')
}

function isEnvelope(value: unknown): value is Envelope {
  if (value == null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return record.v === 1 && record.alg === 'aes-256-gcm' && isBox(record.dek) && isBox(record.data)
}

function isBox(value: unknown): value is SealedBox {
  if (value == null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.iv === 'string' && typeof record.tag === 'string' && typeof record.ct === 'string'
}
