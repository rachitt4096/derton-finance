import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_FRONTEND_FLAGS, DEFAULT_FRONTEND_PORTFOLIO, DEFAULT_FRONTEND_STOCKS, } from './defaultSeedData.js';
const moduleCache = new Map();
const fallbackWarnedPaths = new Set();
const loadModule = async (relativePathFromServer) => {
    if (!moduleCache.has(relativePathFromServer)) {
        const absolutePath = path.resolve(process.cwd(), relativePathFromServer);
        moduleCache.set(relativePathFromServer, import(pathToFileURL(absolutePath).href));
    }
    return (await moduleCache.get(relativePathFromServer));
};
export const loadFrontendStocks = () => loadModule('../derton-finance/src/data/stocks.js')
    .then((mod) => mod.STOCKS)
    .catch((error) => {
    if (!fallbackWarnedPaths.has('stocks')) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[frontendData] using fallback stock seed data (${message})`);
        fallbackWarnedPaths.add('stocks');
    }
    return DEFAULT_FRONTEND_STOCKS;
});
export const loadFrontendFlags = () => loadModule('../derton-finance/src/data/flags.js')
    .then((mod) => mod.FLAGS_DATA)
    .catch((error) => {
    if (!fallbackWarnedPaths.has('flags')) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[frontendData] using fallback risk-flag seed data (${message})`);
        fallbackWarnedPaths.add('flags');
    }
    return DEFAULT_FRONTEND_FLAGS;
});
export const loadFrontendPortfolio = () => loadModule('../derton-finance/src/data/portfolio.js')
    .then((mod) => ({
    holdings: mod.HOLDING_QTY,
    book: mod.BOOK_DATA,
}))
    .catch((error) => {
    if (!fallbackWarnedPaths.has('portfolio')) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[frontendData] using fallback portfolio seed data (${message})`);
        fallbackWarnedPaths.add('portfolio');
    }
    return {
        holdings: DEFAULT_FRONTEND_PORTFOLIO.HOLDING_QTY,
        book: DEFAULT_FRONTEND_PORTFOLIO.BOOK_DATA,
    };
});
