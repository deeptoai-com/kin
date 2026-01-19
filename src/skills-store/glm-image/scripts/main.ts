import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { mkdir } from 'node:fs/promises';

type CliArgs = {
  prompt: string | null;
  imagePath: string;
  model: string;
  size: string;
  quality: string;
  watermark: boolean;
  json: boolean;
  help: boolean;
};

type ZhipuImageResponse = {
  created: number;
  data: Array<{ url: string }>;
  content_filter?: Array<{ role: string; level: number }>;
  error?: { code: string; message: string };
};

const API_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/images/generations';

const VALID_MODELS = ['glm-image', 'cogview-4', 'cogview-4-250304', 'cogview-3-flash'];

const VALID_SIZES = [
  '1024x1024', '1280x1280', '768x1344', '1344x768',
  '864x1152', '1152x864', '1440x720', '720x1440',
  '1280x720', '720x1280', '1280x960', '960x1280',
];

function printUsage(): void {
  console.log(`Usage:
  npx -y bun scripts/main.ts --prompt "A cute cat" --image cat.png
  npx -y bun scripts/main.ts "A cute cat" --image cat.png

Options:
  -p, --prompt <text>     Prompt text (required)
  --image <path>          Output image path (default: generated.png)
  -m, --model <id>        Model: ${VALID_MODELS.join(', ')} (default: glm-image)
  --size <WxH>            Image size (default: 1024x1024)
  --quality <level>       Quality: hd, standard (default: hd)
  --watermark             Enable watermark (disabled by default)
  --json                  Output JSON
  -h, --help              Show help

Environment:
  ZHIPU_API_KEY           Zhipu AI API key (required)`);
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    prompt: null,
    imagePath: 'generated.png',
    model: 'glm-image',
    size: '1024x1024',
    quality: 'hd',
    watermark: false,
    json: false,
    help: false,
  };

  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;

    if (a === '--help' || a === '-h') {
      out.help = true;
      continue;
    }

    if (a === '--json') {
      out.json = true;
      continue;
    }

    if (a === '--watermark') {
      out.watermark = true;
      continue;
    }

    if (a === '--prompt' || a === '-p') {
      const v = argv[++i];
      if (!v) throw new Error(`Missing value for ${a}`);
      out.prompt = v;
      continue;
    }

    if (a === '--model' || a === '-m') {
      const v = argv[++i];
      if (!v) throw new Error(`Missing value for ${a}`);
      out.model = v;
      continue;
    }

    if (a === '--size') {
      const v = argv[++i];
      if (!v) throw new Error(`Missing value for ${a}`);
      out.size = v;
      continue;
    }

    if (a === '--quality') {
      const v = argv[++i];
      if (!v) throw new Error(`Missing value for ${a}`);
      out.quality = v;
      continue;
    }

    if (a === '--image' || a.startsWith('--image=')) {
      let v: string | null = null;
      if (a.startsWith('--image=')) {
        v = a.slice('--image='.length).trim();
      } else {
        const maybe = argv[i + 1];
        if (maybe && !maybe.startsWith('-')) {
          v = maybe;
          i++;
        }
      }
      out.imagePath = v && v.length > 0 ? v : 'generated.png';
      continue;
    }

    if (a.startsWith('-')) {
      throw new Error(`Unknown option: ${a}`);
    }

    positional.push(a);
  }

  if (!out.prompt && positional.length > 0) {
    out.prompt = positional.join(' ');
  }

  return out;
}

function normalizeOutputImagePath(p: string): string {
  const full = path.resolve(p);
  const ext = path.extname(full);
  if (ext) return full;
  return `${full}.png`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateImage(
  prompt: string,
  model: string,
  size: string,
  quality: string,
  watermark: boolean,
): Promise<ZhipuImageResponse> {
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    throw new Error('ZHIPU_API_KEY environment variable is required');
  }

  const body = {
    model,
    prompt,
    size,
    quality,
    watermark_enabled: watermark,
  };

  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API request failed: ${response.status} ${response.statusText}\n${text}`);
  }

  const result = await response.json() as ZhipuImageResponse;

  if (result.error) {
    throw new Error(`API error: ${result.error.code} - ${result.error.message}`);
  }

  return result;
}

async function downloadImage(url: string, outputPath: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const dir = path.dirname(outputPath);
  await mkdir(dir, { recursive: true });

  await fs.promises.writeFile(outputPath, buffer);
  return outputPath;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  if (!args.prompt) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  // Validate model
  if (!VALID_MODELS.includes(args.model)) {
    console.error(`Invalid model: ${args.model}. Valid models: ${VALID_MODELS.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  // Validate size (optional - API will reject invalid sizes)
  if (!VALID_SIZES.includes(args.size)) {
    console.warn(`Warning: Size ${args.size} may not be supported. Common sizes: ${VALID_SIZES.slice(0, 4).join(', ')}`);
  }

  const outputPath = normalizeOutputImagePath(args.imagePath);

  let result: ZhipuImageResponse;
  let retries = 1;

  while (true) {
    try {
      result = await generateImage(
        args.prompt,
        args.model,
        args.size,
        args.quality,
        args.watermark,
      );
      break;
    } catch (e) {
      if (retries > 0) {
        retries--;
        console.error(`Generation failed, retrying... (${e instanceof Error ? e.message : String(e)})`);
        await sleep(1000);
        continue;
      }
      throw e;
    }
  }

  if (!result.data || result.data.length === 0 || !result.data[0]?.url) {
    throw new Error('No image URL returned from API');
  }

  const imageUrl = result.data[0].url;
  const savedPath = await downloadImage(imageUrl, outputPath);

  if (args.json) {
    console.log(JSON.stringify({
      success: true,
      savedImage: savedPath,
      model: args.model,
      size: args.size,
      quality: args.quality,
      url: imageUrl,
      created: result.created,
    }, null, 2));
  } else {
    console.log(savedPath);
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(msg);
  process.exit(1);
});
