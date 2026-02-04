import { createFileRoute } from '@tanstack/react-router';
import { getSkillIconData } from '~/claude/skills/icon-generator';

/**
 * API Route: GET /api/skills/icon/:slug
 *
 * Serves skill icons from the skills store directory.
 * Icons are stored in /data/skills-store/icons/{slug}.png in Docker.
 */
export const Route = createFileRoute('/api/skills/icon/$slug')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { slug } = params;

        if (!slug || typeof slug !== 'string') {
          return new Response('Not Found', { status: 404 });
        }

        const iconData = getSkillIconData(slug);

        if (!iconData) {
          return new Response('Not Found', { status: 404 });
        }

        return new Response(iconData, {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
          },
        });
      },
    },
  },
});
