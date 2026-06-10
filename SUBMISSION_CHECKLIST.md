# 提交对照清单

依据：`2026-05-24_项目挑战说明_.pdf`。提交方式以主办方最终通知为准。

## 必交项

| # | 交付物 | 要求要点 | 当前状态 |
|---|---|---|---|
| 1 | Demo 视频 ≤ 3 分钟 | 前 30 秒展示 wow moment；之后用一页介绍页讲清痛点、设计取舍和 agent 架构 | 脚本已更新为 Traceback 版：`docs/demo-video-script.md` |
| 2 | 公网可访问 URL | 可访问 Demo；公网默认走真实分析 pipeline，使用快速模型和清晰进度反馈 | 部署指南见 `docs/DEPLOYMENT.md` |
| 3 | Product Memo 1-2 页 | 目标用户与痛点、产品设计、刻意不做什么、版本迭代、下一步 | 已更新为 Traceback：`PRODUCT_MEMO.md` |
| 4 | GitHub 公开仓库 | README 含项目简介、运行方式、技术栈、当前取舍；commit history 清晰 | README 已更新为 Traceback：`README.md` |

## 演示材料建议

- `Demo` 页面：展示风险点 + Evidence Viewer + 单风险点追问。
- `介绍` 页面：展示 Traceback 的一句话价值、Deep Research Agent、Evidence Check Agent 和 Follow-up Interview。
- `docs/demo-video-script.md`：3 分钟讲稿。
- `PRODUCT_MEMO.md`：提交 memo 草稿。
- `docs/ARCHITECTURE.md`：系统架构图和 pipeline 说明。
- `VERSION_WORKLOG.md`：产品从完整平台收缩到风险审查器的决策记录。

## 诚信与安全要求

- [ ] 说明代码为 AI 辅助生成 + 人工审查迭代。
- [ ] 演示使用公开仓库，不使用真人隐私数据。
- [ ] 公网 `/api/analyze` 不返回固定 demo snapshot。
- [ ] API key、GitHub token 不提交到公开仓库。

## 提交前最后一小时检查

- [ ] 公网 URL 可打开。
- [ ] Demo / 介绍切换正常。
- [ ] 演示 repo 能看到真实 pipeline 进度，并最终返回风险点。
- [ ] 视频时长 < 3 分钟。
- [ ] Product Memo 无旧产品名、无 Survey / Practice / Test 主入口描述。
- [ ] README 和架构图描述一致。
- [ ] 最后一次 `npm run typecheck` 和 `npm test -- --run` 通过。
