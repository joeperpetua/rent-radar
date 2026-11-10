import { randomBytes } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { getMigrations } from 'better-auth/db/migration';
import { db, getMeta, setMeta } from './db.js';
import { adoptLegacyPrefs } from './prefs.js';

function authSecret() {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  let secret = getMeta('auth_secret');
  if (!secret) {
    secret = randomBytes(32).toString('base64url');
    setMeta('auth_secret', secret);
  }
  return secret;
}

const signUpClosed = process.env.ALLOW_SIGNUP === 'false';
const google = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, prompt: 'select_account', disableSignUp: signUpClosed }
  : null;

export const loginOptions = { google: Boolean(google), signUp: !signUpClosed };

let migrated = false;

function log(level, message, ...args) {
  if (!migrated && /schema mismatch/i.test(message)) return;
  (console[level] ?? console.log)(`[auth] ${message}`, ...args);
}

export const auth = betterAuth({
  appName: 'RentRadar Austria',
  logger: { log },
  database: db,
  secret: authSecret(),
  baseURL: process.env.BETTER_AUTH_URL || `http://localhost:${process.env.PORT ?? 3000}`,
  trustedOrigins: process.env.TRUSTED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    disableSignUp: signUpClosed,
  },
  socialProviders: google ? { google } : {},
  account: { encryptOAuthTokens: true },
  advanced: process.env.IP_HEADER ? { ipAddress: { ipAddressHeaders: [process.env.IP_HEADER] } } : {},
  databaseHooks: {
    user: { create: { after: async (user) => adoptLegacyPrefs(user.id) } },
  },
});

export const authHandler = toNodeHandler(auth);

export async function migrateAuth() {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  migrated = true;
}

export async function currentUser(req) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  return session?.user ?? null;
}
