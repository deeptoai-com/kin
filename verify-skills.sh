#!/bin/bash

echo "=== Skills 验证脚本 ==="
echo ""

# 1. 检查 Skills Store
echo "📦 Skills Store (src/skills-store/):"
for dir in src/skills-store/*/; do
  if [ -d "$dir" ] && [ "$(basename "$dir")" != "README.md" ]; then
    skill_name=$(basename "$dir")

    # 检查是否有 SKILL.md
    if [ -f "$dir/SKILL.md" ]; then
      echo "  ✅ $skill_name"

      # Extract name and description from YAML frontmatter
      if grep -q "^---" "$dir/SKILL.md" 2>/dev/null; then
        # Has YAML frontmatter
        name=$(sed -n '/^---$/,/^---$/p' "$dir/SKILL.md" | grep "^name:" | cut -d: -f2- | xargs)
        desc=$(sed -n '/^---$/,/^---$/p' "$dir/SKILL.md" | grep "^description:" | cut -d: -f2- | xargs)

        [ -n "$name" ] && echo "     - name: $name"
        [ -n "$desc" ] && echo "     - description: $desc"
      else
        # Legacy format without frontmatter
        title=$(head -1 "$dir/SKILL.md" | sed 's/^#* //')
        echo "     - title: $title"
      fi
    else
      echo "  ❌ $skill_name (缺少 SKILL.md)"
    fi
  fi
done

echo ""
echo "👤 用户已启用的 Skills (user-data/):"

if [ ! -d "user-data" ]; then
  echo "  ⚠️  user-data 目录不存在"
  echo "  💡 请先在 UI 中发起一次对话"
  exit 0
fi

# 查找所有用户
found_users=false
for user_dir in user-data/*/; do
  if [ -d "$user_dir" ]; then
    found_users=true
    user_id=$(basename "$user_dir")
    echo ""
    echo "  用户: $user_id"

    skills_dir="$user_dir.claude/skills"
    if [ -d "$skills_dir" ]; then
      skill_count=$(find "$skills_dir" -mindepth 1 -maxdepth 1 -type d | wc -l | xargs)
      echo "    已启用: $skill_count 个 Skills"

      for skill_dir in "$skills_dir"/*/; do
        if [ -d "$skill_dir" ]; then
          skill_name=$(basename "$skill_dir")
          echo "      ✅ $skill_name"
        fi
      done
    else
      echo "    ⚠️  未启用任何 Skills"
    fi
  fi
done

if ! $found_users; then
  echo "  ⚠️  未找到用户数据"
  echo "  💡 请先在 UI 中发起一次对话"
fi

echo ""
echo "=== 完成 ==="
