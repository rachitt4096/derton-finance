import { Suspense, lazy } from 'react'
import LoadingPanel from '../ui/LoadingPanel'

const MainChart = lazy(() => import('./MainChart'))

function LazyMainChart(props) {
  return (
    <Suspense
      fallback={
        <div className="chart-loading-shell">
          <LoadingPanel
            compact
            title="Loading chart"
            subtitle="Preparing interactive price view..."
          />
        </div>
      }
    >
      <MainChart {...props} />
    </Suspense>
  )
}

export default LazyMainChart
