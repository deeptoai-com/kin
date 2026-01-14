import type { Config } from "drizzle-kit"

// Validate DATABASE_URL is set
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    throw new Error(
        'DATABASE_URL environment variable is not set. ' +
        'Please set DATABASE_URL in your environment variables or Docker Compose configuration.'
    );
}

// Validate DATABASE_URL format (basic check)
if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://')) {
    throw new Error(
        `DATABASE_URL must start with "postgresql://" or "postgres://". ` +
        `Current value: ${databaseUrl.substring(0, 20)}...`
    );
}

export default {
    out: "./drizzle",
    schema: "./src/db/schema/index.ts",
    dialect: "postgresql",
    dbCredentials: {
        url: databaseUrl
    },
    verbose: true,
    strict: true
} satisfies Config
