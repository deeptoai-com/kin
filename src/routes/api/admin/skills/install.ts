import { createFileRoute } from '@tanstack/react-router'
import { parseSkillsCommand } from '~/claude/skills/command-parser'
import { installSkillFromGitHub } from '~/claude/skills/github-installer'
import { requireApiAdmin } from '~/server/api-admin.server'

export const Route = createFileRoute('/api/admin/skills/install')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { user } = await requireApiAdmin(request)

          let payload: { command?: string }
          try {
            payload = await request.json()
          } catch {
            return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
              status: 400,
              headers: { 'content-type': 'application/json' },
            })
          }

          const command = payload.command?.trim()
          if (!command) {
            return new Response(JSON.stringify({ error: 'Command is required' }), {
              status: 400,
              headers: { 'content-type': 'application/json' },
            })
          }

          const parsed = parseSkillsCommand(command)
          if (!parsed.valid) {
            return new Response(JSON.stringify({ error: parsed.error || 'Invalid command' }), {
              status: 400,
              headers: { 'content-type': 'application/json' },
            })
          }

          const result = await installSkillFromGitHub({
            owner: parsed.owner!,
            repo: parsed.repo!,
            skillName: parsed.skillName!,
            installedBy: user.id,
          })

          if (!result.success) {
            return new Response(JSON.stringify({ error: result.error || 'Install failed' }), {
              status: 400,
              headers: { 'content-type': 'application/json' },
            })
          }

          return new Response(
            JSON.stringify({
              success: true,
              skill: {
                slug: result.skillName,
                name: result.metadata?.name,
                description: result.metadata?.description,
                category: result.metadata?.category,
                source: result.source,
              },
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }
          )
        } catch (error) {
          if (error instanceof Response) {
            return error
          }

          console.error('[POST /api/admin/skills/install] Error:', error)
          return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          })
        }
      },
    },
  },
})
