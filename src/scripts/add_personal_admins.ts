import { db, sqlClient } from '../db/index.js';
import { users } from '../db/schema.js';
import bcrypt from 'bcryptjs';

async function ensureAdminAccounts() {
  const hash = await bcrypt.hash('admin123', 10);

  // Tim
  await db
    .insert(users)
    .values({
      email: 'tim@vanuitambacht.nl',
      passwordHash: hash,
      role: 'admin',
      fullName: 'Tim',
      phone: '+31 6 11112222',
      isActive: true,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        passwordHash: hash,
        fullName: 'Tim',
        isActive: true,
      },
    });

  // Bram
  await db
    .insert(users)
    .values({
      email: 'bram@vanuitambacht.nl',
      passwordHash: hash,
      role: 'admin',
      fullName: 'Bram',
      phone: '+31 6 11113333',
      isActive: true,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        passwordHash: hash,
        fullName: 'Bram',
        isActive: true,
      },
    });

  console.log('✅ Tim & Bram personal admin accounts verified!');
}

ensureAdminAccounts()
  .catch(console.error)
  .finally(async () => {
    await sqlClient.end();
  });
