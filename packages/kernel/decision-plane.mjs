const RISK_WORDS = ['production','prod','delete','migration','security','payment','legal','deploy','删除','迁移','支付','生产'];

export class DecisionPlane {
  constructor({ registry, mode = 'shadow', externalJudge = null }) {
    this.registry = registry;
    this.mode = mode;
    this.externalJudge = externalJudge;
  }

  async judge(input) {
    if (this.externalJudge) {
      try {
        const result = await Promise.race([
          this.externalJudge(input),
          new Promise((_, reject) => setTimeout(() => reject(new Error('decision timeout')), 1200))
        ]);
        if (result?.classifierConfidence >= 0.6) return result;
      } catch {}
    }
    return this.localJudge(input);
  }

  localJudge({ prompt = '', contextTokens = 0, requiresVision = false }) {
    const text = prompt.toLowerCase();
    const riskHint = RISK_WORDS.some(w => text.includes(w));
    const workKind = /code|bug|test|api|typescript|javascript|编程|代码|测试/.test(text) ? 'coding'
      : /research|source|evidence|market|competitor|调研|研究|证据/.test(text) ? 'research'
      : /write|copy|article|文案|文章/.test(text) ? 'writing'
      : requiresVision ? 'vision' : 'general';

    let tier = 'simple';
    if (prompt.length > 500 || contextTokens > 16000 || workKind === 'research') tier = 'medium';
    if (prompt.length > 1800 || contextTokens > 64000 || /architecture|security|multi-agent|架构|核心/.test(text)) tier = 'hard';
    if (riskHint && tier === 'simple') tier = 'medium';

    return {
      tier,
      workKind,
      riskHint,
      classifierConfidence: null,
      source: 'local-rule'
    };
  }

  async route(input, currentModel = 'balanced') {
    const judgment = await this.judge(input);
    const chosen = this.registry.select({
      tier: judgment.tier,
      workKind: judgment.workKind,
      requiresVision: input.requiresVision,
      contextTokens: input.contextTokens,
      dataClass: input.dataClass ?? 'INTERNAL'
    });

    const largeContext = (input.contextTokens ?? 0) > 32000;
    const current = this.registry.get(currentModel);
    const canSwitch = Boolean(chosen);
    const shouldSwitch = this.mode === 'on' && canSwitch && !(largeContext && current && chosen.cost < current.cost);

    return {
      judgment,
      recommendedModel: chosen?.id ?? null,
      selectedModel: shouldSwitch ? chosen.id : currentModel,
      shadow: this.mode !== 'on',
      reason: !chosen ? 'no-policy-compliant-model'
        : shouldSwitch ? 'router-enabled'
        : (largeContext ? 'large-context-no-downgrade' : 'shadow-or-fail-open')
    };
  }
}
