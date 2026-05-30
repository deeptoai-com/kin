# 两周计划（待审核）— 2026-06 上半月

> 主题：**先巩固信心（让"已做"被强制保护 + 实测真能跑），再收尾 Phase 1，并为执行层重构（A5）准备设计 checkpoint。**
> 本文件为**待审核计划**；经你批准后才实施。状态基线：main = `5fc0ee8`，0 个开放 PR，工作区干净。

---

## 一、任务状态分类（已核实）

### ✅ 已完成（在 main 上）
| 项 | 验证程度 |
|---|---|
| 仓库拆分 + CI 门禁 + gitleaks + 分支保护 + 项目记忆文档 | CI 实跑 |
| Risk #1 — srt 沙箱隔离 Python 执行 + 密钥剥离 | 容器内端到端 ✅ |
| Risk #2 — bypassPermissions 下仍保留 path 守卫 | 冒烟 + 单元（拒 /etc/passwd）✅ |
| Risk #3/#4 — 8 处跨租户查询加 owner 校验 | ⚠️ **仅静态核对**（信心缺口） |
| Risk #5 — maxTurns + wall-clock watchdog | watchdog 计时隔离验证 ✅ |
| D4 — WS 日志脱敏（0 处残留原始日志） | 单元 ✅ |
| Live model 切换字节 Ark `ark-code-latest` + 冒烟脚本 | 端到端 PASS ✅ |

### ⬜ 待开发（本两周计划覆盖）
- 应用在 Docker/OrbStack 真实跑通验证（**你点名要的**）
- 测试可在 CI 跑（拆 unit/e2e + Postgres service）→ 恢复 `test` 硬门禁
- 跨租户双用户回归测试（补 #3/#4 信心缺口）
- 修 TS 错误 → 恢复 `typecheck` 硬门禁
- C2/C3 客户端心跳 + 协作式 abort（Risk #10）
- B3 统一两个路径守卫
- D1 token/cost 落库、D3 审计表
- 15 个 REST 路由 → Server Functions → 恢复 `validate-routes` 硬门禁
- E5 CI actions 升级（脱离 Node20 弃用）

### ⏸️ 已搁置（需你的决策或外部资源，本两周不做）
- **A5 执行层重构**（ExecutionRuntime + 沙箱池 + 队列；高并发/超越 Deep Agents 的核心）— 需设计 checkpoint + 沙箱后端账号/预算。**本计划只在第 2 周末产出"设计提案"供你拍板，不实施。**
- D2 计费/计量策略 — 需你的业务决策
- A4 glm-image 进程内工具沙箱化
- 部署修复的真机验证（无 Dokploy 访问权）
- Phase 3（追赶 Deep Agents：todo 面板 / 子 agent 面板 / HITL / checkpoint）
- Phase 4（多模型注册表 / 水平扩展）

---

## 二、第 1 周 — 巩固信心：证明能跑 + 锁死回归保护

| 天 | 任务 | 交付 / 验收 |
|---|---|---|
| D1 | **Docker 全栈实测**（OrbStack，复用现有镜像 + 按需重建当前代码）：起 web + ws-server + Postgres/Redis/MinIO/Meili；验证 DB migrate 完成、服务 healthy、app 响应 HTTP、**经 WS 走一次真实 Ark 聊天**。顺手修 `docker:up` 的 env 插值坑（E1，免手动 source）。 | 一份"运行报告"（读真实输出）+ 一键启动脚本；明确镜像是否需重建 |
| D2–D3 | **测试 CI 可运行**：拆 unit / e2e，CI 加 Postgres service container，unit 跑绿并设为**硬门禁** | CI 上 `test`（unit）变阻塞门禁 |
| D3–D4 | **跨租户双用户回归测试**（补 #3/#4 缺口）：真实 DB，断言用户 B 无法读/改/删用户 A 的 files/attachments/KB；接入 CI | 回归测试在 CI 跑绿 |
| D5 | **修 TS 错误** → 恢复 `typecheck` 硬门禁（批量错误用子 agent 并行修） | typecheck 门禁恢复（或量化推进） |

**第 1 周退出标准**：应用在 Docker 里被证明能跑（含一次真实 Ark 聊天）；unit + 跨租户测试成为 CI 硬门禁；typecheck 门禁恢复或显著推进。

---

## 三、第 2 周 — 收尾 Phase 1 + 可观测 plumbing + A5 设计提案

| 天 | 任务 | 交付 / 验收 |
|---|---|---|
| D6–D7 | **C2/C3（Risk #10）**：客户端心跳 + 空闲超时；worker 崩溃时向 UI 发终止帧；协作式 abort（AbortController，移除死代码 `ws.abortController`） | 冒烟/集成验证：杀 worker/断 socket 后 UI 不再卡死 |
| D8 | **B3** 统一两个路径遍历守卫（`path-security.js` vs 路由 `validateFilePath`） | 同一越界路径在两处被一致拒绝 |
| D9–D10 | **D1** 从 Ark `result` 事件落 token/cost/turns（新表 + 迁移）；**D3** 审计表（本地库迁移验证）。D2 计费策略留你决定 | 每次 run 的用量/成本可见、可查 |
| D10 | **15 个 REST 路由 → Server Functions**（与 #3/#4 重叠）→ 恢复 `validate-routes` 硬门禁 | validate-routes 门禁恢复 |
| 周末 | **产出 A5 执行层重构设计提案**（ExecutionRuntime 接口 + 每会话沙箱池 + 队列/无状态网关 + Plan A 集成 vs Plan B 自建 + 100→1000 并发压测方案）——**仅设计，供你 go/no-go** | 一份决策级设计文档 |

**第 2 周退出标准**：Risk #10 关闭；Phase-1 高风险项均有回归测试；可观测 plumbing 落地；A5 设计提案就绪待你拍板。

---

## 四、执行原则（针对本轮暴露的问题）
- **每次代码改动后 grep 已落盘文件确认改动生效，再宣称完成**（本轮多次 Edit 静默未命中）。
- **任何指标/通过与否必须读真实输出后再写**（本轮出现过臆造数字）。
- 小步 PR + CI + owner 合并；能测就测，不能测的标 `HUMAN-REVIEW.md`。
- 子 agent 用于隔离调查与可并行的简单任务。

## 五、需要你的输入（不阻塞第 1 周）
1. A5 设计提案产出后的 **go/no-go + 沙箱后端选型（Modal/Daytona/E2B/自建）+ 预算**。
2. D2 **计费/计量策略**（一次 run 计费方式、免费额度）。
3. （可选）是否需要我在第 1 周对当前代码**重建 Docker 镜像**（现有镜像是 3 个月前、不含本轮安全修复）。
