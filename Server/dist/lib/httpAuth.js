export const requireSessionUser = async (request, reply, authService, cookieName) => {
    const token = request.cookies[cookieName];
    if (!token) {
        await reply.code(401).send({ error: 'Unauthorized' });
        return null;
    }
    const user = await authService.getSessionUser(token);
    if (!user) {
        await reply.code(401).send({ error: 'Unauthorized' });
        return null;
    }
    return user;
};
export const requireAdminUser = async (request, reply, authService, cookieName) => {
    const user = await requireSessionUser(request, reply, authService, cookieName);
    if (!user) {
        return null;
    }
    if (user.role !== 'admin') {
        await reply.code(403).send({ error: 'Forbidden' });
        return null;
    }
    return user;
};
