# Skills Store

此目录存储所有可用的 Skills。

## 目录结构

每个 Skill 应该是一个独立的目录，包含：

- `SKILL.md`（必需）
- 其他相关文件（可选）

## 示例

```
skills-store/
├── example-skill/
│   ├── SKILL.md
│   └── ...
└── another-skill/
    ├── SKILL.md
    └── ...
```

## Skills 格式

所有 Skills 使用统一的 `SKILL.md` 格式（带 YAML frontmatter）：

```markdown
---
name: skill-name
description: Skill 描述
category: development
---

# Skill 名称

Claude 在该 Skill 激活时应遵循的指令。

## 示例
- 示例用法 1
- 示例用法 2
```

## 管理

- **添加 Skill**：在此目录下创建新的 Skill 目录
- **更新 Skill**：直接修改对应的 Skill 目录内容
- **删除 Skill**：删除对应的 Skill 目录

用户开启的 Skill 会自动从此目录复制到 `USER_DATA_DIR/<userId>/.claude/skills/`。
