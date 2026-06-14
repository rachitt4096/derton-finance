import { useState } from 'react'
import useMarketStore from '../store/useMarketStore'
import { exportChartImage, exportCsv, exportExcel, exportPdf, printCurrentView } from '../utils/exportHelpers'

const useExport = () => {
  const closeExportModal = useMarketStore((state) => state.closeExportModal)
  const addToast = useMarketStore((state) => state.addToast)
  const [isExporting, setIsExporting] = useState(false)

  const exportData = async ({ type, rows, title, filePrefix = 'derton', chartCanvas }) => {
    if (isExporting) {
      return
    }

    if (!rows?.length && type !== 'print' && type !== 'img') {
      addToast('No rows available for export.', 'w')
      return
    }

    setIsExporting(true)

    try {
      switch (type) {
        case 'csv':
          exportCsv(rows, `${filePrefix}.csv`)
          addToast('CSV export complete.', 'h')
          break
        case 'excel':
          await exportExcel(rows, 'Derton', `${filePrefix}.xlsx`)
          addToast('Excel export complete.', 'h')
          break
        case 'pdf':
          await exportPdf(title, rows, `${filePrefix}.pdf`)
          addToast('PDF report generated.', 'h')
          break
        case 'img':
          exportChartImage(chartCanvas, `${filePrefix}-chart.png`)
          addToast('Chart image exported.', 'h')
          break
        case 'print':
          printCurrentView()
          addToast('Print dialog opened.', 'h')
          break
        default:
          addToast('Unsupported export type.', 'w')
      }

      closeExportModal()
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Export failed. Please try again.', 'l', 4500)
    } finally {
      setIsExporting(false)
    }
  }

  return { exportData, isExporting }
}

export default useExport
