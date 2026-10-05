import 'reflect-metadata';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { normalizeKzPhone, passwordSchema } from '@lastsize/contracts';
import { auditLogs, createDatabase, createPool, eq, userRoles, users } from '@lastsize/db';
import { PasswordService } from '../auth/password.service';

/**
 * Creates the first staff account, or grants a staff role to an existing user.
 *
 *   node dist/cli/create-admin.js --phone "+7 701 123 45 67" --name "Miras" [--role ADMIN]
 *
 * The password is read from standard input, so it never appears in the shell history or
 * the process list. On first sign-in the account must set up an authenticator app.
 */
/** Reads one line from stdin; in a terminal the typed characters are not echoed. */
async function readPassword(): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    const lines = createInterface({ input: stdin, terminal: false });
    for await (const line of lines) {
      lines.close();
      return line;
    }
    return '';
  }
  process.stdout.write('Password (min 10 characters, hidden): ');
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve) => {
    let password = '';
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n' || char === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(password);
          return;
        }
        if (char === '\u0003') {
          stdin.setRawMode(false);
          process.exit(130);
        }
        password = char === '\u007f' ? password.slice(0, -1) : password + char;
      }
    };
    stdin.on('data', onData);
  });
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      phone: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string', default: 'SUPER_ADMIN' },
    },
  });
  const phone = normalizeKzPhone(values.phone ?? '');
  if (!phone) fail('--phone must be a Kazakhstan mobile number, e.g. "+7 701 123 45 67"');
  if (values.role !== 'ADMIN' && values.role !== 'SUPER_ADMIN')
    fail('--role must be ADMIN or SUPER_ADMIN');
  const connectionString = process.env.DATABASE_URL ?? fail('DATABASE_URL is required');

  const pool = createPool({
    connectionString,
    applicationName: 'lastsize-create-admin',
    maxConnections: 1,
  });
  const db = createDatabase(pool);
  try {
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.phone, phone));
    let passwordHash: string | null = null;
    if (existing.length === 0) {
      if (!values.name) fail('--name is required for a new account');
      const password = passwordSchema.safeParse(await readPassword());
      if (!password.success) fail(password.error.issues[0]?.message ?? 'Invalid password');
      passwordHash = await new PasswordService().hash(password.data);
    }
    // Account, role and audit entry are written together or not at all.
    await db.transaction(async (tx) => {
      let userId = existing[0]?.id;
      if (!userId) {
        const [created] = await tx
          .insert(users)
          .values({
            phone,
            name: values.name!,
            passwordHash: passwordHash!,
            phoneVerifiedAt: new Date(),
          })
          .returning({ id: users.id });
        userId = created!.id;
      }
      await tx.insert(userRoles).values({ userId, roleCode: values.role! }).onConflictDoNothing();
      await tx.insert(auditLogs).values({
        actorType: 'SYSTEM',
        action: 'admin.role.granted',
        entityType: 'user',
        entityId: userId,
        metadata: { role: values.role, via: 'cli' },
      });
    });
    process.stdout.write(
      `${values.role} granted to ${phone}. Sign in and set up the authenticator app.\n`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
