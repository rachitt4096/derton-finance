"""NIFTY 50 reference fundamentals used to compute LIVE market cap / free-float
market cap / P/E (value = shares x current price).

- shares_cr        : shares outstanding in crore (1 cr = 10,000,000 shares)
- ff               : NSE free-float factor / investible weight factor (0-1)
- eps              : trailing-twelve-month EPS (₹) for live P/E = price / eps
- sector           : GICS-style sector

These are reference snapshots (share counts change rarely — buybacks/issuance;
free-float factors change on NSE's quarterly rebalance). Market cap stays current
because it is recomputed from the live price. Figures are best-effort and can be
corrected per symbol without code changes elsewhere.
"""

NIFTY50_FUNDAMENTALS: dict[str, dict] = {
    "RELIANCE": {"sector": "Energy", "shares_cr": 1353.0, "ff": 0.50, "eps": 53.0},
    "TCS": {"sector": "IT", "shares_cr": 361.7, "ff": 0.28, "eps": 134.0},
    "HDFCBANK": {"sector": "Financials", "shares_cr": 765.0, "ff": 1.00, "eps": 88.0},
    "ICICIBANK": {"sector": "Financials", "shares_cr": 712.0, "ff": 1.00, "eps": 64.0},
    "INFY": {"sector": "IT", "shares_cr": 415.0, "ff": 0.87, "eps": 63.0},
    "SBIN": {"sector": "Financials", "shares_cr": 892.0, "ff": 0.43, "eps": 75.0},
    "LT": {"sector": "Construction", "shares_cr": 137.5, "ff": 1.00, "eps": 110.0},
    "ITC": {"sector": "FMCG", "shares_cr": 1251.0, "ff": 1.00, "eps": 16.5},
    "BHARTIARTL": {"sector": "Telecom", "shares_cr": 595.0, "ff": 0.47, "eps": 38.0},
    "AXISBANK": {"sector": "Financials", "shares_cr": 309.0, "ff": 1.00, "eps": 88.0},
    "KOTAKBANK": {"sector": "Financials", "shares_cr": 198.0, "ff": 0.74, "eps": 92.0},
    "HINDUNILVR": {"sector": "FMCG", "shares_cr": 235.0, "ff": 0.62, "eps": 43.0},
    "BAJFINANCE": {"sector": "Financials", "shares_cr": 62.0, "ff": 0.46, "eps": 270.0},
    "MARUTI": {"sector": "Auto", "shares_cr": 31.4, "ff": 0.42, "eps": 460.0},
    "SUNPHARMA": {"sector": "Pharma", "shares_cr": 240.0, "ff": 0.45, "eps": 42.0},
    "NTPC": {"sector": "Power", "shares_cr": 969.0, "ff": 0.49, "eps": 22.0},
    "TATAMOTORS": {"sector": "Auto", "shares_cr": 368.0, "ff": 0.54, "eps": 60.0},
    "HCLTECH": {"sector": "IT", "shares_cr": 271.0, "ff": 0.39, "eps": 60.0},
    "POWERGRID": {"sector": "Power", "shares_cr": 930.0, "ff": 0.43, "eps": 16.0},
    "M&M": {"sector": "Auto", "shares_cr": 124.0, "ff": 0.81, "eps": 90.0},
    "TITAN": {"sector": "Consumer", "shares_cr": 88.8, "ff": 0.47, "eps": 38.0},
    "ULTRACEMCO": {"sector": "Cement", "shares_cr": 28.9, "ff": 0.40, "eps": 230.0},
    "ASIANPAINT": {"sector": "Consumer", "shares_cr": 95.9, "ff": 0.47, "eps": 50.0},
    "ONGC": {"sector": "Energy", "shares_cr": 1258.0, "ff": 0.40, "eps": 36.0},
    "BAJAJFINSV": {"sector": "Financials", "shares_cr": 159.0, "ff": 0.40, "eps": 9.0},
    "NESTLEIND": {"sector": "FMCG", "shares_cr": 96.4, "ff": 0.37, "eps": 11.0},
    "WIPRO": {"sector": "IT", "shares_cr": 1046.0, "ff": 0.33, "eps": 12.0},
    "ADANIENT": {"sector": "Conglomerate", "shares_cr": 115.0, "ff": 0.31, "eps": 65.0},
    "ADANIPORTS": {"sector": "Infrastructure", "shares_cr": 216.0, "ff": 0.34, "eps": 45.0},
    "COALINDIA": {"sector": "Mining", "shares_cr": 616.0, "ff": 0.37, "eps": 50.0},
    "BAJAJ-AUTO": {"sector": "Auto", "shares_cr": 27.9, "ff": 0.45, "eps": 290.0},
    "JSWSTEEL": {"sector": "Metals", "shares_cr": 244.0, "ff": 0.55, "eps": 30.0},
    "TATASTEEL": {"sector": "Metals", "shares_cr": 1249.0, "ff": 0.66, "eps": 9.0},
    "GRASIM": {"sector": "Cement", "shares_cr": 68.0, "ff": 0.57, "eps": 95.0},
    "HINDALCO": {"sector": "Metals", "shares_cr": 224.0, "ff": 0.65, "eps": 55.0},
    "TECHM": {"sector": "IT", "shares_cr": 97.8, "ff": 0.65, "eps": 45.0},
    "BEL": {"sector": "Defence", "shares_cr": 731.0, "ff": 0.49, "eps": 7.0},
    "DRREDDY": {"sector": "Pharma", "shares_cr": 83.4, "ff": 0.73, "eps": 70.0},
    "CIPLA": {"sector": "Pharma", "shares_cr": 80.8, "ff": 0.67, "eps": 60.0},
    "EICHERMOT": {"sector": "Auto", "shares_cr": 27.4, "ff": 0.51, "eps": 175.0},
    "BRITANNIA": {"sector": "FMCG", "shares_cr": 24.1, "ff": 0.49, "eps": 88.0},
    "APOLLOHOSP": {"sector": "Healthcare", "shares_cr": 14.4, "ff": 0.70, "eps": 95.0},
    "TATACONSUM": {"sector": "FMCG", "shares_cr": 98.7, "ff": 0.66, "eps": 16.0},
    "HEROMOTOCO": {"sector": "Auto", "shares_cr": 20.0, "ff": 0.66, "eps": 200.0},
    "INDUSINDBK": {"sector": "Financials", "shares_cr": 78.0, "ff": 0.83, "eps": 80.0},
    "SBILIFE": {"sector": "Insurance", "shares_cr": 100.2, "ff": 0.45, "eps": 20.0},
    "HDFCLIFE": {"sector": "Insurance", "shares_cr": 215.0, "ff": 0.50, "eps": 8.0},
    "SHRIRAMFIN": {"sector": "Financials", "shares_cr": 188.0, "ff": 0.74, "eps": 45.0},
    "TRENT": {"sector": "Retail", "shares_cr": 35.5, "ff": 0.63, "eps": 38.0},
    "BPCL": {"sector": "Energy", "shares_cr": 433.0, "ff": 0.47, "eps": 32.0},
}
