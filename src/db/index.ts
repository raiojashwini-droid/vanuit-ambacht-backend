import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import dotenv from 'dotenv';

dotenv.config();

function getDbOptions() {
  const urlStr = process.env.DATABASE_URL || 'postgresql://postgres:123456@localhost:5432/vanuit%20ambacht';
  try {
    const parsed = new URL(urlStr);
    return {
      host: parsed.hostname || 'localhost',
      port: Number(parsed.port) || 5432,
      username: decodeURIComponent(parsed.username || 'postgres'),
      password: decodeURIComponent(parsed.password || '123456'),
      database: decodeURIComponent(parsed.pathname.slice(1)) || 'vanuit ambacht',
    };
  } catch {
    return {
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: '123456',
      database: 'vanuit ambacht',
    };
  }
}

export const sqlClient = postgres({
  ...getDbOptions(),
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(sqlClient, { schema });
