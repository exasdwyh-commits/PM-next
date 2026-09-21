# HERMES 产品中心 - 剩余任务执行计划

## 目标
完成 TASK-016 到 TASK-045 所有剩余实现任务，交付完整的 HERMES 产品中心。

## 依赖关系分析

### 关键路径
```
TASK-017 (advisor runs) ✅ DONE
  → TASK-016 (professional analysis integration) ✅ DONE
    → TASK-018 (scientific evidence) ✅ DONE
    → TASK-019 (AI evaluation) ✅ DONE
      → TASK-020 (pilot brief) NOT_STARTED
        → TASK-021 (proposals integration) ✅ DONE
          → TASK-022 (project direction) NOT_STARTED
            → TASK-023 (UI updates) NOT_STARTED
              → TASK-024 (PC-1 acceptance) NOT_STARTED
```

### Phase 4 (Supply Chain)
```
TASK-024 → TASK-025 (quotes) → TASK-026 (samples)
  → TASK-027 (professional confirmations)
    → TASK-028 (production gate)
      → TASK-029 (fixed product path)
        → TASK-030 (supply UI)
          → TASK-031 (production gate tests)
```

### Phase 5 (Launch)
```
TASK-031 → TASK-032 (production events)
  → TASK-033 (marketing brief)
    → TASK-034 (G3 gate type)
      → TASK-035 (launch authorization)
        → TASK-036 (launch preparation)
          → TASK-037 (launch UI)
            → TASK-038 (launch authorization tests)
```

### Phase 6 (Review & Analytics)
```
TASK-038 → TASK-039 (observations)
  → TASK-040 (reviews dashboard)
    → TASK-041 (analytics)
      → TASK-042 (reports)
        → TASK-043 (final integration)
          → TASK-044 (documentation)
            → TASK-045 (closure)
```

## 执行策略

1. **按依赖顺序执行** - 确保前置任务完成后再开始后续任务
2. **每个任务包含** - 实现 + 测试 + 文档更新
3. **每5个任务进行一次集成验证** - 确保系统稳定性
4. **遇到阻塞立即记录** - 不阻塞其他可并行任务

## 进度跟踪

| 阶段 | 任务范围 | 状态 | 开始时间 | 完成时间 |
|------|----------|------|----------|----------|
| Phase 2 (剩余) | TASK-017,018,019 | NOT_STARTED | - | - |
| Phase 3 (G1) | TASK-020,021,022,023,024 | NOT_STARTED | - | - |
| Phase 4 (Supply) | TASK-025,026,027,028,029,030,031 | NOT_STARTED | - | - |
| Phase 5 (Launch) | TASK-032,033,034,035,036,037,038 | NOT_STARTED | - | - |
| Phase 6 (Review) | TASK-039,040,041,042,043,044,045 | NOT_STARTED | - | - |

## 当前任务

**TASK-017**: 修订 advisor service 留痕与 runs 管理
- 依赖: TASK-013 ✅
- 状态: IN_PROGRESS
- 预计完成: 2026-09-20

---
*最后更新: 2026-09-20*
