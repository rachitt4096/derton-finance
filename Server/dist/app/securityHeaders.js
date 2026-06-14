const API_CONTENT_SECURITY_POLICY = [
    "default-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
].join('; ');
export const registerSecurityHeaders = (app) => {
    app.addHook('onSend', async (request, reply, payload) => {
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('X-Frame-Options', 'DENY');
        reply.header('Referrer-Policy', 'no-referrer');
        reply.header('Permissions-Policy', 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()');
        reply.header('Content-Security-Policy', API_CONTENT_SECURITY_POLICY);
        if (/^\/api\/(auth|broker)\b/.test(request.url)) {
            reply.header('Cache-Control', 'no-store');
        }
        return payload;
    });
};
