const DAY_MS = 24 * 60 * 60 * 1000;
export const formatDate = (value) => value.toISOString().slice(0, 10);
export const addDays = (value, days) => {
    const date = new Date(`${value}T00:00:00Z`);
    return formatDate(new Date(date.getTime() + days * DAY_MS));
};
export const compareDate = (left, right) => new Date(`${left}T00:00:00Z`).getTime() - new Date(`${right}T00:00:00Z`).getTime();
export const getChunkDays = (interval) => {
    switch (interval) {
        case '1m':
        case '5m':
        case '15m':
            return 30;
        case '1h':
            return 90;
        case '1d':
        default:
            return 3650;
    }
};
export const buildHistoryChunks = (fromDate, toDate, interval) => {
    const chunks = [];
    let cursor = fromDate;
    const chunkDays = getChunkDays(interval);
    while (compareDate(cursor, toDate) <= 0) {
        const chunkTo = addDays(cursor, chunkDays - 1);
        const boundedTo = compareDate(chunkTo, toDate) > 0 ? toDate : chunkTo;
        chunks.push({ fromDate: cursor, toDate: boundedTo });
        cursor = addDays(boundedTo, 1);
    }
    return chunks;
};
