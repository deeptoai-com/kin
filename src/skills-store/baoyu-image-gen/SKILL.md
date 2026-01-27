---
name: baoyu-image-gen
description: AI image generation supporting MCP (glm-image), Google, and OpenAI APIs. Use MCP mode for secure key management (LLM agents), CLI mode for direct API calls. Supports text-to-image, aspect ratios, and parallel generation. Use when user asks to generate, create, or draw images.
---

# Image Generation (AI SDK)

Multi-provider image generation with **MCP priority** for LLM agents. Supports glm-image (Zhipu), Google, and OpenAI.

## Execution Modes

| Mode | When Used | Security | API Key Storage |
|------|-----------|----------|------------------|
| **MCP Mode** | LLM Agent calls | ✅ Secure (keys in MCP server) | MCP server only |
| **CLI Mode** | Command line execution | ⚠️ Keys in env vars (risk of exposure) | Environment variables |

**Recommendation**: Use MCP mode whenever possible. CLI mode requires manual API key configuration.

## Script Directory

**CLI Mode Only** (when using `npx -y bun` directly):
1. `SKILL_DIR` = this SKILL.md file's directory
2. Script path = `${SKILL_DIR}/scripts/main.ts`

## Preferences (EXTEND.md)

Use Bash to check EXTEND.md existence (priority order):

```bash
# Check project-level first
test -f .baoyu-skills/baoyu-image-gen/EXTEND.md && echo "project"

# Then user-level (cross-platform: $HOME works on macOS/Linux/WSL)
test -f "$HOME/.baoyu-skills/baoyu-image-gen/EXTEND.md" && echo "user"
```

┌──────────────────────────────────────────────────┬───────────────────┐
│                       Path                       │     Location      │
├──────────────────────────────────────────────────┼───────────────────┤
│ .baoyu-skills/baoyu-image-gen/EXTEND.md          │ Project directory │
├──────────────────────────────────────────────────┼───────────────────┤
│ $HOME/.baoyu-skills/baoyu-image-gen/EXTEND.md    │ User home         │
└──────────────────────────────────────────────────┴───────────────────┘

┌───────────┬───────────────────────────────────────────────────────────────────────────┐
│  Result   │                                  Action                                   │
├───────────┼───────────────────────────────────────────────────────────────────────────┤
│ Found     │ Read, parse, apply settings                                               │
├───────────┼───────────────────────────────────────────────────────────────────────────┤
│ Not found │ Use defaults                                                              │
└───────────┴───────────────────────────────────────────────────────────────────────────┘

**EXTEND.md Supports**: Default provider | Default quality | Default aspect ratio

## Usage

### MCP Mode (Recommended for LLM Agents)

**Secure**: API keys stored in MCP server, never exposed in LLM output.

```
mcp__glm-image__generate prompt="A cute cat" imagePath="cat.png" size="1024x1024"

# With aspect ratio
mcp__glm-image__generate prompt="Landscape" imagePath="out.png" size="1792x1024"

# From prompt file
mcp__glm-image__generate prompt="风景画，印象派风格" imagePath="landscape.png" size="1024x1792"
```

### CLI Mode (Legacy - Requires API Keys)

**⚠️ Security Warning**: API keys in environment variables may be exposed in LLM output.

```bash
# Basic
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "A cat" --image cat.png

# With aspect ratio
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "A landscape" --image out.png --ar 16:9

# High quality
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "A cat" --image out.png --quality 2k

# From prompt files
npx -y bun ${SKILL_DIR}/scripts/main.ts --promptfiles system.md content.md --image out.png

# With reference images (Google multimodal only)
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "Make blue" --image out.png --ref source.png

# Specific provider
npx -y bun ${SKILL_DIR}/scripts/main.ts --prompt "A cat" --image cat.png --provider openai
```

## Options

### MCP Mode (glm-image)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | ✅ | Image generation prompt |
| `imagePath` | string | ❌ | Output path (default: `generated.png`) |
| `size` | string | ❌ | Size: `1024x1024` (default), `1792x1024`, `1024x1792`, etc. |
| `quality` | string | ❌ | Quality: `hd` (default), `standard` |
| `watermark` | boolean | ❌ | Enable watermark (default: `false`) |

### CLI Mode

| Option | Description |
|--------|-------------|
| `--prompt <text>`, `-p` | Prompt text |
| `--promptfiles <files...>` | Read prompt from files (concatenated) |
| `--image <path>` | Output image path (required) |
| `--provider google\|openai` | Force provider (default: google) |
| `--model <id>`, `-m` | Model ID |
| `--ar <ratio>` | Aspect ratio (e.g., `16:9`, `1:1`, `4:3`) |
| `--size <WxH>` | Size (e.g., `1024x1024`) |
| `--quality normal\|2k` | Quality preset (default: 2k) |
| `--imageSize 1K\|2K\|4K` | Image size for Google (default: from quality) |
| `--ref <files...>` | Reference images (Google multimodal only) |
| `--n <count>` | Number of images |
| `--json` | JSON output |

## Parameter Mapping

### Aspect Ratio → Size (MCP Mode)

| Aspect Ratio | MCP size | Use Case |
|--------------|----------|----------|
| `1:1` | `1024x1024` | Square images, icons |
| `4:3` | `1152x864` | Landscape photos |
| `3:4` | `864x1152` | Portrait photos |
| `16:9` | `1792x1024` | Widescreen, slides, covers |
| `9:16` | `1024x1792` | Mobile portrait, stories |
| `7:4` | `1344x768` | Wide panorama |
| `4:7` | `768x1344` | Tall portrait |

### Quality Mapping

| CLI Quality | MCP Quality | Google imageSize | OpenAI Size |
|-------------|-------------|-----------------|-------------|
| `normal` | `standard` | 1K | 1024px |
| `2k` | `hd` | 2K | 2048px |

## Environment Variables (CLI Mode Only)

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `GOOGLE_API_KEY` | Google API key |
| `OPENAI_IMAGE_MODEL` | OpenAI model override |
| `GOOGLE_IMAGE_MODEL` | Google model override |
| `OPENAI_BASE_URL` | Custom OpenAI endpoint |
| `GOOGLE_BASE_URL` | Custom Google endpoint |

**Load Priority**: CLI args > env vars > `<cwd>/.baoyu-skills/.env` > `~/.baoyu-skills/.env`

## Provider Selection

### LLM Agent Mode (Automatic)

LLM agents should **always prefer MCP mode** (`mcp__glm-image__generate`) for security:

1. **MCP available** → Use MCP (glm-image)
2. **MCP unavailable** → Fall back to CLI mode with available provider

### CLI Mode

1. `--provider` specified → use it
2. Only one API key available → use that provider
3. Both available → default to Google

## Quality Presets (CLI Mode)

| Preset | Google imageSize | OpenAI Size | Use Case |
|--------|------------------|-------------|----------|
| `normal` | 1K | 1024px | Quick previews |
| `2k` (default) | 2K | 2048px | Covers, illustrations, infographics |

**Google imageSize**: Can be overridden with `--imageSize 1K|2K|4K`

## Aspect Ratios

### MCP Mode (glm-image)
See [Parameter Mapping](#parameter-mapping) table for exact size values.

### CLI Mode
Supported: `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `2.35:1`

- Google multimodal: uses `imageConfig.aspectRatio`
- Google Imagen: uses `aspectRatio` parameter
- OpenAI: maps to closest supported size

## Parallel Generation

Supports concurrent image generation via background subagents for batch operations.

| Setting | Value |
|---------|-------|
| Recommended concurrency | 4 subagents |
| Max concurrency | 8 subagents |
| Use case | Batch generation (slides, comics, infographics) |

**Agent Implementation**:
```
# Launch multiple generations in parallel using Task tool
# Each Task runs as background subagent with run_in_background=true
# Collect results via TaskOutput when all complete
```

**Best Practice**: When generating 4+ images, spawn background subagents (recommended 4 concurrent) instead of sequential execution.

## Error Handling

### MCP Mode
- MCP not available → Fall back to CLI mode if possible
- Generation failure → MCP handles retry automatically
- Invalid size → Use default `1024x1024`

### CLI Mode
- Missing API key → Error with setup instructions
- Generation failure → Auto-retry once
- Invalid aspect ratio → Warning, proceed with default
- Reference images with non-multimodal model → Warning, ignore refs

## Security Considerations

| Mode | API Key Exposure Risk | Recommendation |
|------|----------------------|----------------|
| **MCP Mode** | ✅ None (keys in MCP server) | **Always use when available** |
| **CLI Mode** | ⚠️ Possible (LLM may output keys) | Use only when MCP unavailable |

**Important**: When using CLI mode, be aware that API keys stored in environment variables may be exposed in LLM output or logs.

## Extension Support

Custom configurations via EXTEND.md. See **Preferences** section for paths and supported options.
