/**
 * Grant admin role to a user by email
 * Usage: DATABASE_URL="..." npx tsx scripts/grant-admin.ts <email>
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../src/server/db/auth.schema';

const email = process.argv[2];

if (!email) {
  console.error('Usage: DATABASE_URL="..." npx tsx scripts/grant-admin.ts <email>');
  console.error('Example: DATABASE_URL="..." npx tsx scripts/grant-admin.ts foreveryh@gmail.com');
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

async function grantAdmin() {
  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  try {
    console.log(`Looking for user with email: ${email}`);

    // Find user by email
    const users = await db.select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      systemRole: schema.user.systemRole,
    })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);

    if (!users || users.length === 0) {
      console.error(`User with email "${email}" not found`);
      console.log('\nTip: Make sure you have logged in at least time via GitHub OAuth');
      process.exit(1);
    }

    const user = users[0];
    console.log(`Found user:`, user);

    if (user.systemRole === 'admin') {
      console.log(`User "${email}" already has admin role`);
      process.exit(0);
    }

    // Update to admin
    await db.update(schema.user)
      .set({ systemRole: 'admin' })
      .where(eq(schema.user.email, email));

    console.log(`\n✅ Successfully granted admin role to "${email}"`);

    // Verify
    const updated = await db.select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      systemRole: schema.user.systemRole,
    })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);

    console.log('Updated user:', updated[0]);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

grantAdmin();
