/**
 * Skill Icon Generation Service
 *
 * Uses Google Gemini 2.5 Flash Image model to generate consistent,
 * stylized icons for skills based on their descriptions.
 *
 * Features:
 * - Automatic generation on skill upload
 * - Manual regeneration support
 * - Consistent pastel neon flat icon style
 * - Stored in skills-store/icons/{slug}.png (writable volume in Docker)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getSkillsStoreDir } from './manager';

// Icon generation configuration
export const ICON_CONFIG = {
  // Output settings - stored in skills store (writable volume)
  outputSubdir: 'icons',
  outputFormat: 'png' as const,
  // URL prefix for API route that serves icons
  urlPrefix: '/api/skills/icon',

  // Gemini API settings
  model: 'gemini-2.5-flash-image',
  apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models',

  // Image settings
  imageSize: '1K', // 1K is sufficient for icons
  aspectRatio: '1:1', // Square icons

  // Style prompt template - sticker illustration style
  stylePrompt: `Professional high-quality sticker illustration of: {description}.

STYLE REQUIREMENTS:
1. BACKGROUND: Solid, flat, uniform light warm gray color. Use hex #F0EFED or similar (very light grayish beige).
   The entire background must be this single solid color with NO variation, NO gradients, NO shadows, NO lighting effects.

2. WHITE OUTLINE: The subject MUST have a clean white outline/border (2-3 pixels wide) separating it from the background.

3. SHARP EDGES: The subject should have crisp, sharp, well-defined edges - no soft or blurry boundaries.

4. CENTERED: Subject should be centered with adequate padding around all sides.

5. STYLE: Vibrant, clean, cartoon/illustration sticker style with bold colors. Modern app icon aesthetic.

6. SIZE: 256x256 pixels, single icon only.`,
} as const;

/**
 * Get the icon storage directory (inside skills store)
 */
function getIconsDir(): string {
  return path.join(getSkillsStoreDir(), ICON_CONFIG.outputSubdir);
}

/**
 * Get the file path for a skill icon
 */
function getIconPath(slug: string): string {
  return path.join(getIconsDir(), `${slug}.${ICON_CONFIG.outputFormat}`);
}

/**
 * Generate an icon for a skill using Gemini API
 */
export async function generateSkillIcon(
  slug: string,
  description: string
): Promise<{ success: boolean; iconUrl?: string; error?: string }> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error('[IconGen] GEMINI_API_KEY not configured');
    return { success: false, error: 'GEMINI_API_KEY not configured' };
  }

  if (!description || description.trim().length === 0) {
    console.error('[IconGen] No description provided for icon generation');
    return { success: false, error: 'No description provided' };
  }

  try {
    // Build the prompt
    const prompt = ICON_CONFIG.stylePrompt.replace('{description}', description.trim());

    console.log(`[IconGen] Generating icon for "${slug}"...`);

    // Call Gemini API
    const response = await fetch(
      `${ICON_CONFIG.apiEndpoint}/${ICON_CONFIG.model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[IconGen] Gemini API error:', response.status, errorText);
      return { success: false, error: `Gemini API error: ${response.status}` };
    }

    const data = await response.json();

    // Extract image from response
    const parts = data.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) {
      console.error('[IconGen] No parts in response');
      return { success: false, error: 'No image generated' };
    }

    // Find the image part
    const imagePart = parts.find((part: any) => part.inlineData);
    if (!imagePart || !imagePart.inlineData) {
      console.error('[IconGen] No image data in response');
      return { success: false, error: 'No image data in response' };
    }

    // Decode base64 and save to file
    const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
    const outputPath = getIconPath(slug);

    // Ensure directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write the file
    fs.writeFileSync(outputPath, imageBuffer);

    const iconUrl = `${ICON_CONFIG.urlPrefix}/${slug}`;
    console.log(`[IconGen] Generated icon for "${slug}" -> ${outputPath}`);

    return { success: true, iconUrl };
  } catch (error) {
    console.error('[IconGen] Error generating icon:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check if an icon exists for a skill
 */
export function skillIconExists(slug: string): boolean {
  const iconPath = getIconPath(slug);
  return fs.existsSync(iconPath);
}

/**
 * Get the icon URL for a skill (returns undefined if not exists)
 */
export function getSkillIconUrl(slug: string): string | undefined {
  if (skillIconExists(slug)) {
    return `${ICON_CONFIG.urlPrefix}/${slug}`;
  }
  return undefined;
}

/**
 * Get the raw icon data for a skill (for serving via API)
 */
export function getSkillIconData(slug: string): Buffer | null {
  const iconPath = getIconPath(slug);
  try {
    if (fs.existsSync(iconPath)) {
      return fs.readFileSync(iconPath);
    }
    return null;
  } catch (error) {
    console.error('[IconGen] Error reading icon:', error);
    return null;
  }
}

/**
 * Delete a skill icon
 */
export function deleteSkillIcon(slug: string): boolean {
  const iconPath = getIconPath(slug);

  try {
    if (fs.existsSync(iconPath)) {
      fs.unlinkSync(iconPath);
      console.log(`[IconGen] Deleted icon for "${slug}"`);
      return true;
    }
    return false;
  } catch (error) {
    console.error('[IconGen] Error deleting icon:', error);
    return false;
  }
}
