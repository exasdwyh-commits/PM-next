# Response Layer 预览页

离线预览 Kern 回复排版，不依赖 dev server / DB / 模型。

- `kern-response.html` —— 单条回复 + 14 条规则的 harness 面板。
- `build-conversation.py` —— 由 `src/app/muse/response/response.css`（产品同一份样式）
  与上面的渲染器组装出 `kern-conversation.html`：澄清 → 实时流式进度 → 结论的完整会话线程。

```bash
python3 tools/response-preview/build-conversation.py
open tools/response-preview/kern-conversation.html
```

预览页与产品共用同一份 CSS，避免"demo 好看、集成后走样"。
