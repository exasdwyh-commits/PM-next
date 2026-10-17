# _artifacts · 标准图产物

由 `node scripts/health-pack/charts.mjs` 生成，**产物不进库**（见 `.gitignore`）：

| 文件 | 图 | 图源 |
|---|---|---|
| `opportunity-matrix.svg` | 机会矩阵（人群需求 × 竞争强度） | `data/cases/*.json` → `opportunities[]` |
| `cost-waterfall.svg` | 成本瀑布（到手价 → 贡献毛利） | `data/cases/*.json` → `costModel` |
| `claims-traffic-light.svg` | 合规红黄绿 | `data/claims.json` |
| `content-calendar.svg` | 内容日历（28 天） | `data/cases/*.json` → `contentPlan[]` |
| `index.html` | 四张图的浏览页 | 上述四张 |

空状态是诚实状态：没有数据就画坐标轴与「暂无数据」，绝不画占位数字。

