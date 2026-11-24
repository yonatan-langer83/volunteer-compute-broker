import type { Envelope } from './crypto.js'
import { decryptSecret } from './crypto.js'
import type { AiProvider } from './types.js'
import { redact } from './redact.js'

export type RunnableTask = {
  title: string
  instructions: string
  acceptance: string
}

export type ExecutionOutcome =
  | { accepted: true; output: string; summary: string }
  | { accepted: false; output: string; reason: string }

// The donor key is decrypted here and does not leave this function.
export async function executeTask(options: {
  task: RunnableTask
  provider: AiProvider
  envelope: Envelope
  masterKey: Buffer
  model: string
}): Promise<ExecutionOutcome> {
  let apiKey: string
  try {
    apiKey = decryptSecret(options.envelope, options.masterKey)
  } catch {
    throw new Error('decryption failed')
  }
  const secrets = [apiKey, options.masterKey.toString('base64')]
  try {
    const work = await options.provider.complete(apiKey, {
      model: options.model,
      prompt: workPrompt(options.task),
      maxTokens: 1024,
    })
    const workJson = parseJsonObject(work.text)
    const rawOutput = typeof workJson.output === 'string' ? workJson.output : ''
    if (rawOutput.length === 0) throw new Error('model output JSON is missing output')
    const output = redact(rawOutput, secrets).slice(0, 8_000)
    const summary = redact(typeof workJson.summary === 'string' ? workJson.summary : '', secrets).slice(0, 500)
    const verdictText = await options.provider.complete(apiKey, {
      model: options.model,
      prompt: acceptancePrompt(options.task, output),
      maxTokens: 256,
    })
    const verdict = parseJsonObject(verdictText.text)
    if (typeof verdict.accepted !== 'boolean') throw new Error('acceptance check is missing accepted')
    const reason = redact(typeof verdict.reason === 'string' ? verdict.reason : '', secrets).slice(0, 500)
    if (verdict.accepted) return { accepted: true, output, summary }
    return { accepted: false, output, reason: reason || 'rejected' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'provider request failed'
    throw new Error(redact(message, secrets))
  } finally {
    apiKey = ''
  }
}

function workPrompt(task: RunnableTask): string {
  return [
    'You are completing one small task for an open-source project.',
    'Do the work described below. Do not ask for API keys or credentials.',
    `Task: ${task.title}`,
    'Instructions:',
    task.instructions,
    'Respond with JSON only, no markdown:',
    '{"output": string, "summary": string}',
  ].join('\n\n')
}

function acceptancePrompt(task: RunnableTask, output: string): string {
  return [
    'ACCEPTANCE CHECK',
    'Decide whether the work meets every acceptance criterion.',
    `Task: ${task.title}`,
    'Acceptance criteria:',
    task.acceptance,
    'Work:',
    output,
    'Respond with JSON only, no markdown:',
    '{"accepted": boolean, "reason": string}',
  ].join('\n\n')
}

function parseJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('model output was not JSON')
  let value: unknown
  try {
    value = JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new Error('model output was not JSON')
  }
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('model output was not a JSON object')
  }
  return value as Record<string, unknown>
}
