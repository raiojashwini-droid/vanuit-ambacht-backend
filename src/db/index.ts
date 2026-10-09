import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import dotenv from 'dotenv';

dotenv.config();

function getDbOptions() {
  const urlStr = process.env.DATABASE_URL || 'postgresql://postgres:123456@localhost:5432/vanuit%20ambacht';
  try {
    const parsed = new URL(urlStr);
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    return {
      host: parsed.hostname || 'localhost',
      port: Number(parsed.port) || 5432,
      username: decodeURIComponent(parsed.username || 'postgres'),
      password: decodeURIComponent(parsed.password || '123456'),
      database: decodeURIComponent(parsed.pathname.slice(1)) || 'vanuit ambacht',
      ssl: isLocal ? false : { rejectUnauthorized: false },
    };
  } catch {
    return {
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: '123456',
      database: 'vanuit ambacht',
      ssl: false,
    };
  }
}

export const sqlClient = postgres({
  ...getDbOptions(),
  max: 10,
  idle_timeout: 0, // Keep pool connections alive permanently
  connect_timeout: 30,
});

// Pre-warm connections & keep them alive to eliminate remote latency
(async () => {
  try {
    await Promise.all([
      sqlClient`SELECT 1`,
      sqlClient`SELECT 1`,
      sqlClient`SELECT 1`,
    ]);
  } catch {
    // ignore
  }

  // Heartbeat ping every 20s to ensure remote Railway proxy keeps TCP socket hot
  setInterval(() => {
    sqlClient`SELECT 1`.catch(() => {});
  }, 20000);
})();

export const db = drizzle(sqlClient, { schema });

