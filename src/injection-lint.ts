export type InjectionFlag = 'instruction_override' | 'credential_or_secret' | 'env_var' | 'pipe_to_shell' | 'exfiltration'

const CHECKS: { flag: InjectionFlag; pattern: RegExp }[] = [
  {
    flag: 'instruction_override',
    pattern: /ignore\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier|system)\s+(instructions|prompts|rules|directions)/i,
  },
  {
    flag: 'instruction_override',
    pattern: /disregard\s+(your\s+|the\s+)?(safety|rules|instructions|system)/i,
  },
  {
    flag: 'instruction_override',
    pattern: /\byou are now\b/i,
  },
  {
    flag: 'credential_or_secret',
    pattern: /\b(api[-_ ]?keys?|access[-_ ]?tokens?|passwords?|credentials?|secrets?)\b/i,
  },
  {
    flag: 'env_var',
    pattern: /\b(environment variables?|\.env\b|process\.env|printenv)\b/i,
  },
  {
    flag: 'env_var',
    pattern: /\b[A-Z][A-Z0-9_]{2,}_(TOKEN|SECRET|KEY|PASSWORD)\b/,
  },
  {
    flag: 'pipe_to_shell',
    pattern: /\b(curl|wget)\b[^\n]{0,240}\|\s*(ba)?sh\b/i,
  },
  {
    flag: 'pipe_to_shell',
    pattern: /\|\s*(ba)?sh\b/,
  },
  {
    flag: 'exfiltration',
    pattern: /\b(send|upload|post|exfiltrate)\b[^\n]{0,80}\b(files?|keys?|secrets?|tokens?|credentials?|\.env)\b/i,
  },
  {
    flag: 'exfiltration',
    pattern: /\b(send|upload)\b[^\n]{0,60}https?:\/\//i,
  },
]

export function lintInjection(text: string): InjectionFlag[] {
  const found = new Set<InjectionFlag>()
  for (const check of CHECKS) {
    if (check.pattern.test(text)) found.add(check.flag)
  }
  return [...found]
}

export function briefText(parts: {
  title: string
  goal: string
  instructions: string
  acceptance: string
  tests: string
  do: string[]
  dont: string[]
  deliverable: string
  agentsMd?: string | null
}): string {
  return [
    parts.title,
    parts.goal,
    parts.instructions,
    parts.acceptance,
    parts.tests,
    parts.do.join('\n'),
    parts.dont.join('\n'),
    parts.deliverable,
    parts.agentsMd ?? '',
  ].join('\n')
}
