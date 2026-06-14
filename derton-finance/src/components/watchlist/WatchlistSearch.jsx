function WatchlistSearch({
  open,
  query,
  results,
  isLoading,
  error,
  onClose,
  onQueryChange,
  onAdd,
}) {
  if (!open) {
    return null
  }

  return (
    <div className="wl-search">
      <div className="wl-search-head">
        <span className="wl-search-title">Add Company</span>
        <button type="button" className="wl-search-close" onClick={onClose} aria-label="Close watchlist search">
          ×
        </button>
      </div>

      <input
        type="text"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        className="wl-search-input"
        placeholder="Search symbol or company"
        autoFocus
      />

      <div className="wl-search-body">
        {query.trim().length < 2 ? <div className="wl-search-empty">Type at least 2 letters to search.</div> : null}
        {query.trim().length >= 2 && isLoading ? <div className="wl-search-empty">Searching...</div> : null}
        {query.trim().length >= 2 && !isLoading && error ? <div className="wl-search-empty">{error}</div> : null}
        {query.trim().length >= 2 && !isLoading && !error && !results.length ? (
          <div className="wl-search-empty">No supported companies found.</div>
        ) : null}

        {results.map((item) => (
          <button
            type="button"
            className="wl-search-item"
            key={item.symbol}
            onClick={() => onAdd(item.symbol)}
            disabled={item.isAdded}
          >
            <div className="wl-search-main">
              <span className="wl-search-sym">{item.symbol}</span>
              <span className="wl-search-co">{item.companyName}</span>
            </div>
            <span className={`wl-search-action ${item.isAdded ? 'is-added' : ''}`}>
              {item.isAdded ? 'Added' : 'Add'}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default WatchlistSearch
