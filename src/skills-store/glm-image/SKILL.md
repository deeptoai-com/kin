---
name: glm-image
description: Image generation skill using Zhipu GLM-Image API. Generates images from text prompts via official API. Use as the image generation backend for other skills like cover-image, xhs-images, article-illustrator.
category: image-generation
---

# GLM Image Generator

Generate images using Zhipu's GLM-Image API (cogview series models).

## Script Directory

**Important**: All scripts are located in the `scripts/` subdirectory of this skill.

**Agent Execution Instructions**:
1. Determine this SKILL.md file's directory path as `SKILL_DIR`
2. Script path = `${SKILL_DIR}/scripts/<script-name>.ts`
3. Replace all `${SKILL_DIR}` in this document with the actual path

**Script Reference**:
| Script | Purpose |
|--------|---------|
| `scripts/main.ts` | CLI entry point for image generation |

## Quick Start

```bash
# Generate image with default output path (./generated.png)
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "A cute cat"

# Generate image with custom output path
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "A sunset over mountains" --image sunset.png

# Shorthand
npx -y bun ${SKILL_DIR}/scripts/main.ts "A dragon" --image=dragon.png

# With specific size
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "A robot" --image robot.png --size 1024x1024
```

## Commands

### Image Generation

```bash
# Simple prompt (positional)
npx -y bun ${SKILL_DIR}/scripts/main.ts "Your prompt here" --image output.png

# Explicit prompt flag
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "Your prompt here" --image output.png
npx -y bun ${SKILL_DIR}/scripts/main.ts -p "Your prompt here" --image output.png

# With model selection
npx -y bun ${SKILL_DIR}/scripts/main.ts -p "A cat" --image cat.png -m cogview-4

# With size
npx -y bun ${SKILL_DIR}/scripts/main.ts -p "A landscape" --image land.png --size 1280x720
```

### Output Formats

```bash
# Default output (image path)
npx -y bun ${SKILL_DIR}/scripts/main.ts "Hello" --image out.png

# JSON output
npx -y bun ${SKILL_DIR}/scripts/main.ts "Hello" --image out.png --json
```

## Options

| Option | Description |
|--------|-------------|
| `--prompt <text>`, `-p` | Prompt text (required) |
| `--image <path>` | Output image path (default: generated.png) |
| `--model <id>`, `-m` | Model: glm-image (default), cogview-4, cogview-4-250304, cogview-3-flash |
| `--size <WxH>` | Image size: 1024x1024 (default), 1280x720, 720x1280, etc. |
| `--quality <level>` | Quality: hd (default), standard |
| `--watermark` | Enable watermark (disabled by default) |
| `--json` | Output as JSON |
| `--help`, `-h` | Show help |

## Models

| Model | Description |
|-------|-------------|
| `glm-image` | Default, balanced quality and speed |
| `cogview-4` | Latest generation, best quality |
| `cogview-4-250304` | Specific version of cogview-4 |
| `cogview-3-flash` | Fast, lightweight |

## Supported Sizes

Common aspect ratios:
- `1024x1024` - Square (default)
- `1280x720` - Landscape 16:9
- `720x1280` - Portrait 9:16
- `1280x1280` - Large square
- `768x1344` - Portrait 4:7
- `1344x768` - Landscape 7:4

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZHIPU_API_KEY` | Zhipu AI API key (required) |

## Examples

### Generate a simple image
```bash
npx -y bun ${SKILL_DIR}/scripts/main.ts "A photorealistic image of a golden retriever puppy" --image puppy.png
```

### Generate with specific model and size
```bash
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "A futuristic city" --image city.png --model cogview-4 --size 1280x720
```

### Get JSON output for parsing
```bash
npx -y bun ${SKILL_DIR}/scripts/main.ts "Hello" --image out.png --json
```

## Notes

- API key is required via `ZHIPU_API_KEY` environment variable
- Image generation typically takes 5-30 seconds
- Auto-retry once on generation failure
- HD quality by default for best results

## Extension Support

Custom configurations via EXTEND.md.

**Check paths** (priority order):
1. `.glm-image/EXTEND.md` (project)
2. `~/.glm-image/EXTEND.md` (user)

If found, load before workflow. Extension content overrides defaults.
