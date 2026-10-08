import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';
dotenv.config();
function getDbCredentials() {
    const urlStr = process.env.DATABASE_URL || 'postgresql://postgres:123456@localhost:5432/vanuit%20ambacht';
    try {
        const parsed = new URL(urlStr);
        return {
            host: parsed.hostname || 'localhost',
            port: Number(parsed.port) || 5432,
            user: decodeURIComponent(parsed.username || 'postgres'),
            password: decodeURIComponent(parsed.password || '123456'),
            database: decodeURIComponent(parsed.pathname.slice(1)) || 'vanuit ambacht',
            ssl: false,
        };
    }
    catch {
        return {
            host: 'localhost',
            port: 5432,
            user: 'postgres',
            password: '123456',
            database: 'vanuit ambacht',
            ssl: false,
        };
    }
}
export default defineConfig({
    schema: './src/db/schema.ts',
    out: './drizzle',
    dialect: 'postgresql',
    dbCredentials: getDbCredentials(),
    verbose: true,
    strict: true,
});
