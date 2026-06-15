import { MeiliSearch } from 'meilisearch'
import { HL_PRE, HL_POST } from '~/lib/search-highlight'

const host = process.env.MEILI_HOST ?? 'http://localhost:7700'
const apiKey = process.env.MEILI_API_KEY ?? process.env.MEILI_MASTER_KEY

export const meili = new MeiliSearch({
  host,
  apiKey,
})

export type SearchDoc = {
  id: string
  title?: string
  content?: string
  fileName?: string
  symbols?: string[]
  headings?: string[]
}

export async function ensureIndexes() {
  try {
    await meili.createIndex('documents', { primaryKey: 'id' })
  } catch {
    // index likely exists
  }
  // RAG R1 (final spec D7/D8): chunk-level BM25 index — the keyword leg of kb_search's
  // hybrid retrieval. documentId is filterable so deletion and access scoping can filter.
  try {
    await meili.createIndex(CHUNKS_INDEX, { primaryKey: 'id' })
  } catch {
    // index likely exists
  }
  try {
    await meili.index(CHUNKS_INDEX).updateFilterableAttributes(['documentId'])
  } catch {
    // best-effort: settings update failing must not block boot
  }
  // Conversation search: per-message full-text index projected from session JSONL.
  // Isolation rides on filterableAttributes (userId/projectId); sort by recency.
  try {
    await meili.createIndex(MESSAGES_INDEX, { primaryKey: 'id' })
  } catch {
    // index likely exists
  }
  try {
    await meili.index(MESSAGES_INDEX).updateFilterableAttributes(['userId', 'projectId', 'sessionId', 'role'])
  } catch {
    // best-effort
  }
  try {
    await meili.index(MESSAGES_INDEX).updateSortableAttributes(['createdAt'])
  } catch {
    // best-effort
  }
  try {
    // Body-only search: message search matches conversation text. Title matching is the
    // existing instant title-filter mode of ⌘K — keeping `title` searchable here would
    // surface message hits whose body doesn't contain the query (snippet without highlight),
    // confusingly overlapping the title mode. `title` stays a stored/displayed field.
    await meili.index(MESSAGES_INDEX).updateSearchableAttributes(['text'])
  } catch {
    // best-effort
  }
}

export async function indexDocuments(docs: SearchDoc[]) {
  const index = meili.index<SearchDoc>('documents')
  await index.addDocuments(docs)
}

// ── RAG chunks (final spec D7: BM25 leg of hybrid retrieval) ──────────────────

export const CHUNKS_INDEX = 'document_chunks'

export type SearchChunk = {
  /** documentChunks.id — joins BM25 hits back to pgvector rows for RRF fusion. */
  id: string
  documentId: string
  sectionPath?: string | null
  text: string
}

export async function indexChunks(chunks: SearchChunk[]) {
  if (chunks.length === 0) return
  await ensureIndexes()
  await meili.index<SearchChunk>(CHUNKS_INDEX).addDocuments(chunks)
}

export async function removeChunksOfDocument(documentId: string) {
  try {
    await meili.index(CHUNKS_INDEX).deleteDocuments({ filter: `documentId = "${documentId}"` })
  } catch {
    // index may not exist yet — nothing to remove
  }
}

/** BM25 search over chunks, scoped to the given (already access-filtered) document ids. */
export async function searchChunks(query: string, documentIds: string[], limit = 20) {
  if (documentIds.length === 0) return []
  const filter = `documentId IN [${documentIds.map((id) => `"${id}"`).join(', ')}]`
  const res = await meili.index<SearchChunk>(CHUNKS_INDEX).search(query, { filter, limit })
  return res.hits
}

// ── Conversation messages (full-text search over chat history) ────────────────

export const MESSAGES_INDEX = 'messages'

export type SearchMessageDoc = {
  id: string // composite PK `${sessionId}__${messageId}` — unique across branched/forked sessions
  messageId: string // raw SDK message uuid (the deep-link DOM anchor)
  sessionId: string
  userId: string
  projectId: string | null
  role: 'user' | 'assistant'
  text: string
  createdAt: number
  title: string
}

export async function indexMessages(msgs: SearchMessageDoc[]) {
  if (msgs.length === 0) return
  await ensureIndexes()
  await meili.index<SearchMessageDoc>(MESSAGES_INDEX).addDocuments(msgs)
}

export async function removeMessagesOfSession(sessionId: string) {
  try {
    await meili.index(MESSAGES_INDEX).deleteDocuments({ filter: `sessionId = "${sessionId}"` })
  } catch {
    // index may not exist yet — nothing to remove
  }
}

/** Quote/escape a value for a Meili filter string literal. */
function meiliQuote(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export type MessageSearchScope = {
  userId: string
  projectIds: string[]
  /** Optional narrowing within the visible scope. */
  projectId?: string
  role?: 'user' | 'assistant'
}

/**
 * Build the Meili isolation filter, mirroring `visibleSessionsWhere` 1:1 (access.ts:69):
 *   personal/loose = (userId = me AND projectId IS NULL)   -- only loose sessions by owner
 *   project        = projectId IN myAccessibleProjects     -- membership = access, owner-agnostic
 * The loose clause MUST guard `projectId IS NULL` — a bare `userId = me` would still match my
 * own messages in a project I've since been removed from, which canAccessSession (access.ts:84)
 * rejects. Pure + exported so the isolation boundary is unit-tested without a live Meili.
 */
export function buildMessageSearchFilter(scope: MessageSearchScope): string {
  const ors = [`(userId = ${meiliQuote(scope.userId)} AND projectId IS NULL)`]
  if (scope.projectIds.length > 0) {
    ors.push(`projectId IN [${scope.projectIds.map(meiliQuote).join(', ')}]`)
  }
  let filter = `(${ors.join(' OR ')})`
  if (scope.projectId) filter += ` AND projectId = ${meiliQuote(scope.projectId)}`
  if (scope.role) filter += ` AND role = ${meiliQuote(scope.role)}`
  return filter
}

/**
 * Full-text search over messages, scoped to what the user may see (see buildMessageSearchFilter).
 * Highlights use NON-HTML sentinel tags (HL_PRE/HL_POST) so the snippet can be HTML-escaped
 * before rendering — see src/lib/search-highlight.ts (XSS defence). Recency-sorted.
 * Caller (server fn) is responsible for try/catch graceful degradation.
 */
export async function searchMessages(query: string, scope: MessageSearchScope, limit = 20) {
  const res = await meili.index<SearchMessageDoc>(MESSAGES_INDEX).search(query, {
    filter: buildMessageSearchFilter(scope),
    limit,
    sort: ['createdAt:desc'],
    attributesToCrop: ['text'],
    cropLength: 60,
    attributesToHighlight: ['text'],
    highlightPreTag: HL_PRE,
    highlightPostTag: HL_POST,
  })
  return res.hits
}