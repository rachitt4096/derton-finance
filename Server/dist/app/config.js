import { z } from 'zod';
const DEFAULT_ADMIN_PASSWORD = 'admin@2026';
const DEFAULT_ADMIN_USERNAME = 'ADMIN01';
const optionalTrimmedUrl = (fallback) => z.preprocess((value) => {
    if (typeof value !== 'string') {
        return value;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
}, z.string().url().optional().default(fallback));
const optionalUrlOrEmpty = () => z.preprocess((value) => {
    if (typeof value !== 'string') {
        return value;
    }
    const trimmed = value.trim();
    return trimmed || '';
}, z.union([z.literal(''), z.string().url()]).default(''));
const boolFromEnv = z.preprocess((value) => {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) {
            return true;
        }
        if (['0', 'false', 'no', 'off'].includes(normalized)) {
            return false;
        }
    }
    return value;
}, z.boolean());
const isLoopbackHostname = (value) => {
    const normalized = value.trim().toLowerCase();
    return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '0.0.0.0' || normalized === '::1';
};
const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    HOST: z.string().min(1).default('0.0.0.0'),
    APP_ORIGIN: z.string().min(1).default('http://localhost:5173'),
    COOKIE_NAME: z.string().min(1).default('derton_session'),
    COOKIE_SECURE: boolFromEnv.optional(),
    COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('lax'),
    COOKIE_DOMAIN: z.string().trim().optional().default(''),
    SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 7),
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(5 * 60_000),
    AUTH_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
    AUTH_RATE_LIMIT_BLOCK_MS: z.coerce.number().int().positive().default(15 * 60_000),
    POSTGRES_URL: z.string().min(1),
    BROKER_MODE: z.literal('upstox').default('upstox'),
    MARKET_SNAPSHOT_MS: z.coerce.number().int().positive().default(500),
    MARKET_FLUSH_MS: z.coerce.number().int().positive().default(1000),
    MARKET_HISTORY_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
    MARKET_CANDLE_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
    UPSTOX_API_KEY: z.string().optional().default(''),
    UPSTOX_API_SECRET: z.string().optional().default(''),
    UPSTOX_REDIRECT_URI: z.string().optional().default(''),
    UPSTOX_AUTH_URL: optionalTrimmedUrl('https://api.upstox.com/v2/login/authorization/dialog'),
    UPSTOX_TOKEN_URL: optionalTrimmedUrl('https://api.upstox.com/v2/login/authorization/token'),
    UPSTOX_ACCESS_TOKEN: z.string().optional().default(''),
    UPSTOX_INSTRUMENTS_URL: optionalTrimmedUrl('https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz'),
    SEED_ADMIN_USERNAME: z.string().min(3).max(32).default(DEFAULT_ADMIN_USERNAME),
    SEED_ADMIN_EMAIL: z.string().email().default('admin@derton.local'),
    SEED_ADMIN_PASSWORD: z.string().min(8).default(DEFAULT_ADMIN_PASSWORD),
    ALLOW_DEFAULT_ADMIN_PASSWORD: boolFromEnv.optional(),
    ALERTS_ENABLED: boolFromEnv.optional(),
    ALERT_COOLDOWN_MS: z.coerce.number().int().positive().default(5 * 60_000),
    ALERT_SLACK_WEBHOOK_URL: optionalUrlOrEmpty(),
    ALERT_EMAIL_WEBHOOK_URL: optionalUrlOrEmpty(),
    ALERT_EMAIL_WEBHOOK_TOKEN: z.string().optional().default(''),
    ALERT_EMAIL_FROM: z.string().optional().default(''),
    ALERT_EMAIL_TO: z.string().optional().default(''),
    ALERT_WHATSAPP_TWILIO_ACCOUNT_SID: z.string().optional().default(''),
    ALERT_WHATSAPP_TWILIO_AUTH_TOKEN: z.string().optional().default(''),
    ALERT_WHATSAPP_TWILIO_FROM: z.string().optional().default(''),
    ALERT_WHATSAPP_TWILIO_TO: z.string().optional().default(''),
});
export const parseConfig = (env) => {
    const parsed = envSchema.safeParse(env);
    if (!parsed.success) {
        const errorMessage = parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ');
        throw new Error(`Invalid server environment: ${errorMessage}`);
    }
    const isProduction = parsed.data.NODE_ENV === 'production';
    const appOrigins = [...new Set(parsed.data.APP_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean))];
    const cookieSecure = parsed.data.COOKIE_SECURE ?? isProduction;
    const allowDefaultAdminPassword = parsed.data.ALLOW_DEFAULT_ADMIN_PASSWORD ?? false;
    const alertsEnabled = parsed.data.ALERTS_ENABLED ?? false;
    const cookieDomain = parsed.data.COOKIE_DOMAIN.trim() || undefined;
    if (!appOrigins.length) {
        throw new Error('Invalid server environment: APP_ORIGIN must include at least one valid origin');
    }
    const invalidOrigins = appOrigins.filter((origin) => {
        try {
            new URL(origin);
            return false;
        }
        catch {
            return true;
        }
    });
    if (invalidOrigins.length) {
        throw new Error(`Invalid server environment: APP_ORIGIN contains invalid URL values: ${invalidOrigins.join(', ')}`);
    }
    if (isProduction) {
        const insecureOrigins = appOrigins.filter((origin) => {
            const parsedOrigin = new URL(origin);
            return parsedOrigin.protocol !== 'https:' || isLoopbackHostname(parsedOrigin.hostname);
        });
        if (insecureOrigins.length) {
            throw new Error(`Invalid server environment: APP_ORIGIN must use HTTPS and cannot point to localhost/loopback in production: ${insecureOrigins.join(', ')}`);
        }
    }
    if (parsed.data.COOKIE_SAME_SITE === 'none' && !cookieSecure) {
        throw new Error('Invalid server environment: COOKIE_SAME_SITE=none requires COOKIE_SECURE=true');
    }
    if (isProduction &&
        !allowDefaultAdminPassword &&
        parsed.data.SEED_ADMIN_PASSWORD.trim() === DEFAULT_ADMIN_PASSWORD) {
        throw new Error('Invalid server environment: SEED_ADMIN_PASSWORD is using the default value. Set a strong password for production.');
    }
    if (isProduction && parsed.data.BROKER_MODE === 'upstox') {
        const requiredBrokerFields = [
            ['UPSTOX_API_KEY', parsed.data.UPSTOX_API_KEY.trim()],
            ['UPSTOX_API_SECRET', parsed.data.UPSTOX_API_SECRET.trim()],
            ['UPSTOX_REDIRECT_URI', parsed.data.UPSTOX_REDIRECT_URI.trim()],
        ].filter(([, value]) => !value);
        if (requiredBrokerFields.length) {
            throw new Error(`Invalid server environment: missing required Upstox production settings: ${requiredBrokerFields.map(([key]) => key).join(', ')}`);
        }
    }
    const hasSlackChannel = Boolean(parsed.data.ALERT_SLACK_WEBHOOK_URL);
    const hasEmailWebhookChannel = Boolean(parsed.data.ALERT_EMAIL_WEBHOOK_URL);
    const twilioFields = [
        parsed.data.ALERT_WHATSAPP_TWILIO_ACCOUNT_SID.trim(),
        parsed.data.ALERT_WHATSAPP_TWILIO_AUTH_TOKEN.trim(),
        parsed.data.ALERT_WHATSAPP_TWILIO_FROM.trim(),
        parsed.data.ALERT_WHATSAPP_TWILIO_TO.trim(),
    ];
    const hasAnyTwilioField = twilioFields.some(Boolean);
    const hasTwilioChannel = twilioFields.every(Boolean);
    if (alertsEnabled && !hasSlackChannel && !hasEmailWebhookChannel && !hasTwilioChannel) {
        throw new Error('Invalid server environment: ALERTS_ENABLED=true requires at least one alert channel (Slack webhook, email webhook, or Twilio WhatsApp).');
    }
    if (hasAnyTwilioField && !hasTwilioChannel) {
        throw new Error('Invalid server environment: Twilio WhatsApp alert config is incomplete. Set ALERT_WHATSAPP_TWILIO_ACCOUNT_SID, ALERT_WHATSAPP_TWILIO_AUTH_TOKEN, ALERT_WHATSAPP_TWILIO_FROM, and ALERT_WHATSAPP_TWILIO_TO.');
    }
    return {
        ...parsed.data,
        APP_ORIGINS: appOrigins,
        COOKIE_SECURE: cookieSecure,
        COOKIE_DOMAIN: cookieDomain,
        ALLOW_DEFAULT_ADMIN_PASSWORD: allowDefaultAdminPassword,
        ALERTS_ENABLED: alertsEnabled,
    };
};
export const loadConfig = () => parseConfig(process.env);
