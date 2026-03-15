// Simple receipt HTML generator

interface ReceiptItem {
  name: string
  quantity: number
  unitPrice: string
  total: string
  weightGrams?: string
}

interface ReceiptData {
  orderNumber: string
  companyName: string
  companyAddress?: string
  companyPhone?: string
  companyLicense?: string
  customerName: string
  customerId?: string
  items: ReceiptItem[]
  subtotal: string
  taxRate: string
  taxAmount: string
  total: string
  paymentMethod: string
  budtenderName?: string
  createdAt: string
}

export function generateReceiptHtml(data: ReceiptData): string {
  const itemRows = data.items
    .map(
      (item) => `
    <tr>
      <td>${item.name}${item.weightGrams ? ` (${item.weightGrams}g)` : ''}</td>
      <td style="text-align:center">${item.quantity}</td>
      <td style="text-align:right">$${item.unitPrice}</td>
      <td style="text-align:right">$${item.total}</td>
    </tr>`
    )
    .join('')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: monospace; max-width: 400px; margin: 0 auto; padding: 20px; font-size: 12px; }
    .header { text-align: center; margin-bottom: 16px; }
    .header h2 { margin: 0 0 4px; }
    .header p { margin: 2px 0; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th, td { padding: 4px 8px; text-align: left; }
    th { border-bottom: 1px dashed #000; }
    .totals { border-top: 1px dashed #000; margin-top: 8px; padding-top: 8px; }
    .totals .row { display: flex; justify-content: space-between; padding: 2px 0; }
    .totals .grand-total { font-weight: bold; font-size: 14px; border-top: 1px solid #000; margin-top: 4px; padding-top: 4px; }
    .footer { text-align: center; margin-top: 16px; border-top: 1px dashed #000; padding-top: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <h2>${data.companyName}</h2>
    ${data.companyAddress ? `<p>${data.companyAddress}</p>` : ''}
    ${data.companyPhone ? `<p>${data.companyPhone}</p>` : ''}
    ${data.companyLicense ? `<p>License: ${data.companyLicense}</p>` : ''}
  </div>

  <div>
    <p>Order: #${data.orderNumber}</p>
    <p>Date: ${data.createdAt}</p>
    <p>Customer: ${data.customerName}</p>
    ${data.customerId ? `<p>Patient/Customer ID: ${data.customerId}</p>` : ''}
    ${data.budtenderName ? `<p>Served by: ${data.budtenderName}</p>` : ''}
  </div>

  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th style="text-align:center">Qty</th>
        <th style="text-align:right">Price</th>
        <th style="text-align:right">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <div class="totals">
    <div class="row"><span>Subtotal</span><span>$${data.subtotal}</span></div>
    <div class="row"><span>Tax (${data.taxRate}%)</span><span>$${data.taxAmount}</span></div>
    <div class="row grand-total"><span>Total</span><span>$${data.total}</span></div>
    <div class="row"><span>Payment</span><span>${data.paymentMethod}</span></div>
  </div>

  <div class="footer">
    <p>Thank you for your purchase!</p>
    <p>Keep this receipt for your records.</p>
  </div>
</body>
</html>`
}
