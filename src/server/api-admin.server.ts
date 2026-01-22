/**
 * API Admin Guard
 *
 * Enforces system admin access for API routes and returns JSON errors.
 */

import { auth } from '~/server/auth.server'
import { db } from '~/db/db-config'
import { user as userTable } from '~/db/schema'
import { eq } from 'drizzle-orm'

export type ApiAdminUser = {
  id: string
  email: string
  name?: string | null
  systemRole: string
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function requireApiAdmin(request: Request): Promise<{ user: ApiAdminUser }> {
  const session = await auth.api.getSession({ headers: request.headers })

  if (!session?.user) {
    throw jsonError('Unauthorized', 401)
  }

  const userData = await db.query.user.findFirst({
    where: eq(userTable.id, session.user.id),
  })

  if (!userData) {
    throw jsonError('Unauthorized', 401)
  }

  if (userData.systemRole !== 'admin') {
    throw jsonError('Forbidden: Admin access required', 403)
  }

  return {
    user: {
      id: userData.id,
      email: userData.email,
      name: userData.name,
      systemRole: userData.systemRole,
    },
  }
}
