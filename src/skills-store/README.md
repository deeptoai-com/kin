# Skills Store (legacy FS store — being retired)

> **状态（2026-06）**：历史的本地 FS 技能资产（8 个 `baoyu-*`）已**删除**，走干净路线。
> Skills 的真相源已迁移到 **DB catalog**（`skill_catalog`）+ skills-api 内容 + 按用户安装（`skill_enablement` → 物化到 `~/.claude/skills/`）。
> 详见 `docs/project/prd/2026-06-skills-integration-prd.md`。

## 这个目录现在还剩什么用

- 仍是 `getSkillsStoreDir()` / `seedSkillsStore()` / `manager.ts` 的回退路径，但目前**为空**（仅本 README）。
- `getSkillsStore()` 在空目录下返回 `[]`，所有相关 UI/接口优雅降级（不报错）。
- 后续若要重新引入"本地内置技能"，可在此放置目录；但优先走 catalog（`source='builtin'` + 内容缓存）。

## 已知的待办（skills 体系完成后再处理）

- 聊天 composer 上方的 skills 快捷入口 / A2Composer 模板（`src/lib/a2composer/config.ts` 里仍引用 `baoyu-*` 的 `skillHint`）在本地资产删除后**功能失效**（模板文本仍可用，但不再自动挂载技能）。这是**有意为之的过渡态**，待 Skills 整体完成后统一重做。

## 历史格式（供参考）

每个 Skill 是一个目录，含 `SKILL.md`（YAML frontmatter：`name` / `description` / `category` + 指令正文）。
