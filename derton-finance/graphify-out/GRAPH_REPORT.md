# Graph Report - derton-finance  (2026-05-04)

## Corpus Check
- 60 files · ~23,634 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 234 nodes · 397 edges · 12 communities detected
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 44 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]

## God Nodes (most connected - your core abstractions)
1. `formatCurrency()` - 32 edges
2. `resolveDisplayPrice()` - 16 edges
3. `getApiUrl()` - 14 edges
4. `requestJson()` - 14 edges
5. `formatPercent()` - 11 edges
6. `StockDetail()` - 10 edges
7. `getNseMarketWindowState()` - 9 edges
8. `Dashboard()` - 8 edges
9. `GraphStatsPanel()` - 8 edges
10. `formatChange()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `Screener()` --calls--> `useCompanyInsights()`  [INFERRED]
  src/pages/Screener.jsx → src/hooks/useCompanyInsights.js
- `formatDepthPrice()` --calls--> `formatCurrency()`  [INFERRED]
  src/components/stock/MarketDepthTable.jsx → src/utils/formatters.js
- `formatCurrencyOrDash()` --calls--> `formatCurrency()`  [INFERRED]
  src/pages/StockDetail.jsx → src/utils/formatters.js
- `StockDetail()` --calls--> `useCompanyInsights()`  [INFERRED]
  src/pages/StockDetail.jsx → src/hooks/useCompanyInsights.js
- `StockDetail()` --calls--> `resolveDisplayPrice()`  [INFERRED]
  src/pages/StockDetail.jsx → src/utils/marketPrice.js

## Communities

### Community 0 - "Community 0"
Cohesion: 0.13
Nodes (17): Topbar(), Dashboard(), getWatchlistEmptyCopy(), uniqueSymbols(), getMarketSessionLabel(), LoginPage(), getApiUrl(), fetchCompanyInsights() (+9 more)

### Community 1 - "Community 1"
Cohesion: 0.13
Nodes (13): Screener(), getIstClock(), isRegularMarketLive(), StockHeader(), Badge(), cn(), formatChange(), formatCompactCrore() (+5 more)

### Community 2 - "Community 2"
Cohesion: 0.17
Nodes (17): Portfolio(), formatCrore(), formatCurrencyOrDash(), formatDateTag(), formatFixed(), formatLakhs(), formatPercent(), GraphStatsPanel() (+9 more)

### Community 3 - "Community 3"
Cohesion: 0.24
Nodes (16): AdminTerminal(), formatDateTime(), formatDateShort(), createAdminUser(), createPortfolioTransaction(), fetchAdminOverview(), fetchAdminUsers(), fetchFlags() (+8 more)

### Community 4 - "Community 4"
Cohesion: 0.21
Nodes (14): formatCount(), formatCurrencyOrDash(), formatDateLabel(), formatPercentOrDash(), StockDetail(), CompanySnapshotCard(), FinancialSnapshotCard(), formatCount() (+6 more)

### Community 5 - "Community 5"
Cohesion: 0.16
Nodes (11): buildSessionBounds(), cssColor(), getChartColors(), MainChart(), calculateBollingerBands(), calculateMACD(), calculateRSI(), calculateSMA() (+3 more)

### Community 6 - "Community 6"
Cohesion: 0.17
Nodes (7): buildExportRows(), hasFreshFeed(), resolveDisplayPrice(), toFiniteNumber(), getAudioContext(), playAlertTone(), primeAlertAudio()

### Community 7 - "Community 7"
Cohesion: 0.17
Nodes (10): TerminalApp(), useExport(), useLivePrice(), getWsUrl(), downloadBlob(), exportChartImage(), exportCsv(), exportExcel() (+2 more)

### Community 8 - "Community 8"
Cohesion: 0.27
Nodes (11): buildHistoryParams(), getSessionKey(), getTimeframeBucketMs(), getTodaySessionKey(), isLiveSessionTimeframe(), normalizeBackendCandles(), normalizePreferredHistoryCandles(), requestHistoryCandles() (+3 more)

### Community 9 - "Community 9"
Cohesion: 0.22
Nodes (4): useCompanyInsights(), OpeningWindow(), Tooltip(), formatShortTime()

### Community 10 - "Community 10"
Cohesion: 0.31
Nodes (5): isObject(), normalizePricePayload(), normalizeSymbol(), pushEntry(), toNumber()

### Community 11 - "Community 11"
Cohesion: 0.48
Nodes (6): formatCount(), formatDepthPrice(), formatDepthQuantity(), MarketDepthTable(), readQuantity(), sumDepthQuantity()

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `formatCurrency()` connect `Community 2` to `Community 0`, `Community 1`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 9`, `Community 11`?**
  _High betweenness centrality (0.355) - this node is a cross-community bridge._
- **Why does `resolveDisplayPrice()` connect `Community 6` to `Community 0`, `Community 1`, `Community 3`, `Community 4`, `Community 9`?**
  _High betweenness centrality (0.123) - this node is a cross-community bridge._
- **Why does `getApiUrl()` connect `Community 0` to `Community 8`, `Community 3`, `Community 7`?**
  _High betweenness centrality (0.105) - this node is a cross-community bridge._
- **Are the 13 inferred relationships involving `formatCurrency()` (e.g. with `formatCurrencyOrDash()` and `StockDetail()`) actually correct?**
  _`formatCurrency()` has 13 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `resolveDisplayPrice()` (e.g. with `StockDetail()` and `Dashboard()`) actually correct?**
  _`resolveDisplayPrice()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `getApiUrl()` (e.g. with `requestHistoryCandles()` and `requestJson()`) actually correct?**
  _`getApiUrl()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._