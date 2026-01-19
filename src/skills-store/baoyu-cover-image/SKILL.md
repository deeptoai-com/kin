---
name: baoyu-cover-image
description: Generate elegant cover images for articles. Analyzes content and creates eye-catching hand-drawn style cover images with multiple style options. Use when user asks to "generate cover image", "create article cover", or "make a cover for article".
---

# Cover Image Generator

Generate hand-drawn style cover images for articles with multiple style options.

## Usage

```bash
# From markdown file (auto-select style based on content)
/baoyu-cover-image path/to/article.md

# Specify a style
/baoyu-cover-image path/to/article.md --style tech
/baoyu-cover-image path/to/article.md --style warm
/baoyu-cover-image path/to/article.md --style bold

# Without title text
/baoyu-cover-image path/to/article.md --no-title

# Combine options
/baoyu-cover-image path/to/article.md --style minimal --no-title

# From direct text input
/baoyu-cover-image
[paste content or describe the topic]

# Direct input with style
/baoyu-cover-image --style playful
[paste content]
```

## Options

| Option | Description |
|--------|-------------|
| `--style <name>` | Specify cover style (see Style Gallery below) |
| `--aspect <ratio>` | Aspect ratio: 2.35:1 (cinematic, default), 16:9 (widescreen), 1:1 (social) |
| `--lang <code>` | Output language for title text (en, zh, ja, etc.) |
| `--no-title` | Generate cover without title text (visual only) |

## Style Gallery

| Style | Description |
|-------|-------------|
| `elegant` (Default) | Refined, sophisticated, understated |
| `tech` | Modern, clean, futuristic |
| `warm` | Friendly, approachable, human-centered |
| `bold` | High contrast, attention-grabbing, energetic |
| `minimal` | Ultra-clean, zen-like, focused |
| `playful` | Fun, creative, whimsical |
| `nature` | Organic, calm, earthy |
| `retro` | Vintage, nostalgic, classic |

Detailed style definitions: `references/styles/<style>.md`

## Auto Style Selection

When no `--style` is specified, the system analyzes content to select the best style:

| Content Signals | Selected Style |
|----------------|----------------|
| AI, coding, tech, digital, algorithm | `tech` |
| Personal story, emotion, growth, life | `warm` |
| Controversial, urgent, must-read, warning | `bold` |
| Simple, zen, focus, essential | `minimal` |
| Fun, easy, beginner, casual, tutorial | `playful` |
| Nature, eco, wellness, health, organic | `nature` |
| History, classic, vintage, old, traditional | `retro` |
| Business, professional, strategy, analysis | `elegant` |

## File Management

### With Article Path

Save to `[source-name-no-ext]/cover-image/` subdirectory in the same folder as the article:

```
path/to/
├── article.md
└── article/
    └── cover-image/
        ├── prompts/
        │   └── cover.md
        └── cover.png
```

Example: `/posts/ai-future.md` → `/posts/ai-future/cover-image/`

### Without Article Path (Pasted Content)

Save to `./cover-image/[topic-slug]/`:

```
cover-image/
└── ai-future/
    ├── source.md           # Saved pasted content
    ├── prompts/
    │   └── cover.md
    └── cover.png
```

### Directory Backup

If target directory exists, rename existing to `<dirname>-backup-YYYYMMDD-HHMMSS`

## Workflow

### Step 1: Analyze Content

1. **Save source content** (if not already a file):
   - If user provides a file path: use as-is
   - If user pastes content: save to `source.md` in target directory

2. **Extract key information**:
   - **Main topic**: What is the article about?
   - **Core message**: What's the key takeaway?
   - **Tone**: Serious, playful, inspiring, educational?
   - **Keywords**: Identify style-signaling words

3. **Language detection**:
   - Detect **source language** from content
   - Detect **user language** from conversation context
   - Note if source_language ≠ user_language (will ask in Step 3)

### Step 2: Determine Options

1. **Style selection**:
   - If `--style` specified, use that style
   - Otherwise, scan content for style signals and auto-select 3 candidates
   - Default to `elegant` if no clear signals

2. **Aspect ratio**:
   - If `--aspect` specified, use that ratio
   - Otherwise, prepare options: 2.35:1 (cinematic), 16:9 (widescreen), 1:1 (social)

### Step 3: Confirm Options

**Purpose**: Let user confirm all options in a single step before generation.

**IMPORTANT**: Present ALL options in a single confirmation step using AskUserQuestion. Do NOT interrupt workflow with multiple separate confirmations.

**Determine which questions to ask**:

| Question | When to Ask |
|----------|-------------|
| Style | Always (required) |
| Aspect ratio | Always (offer common options) |
| Language | Only if `source_language ≠ user_language` |

**Present options** (use AskUserQuestion with all applicable questions):

**Question 1 (Style)** - always:
- Style A (recommended): [style name] - [brief description]
- Style B: [style name] - [brief description]
- Style C: [style name] - [brief description]
- Custom: Provide custom style reference

**Question 2 (Aspect)** - always:
- 2.35:1 Cinematic (Recommended) - ultra-wide, dramatic
- 16:9 Widescreen - standard video/presentation
- 1:1 Square - social media optimized

**Question 3 (Language)** - only if source ≠ user language:
- [Source language] (matches content)
- [User language] (your preference)

**Language handling**:
- If source language = user language: Just inform user (e.g., "Title will be in Chinese")
- If different: Ask which language to use for title text

### Step 4: Generate Cover Concept

Create a cover image concept based on selected style:

**Title** (if included, max 8 characters):
- Distill the core message into a punchy headline
- Use hooks: numbers, questions, contrasts, pain points
- Skip if `--no-title` flag is used

**Visual Elements**:
- Style-appropriate imagery and icons
- 1-2 symbolic elements representing the topic
- Metaphors or analogies that fit the style

### Step 5: Create Prompt File

Save prompt to `prompts/cover.md` with confirmed options.

**All prompts are written in the user's confirmed language preference.**

**Prompt Format**:

```markdown
Cover theme: [topic in 2-3 words]
Style: [selected style name]
Aspect ratio: [confirmed aspect ratio]

[If title included:]
Title text: [8 characters or less, in confirmed language]
Subtitle: [optional, in confirmed language]

Visual composition:
- Main visual: [description matching style]
- Layout: [positioning based on title inclusion and aspect ratio]
- Decorative elements: [style-appropriate elements]

Color scheme:
- Primary: [style primary color]
- Background: [style background color]
- Accent: [style accent color]

Style notes: [specific style characteristics to emphasize]

[If no title:]
Note: No title text, pure visual illustration only.
```

### Step 6: Generate Image

**Image Generation Skill Selection**:
1. Check available image generation skills
2. If multiple skills available, ask user to choose

**Generation**:
Call selected image generation skill with prompt file, output path, and confirmed aspect ratio.

### Step 7: Output Summary

```
Cover Image Generated!

Topic: [topic]
Style: [style name]
Aspect: [aspect ratio]
Title: [cover title] (or "No title - visual only")
Language: [confirmed language]
Location: [output path]

Preview the image to verify it matches your expectations.
```

## Notes

- Cover should be instantly understandable at small preview sizes
- Title (if included) must be readable and impactful
- Visual metaphors work better than literal representations
- Maintain style consistency throughout the cover
- Image generation typically takes 10-30 seconds
- Title text uses user's confirmed language preference
- Aspect ratio: 2.35:1 for cinematic/dramatic, 16:9 for widescreen, 1:1 for social media

## Extension Support

Custom styles and configurations via EXTEND.md.

**Check paths** (priority order):
1. `.baoyu-skills/baoyu-cover-image/EXTEND.md` (project)
2. `~/.baoyu-skills/baoyu-cover-image/EXTEND.md` (user)

If found, load before Step 1. Extension content overrides defaults.
