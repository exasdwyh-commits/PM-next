const INSTRUCTION_PATTERNS: RegExp[] = [
  /ignore.{0,30}(previous|prior|system|developer|instructions?)/i,
  /disregard.{0,30}(instructions?|directives?|guidelines?|rules?)/i,
  /forget.{0,30}(instructions?|directives?|guidelines?|rules?)/i,
  /act\s+as.{0,30}(unrestricted|dan|jailbreak|developer|system)/i,
  /system\s*:\s*.{0,50}(reveal|show|print|expose|ignore)/i,
  /(upload|send|post|transmit|forward|email).{0,50}(company|internal|secret|credential|api[_\s-]*key|token)/i,
  /(reveal|show|print|expose).{0,30}(prompt|system|developer|secret|credential|api[_\s-]*key)/i,
  /越狱|忘掉.{0,16}(规则|指令|限制)|无视.{0,16}(规则|指令|限制)|把.{0,24}(内部资料|密钥|凭证).{0,24}(发|传|上传)/i,
];

export interface ExternalContentScan {
  text: string;
  quarantined: boolean;
  flags: string[];
}

export function scanExternalText(text: string): ExternalContentScan {
  const normalized = String(text ?? "").normalize("NFKC");
  const flags = INSTRUCTION_PATTERNS
    .map((pattern, index) => pattern.test(normalized) ? `instruction-pattern-${index + 1}` : null)
    .filter((value): value is string => Boolean(value));
  return {
    text: normalized,
    quarantined: flags.length > 0,
    flags,
  };
}
