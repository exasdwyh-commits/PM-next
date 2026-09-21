-- P4: Advisor 接入真实 LLM 的架构准备 —— RunMode 增加 LLM 枚举值。
-- 仅扩展枚举，无数据变更；现有 TEST_STUB 运行记录不受影响。
ALTER TYPE "RunMode" ADD VALUE IF NOT EXISTS 'LLM';
