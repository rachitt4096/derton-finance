import MarketDepthTable from '../stock/MarketDepthTable'

function InfoPanel({ quote }) {
  return (
    <aside className="info-panel info-panel-market">
      <section className="nse-block nse-block-last">
        <div className="nse-block-title">
          <span className="sec-dot sec-dot-gold" />
          ORDER BOOK
        </div>
        <MarketDepthTable quote={quote} />
      </section>
    </aside>
  )
}

export default InfoPanel
