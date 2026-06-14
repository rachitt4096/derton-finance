const downloadBlob = (blob, name) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

const escapeCsvValue = (value) => {
  const normalized = `${value ?? ''}`.replace(/"/g, '""')
  return /[",\n]/.test(normalized) ? `"${normalized}"` : normalized
}

export const exportCsv = (rows, fileName = 'derton-report.csv') => {
  if (!rows?.length) {
    return
  }

  const headers = Object.keys(rows[0])
  const csvBody = rows.map((row) => headers.map((key) => escapeCsvValue(row[key])).join(',')).join('\n')
  const csvText = `${headers.map(escapeCsvValue).join(',')}\n${csvBody}`
  downloadBlob(new Blob([csvText], { type: 'text/csv;charset=utf-8;' }), fileName)
}

export const exportExcel = async (rows, sheetName = 'Derton', fileName = 'derton-report.xlsx') => {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName)
  XLSX.writeFile(workbook, fileName)
}

export const exportPdf = async (title, rows, fileName = 'derton-report.pdf') => {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(title, 40, 48)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)

  const headers = rows?.length ? Object.keys(rows[0]) : []
  let y = 72

  if (headers.length) {
    doc.text(headers.join(' | '), 40, y)
    y += 14

    rows.slice(0, 40).forEach((row) => {
      const line = headers.map((key) => `${row[key] ?? ''}`).join(' | ')
      doc.text(line.slice(0, 150), 40, y)
      y += 12
    })
  } else {
    doc.text('No rows to export.', 40, y)
  }

  doc.save(fileName)
}

export const exportChartImage = (canvas, fileName = 'derton-chart.png') => {
  if (!canvas) {
    return
  }
  const anchor = document.createElement('a')
  anchor.href = canvas.toDataURL('image/png')
  anchor.download = fileName
  anchor.click()
}

export const printCurrentView = () => window.print()
