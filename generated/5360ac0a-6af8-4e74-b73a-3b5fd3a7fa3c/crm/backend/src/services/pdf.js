import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// Ensure directory exists
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Format currency
function formatCurrency(amount) {
  return '$' + Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Format date
function formatDate(date) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Generate Quote PDF
export async function generateQuotePDF(quote, company) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(24).font('Helvetica-Bold').text(company.name, { align: 'left' });
    doc.fontSize(10).font('Helvetica').text(company.address || '');
    doc.text(`${company.city || ''}, ${company.state || ''} ${company.zip || ''}`);
    doc.text(company.phone || '');
    doc.text(company.email || '');
    
    doc.moveDown(2);
    
    // Quote title
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#f97316').text('QUOTE', { align: 'right' });
    doc.fillColor('#000000');
    
    // Quote details
    doc.fontSize(10).font('Helvetica');
    doc.text(`Quote #: ${quote.number}`, { align: 'right' });
    doc.text(`Date: ${formatDate(quote.createdAt)}`, { align: 'right' });
    if (quote.expiryDate) {
      doc.text(`Valid Until: ${formatDate(quote.expiryDate)}`, { align: 'right' });
    }
    
    doc.moveDown(2);
    
    // Bill To
    doc.font('Helvetica-Bold').text('PREPARED FOR:');
    doc.font('Helvetica');
    if (quote.contact) {
      doc.text(quote.contact.name);
      if (quote.contact.company) doc.text(quote.contact.company);
      if (quote.contact.address) doc.text(quote.contact.address);
      if (quote.contact.city) doc.text(`${quote.contact.city}, ${quote.contact.state || ''} ${quote.contact.zip || ''}`);
      if (quote.contact.email) doc.text(quote.contact.email);
      if (quote.contact.phone) doc.text(quote.contact.phone);
    }
    
    doc.moveDown(2);
    
    // Quote name/description
    doc.font('Helvetica-Bold').fontSize(14).text(quote.name);
    doc.font('Helvetica').fontSize(10);
    doc.moveDown();
    
    // Line items table
    const tableTop = doc.y;
    const col1 = 50;
    const col2 = 350;
    const col3 = 410;
    const col4 = 470;
    const col5 = 530;
    
    // Header row
    doc.font('Helvetica-Bold').fontSize(10);
    doc.fillColor('#f3f4f6').rect(col1 - 5, tableTop - 5, 510, 20).fill();
    doc.fillColor('#000000');
    doc.text('Description', col1, tableTop);
    doc.text('Qty', col2, tableTop);
    doc.text('Unit Price', col3, tableTop);
    doc.text('Total', col5, tableTop, { align: 'right', width: 50 });
    
    doc.font('Helvetica');
    let y = tableTop + 25;
    
    // Line items
    for (const item of (quote.lineItems || [])) {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }
      
      doc.text(item.description, col1, y, { width: 290 });
      doc.text(String(Number(item.quantity)), col2, y);
      doc.text(formatCurrency(item.unitPrice), col3, y);
      doc.text(formatCurrency(item.total), col5, y, { align: 'right', width: 50 });
      
      y += 20;
    }
    
    // Totals
    y += 20;
    doc.moveTo(col3, y).lineTo(580, y).stroke();
    y += 10;
    
    doc.text('Subtotal:', col3, y);
    doc.text(formatCurrency(quote.subtotal), col5, y, { align: 'right', width: 50 });
    y += 15;
    
    if (Number(quote.taxRate) > 0) {
      doc.text(`Tax (${quote.taxRate}%):`, col3, y);
      doc.text(formatCurrency(quote.taxAmount), col5, y, { align: 'right', width: 50 });
      y += 15;
    }
    
    if (Number(quote.discount) > 0) {
      doc.text('Discount:', col3, y);
      doc.text(`-${formatCurrency(quote.discount)}`, col5, y, { align: 'right', width: 50 });
      y += 15;
    }
    
    doc.font('Helvetica-Bold').fontSize(12);
    doc.text('TOTAL:', col3, y);
    doc.fillColor('#f97316').text(formatCurrency(quote.total), col5, y, { align: 'right', width: 50 });
    doc.fillColor('#000000');
    
    // Notes
    if (quote.notes) {
      doc.moveDown(3);
      doc.font('Helvetica-Bold').fontSize(10).text('Notes:');
      doc.font('Helvetica').text(quote.notes);
    }
    
    // Terms
    if (quote.terms) {
      doc.moveDown(2);
      doc.font('Helvetica-Bold').fontSize(10).text('Terms & Conditions:');
      doc.font('Helvetica').fontSize(8).text(quote.terms);
    }
    
    // Footer
    doc.fontSize(8).text(
      'Thank you for your business!',
      50, 750,
      { align: 'center', width: 500 }
    );

    doc.end();
  });
}

// Generate Invoice PDF
export async function generateInvoicePDF(invoice, company) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(24).font('Helvetica-Bold').text(company.name, { align: 'left' });
    doc.fontSize(10).font('Helvetica').text(company.address || '');
    doc.text(`${company.city || ''}, ${company.state || ''} ${company.zip || ''}`);
    doc.text(company.phone || '');
    doc.text(company.email || '');
    
    doc.moveDown(2);
    
    // Invoice title
    const isPaid = Number(invoice.balance) <= 0;
    doc.fontSize(20).font('Helvetica-Bold');
    doc.fillColor(isPaid ? '#10b981' : '#f97316').text('INVOICE', { align: 'right' });
    if (isPaid) {
      doc.fontSize(14).text('PAID', { align: 'right' });
    }
    doc.fillColor('#000000');
    
    // Invoice details
    doc.fontSize(10).font('Helvetica');
    doc.text(`Invoice #: ${invoice.number}`, { align: 'right' });
    doc.text(`Date: ${formatDate(invoice.issueDate || invoice.createdAt)}`, { align: 'right' });
    if (invoice.dueDate) {
      doc.text(`Due Date: ${formatDate(invoice.dueDate)}`, { align: 'right' });
    }
    
    doc.moveDown(2);
    
    // Bill To
    doc.font('Helvetica-Bold').text('BILL TO:');
    doc.font('Helvetica');
    if (invoice.contact) {
      doc.text(invoice.contact.name);
      if (invoice.contact.company) doc.text(invoice.contact.company);
      if (invoice.contact.address) doc.text(invoice.contact.address);
      if (invoice.contact.city) doc.text(`${invoice.contact.city}, ${invoice.contact.state || ''} ${invoice.contact.zip || ''}`);
      if (invoice.contact.email) doc.text(invoice.contact.email);
    }
    
    doc.moveDown(2);
    
    // Line items table
    const tableTop = doc.y;
    const col1 = 50;
    const col2 = 350;
    const col3 = 410;
    const col4 = 470;
    const col5 = 530;
    
    // Header row
    doc.font('Helvetica-Bold').fontSize(10);
    doc.fillColor('#f3f4f6').rect(col1 - 5, tableTop - 5, 510, 20).fill();
    doc.fillColor('#000000');
    doc.text('Description', col1, tableTop);
    doc.text('Qty', col2, tableTop);
    doc.text('Unit Price', col3, tableTop);
    doc.text('Total', col5, tableTop, { align: 'right', width: 50 });
    
    doc.font('Helvetica');
    let y = tableTop + 25;
    
    // Line items
    for (const item of (invoice.lineItems || [])) {
      if (y > 650) {
        doc.addPage();
        y = 50;
      }
      
      doc.text(item.description, col1, y, { width: 290 });
      doc.text(String(Number(item.quantity)), col2, y);
      doc.text(formatCurrency(item.unitPrice), col3, y);
      doc.text(formatCurrency(item.total), col5, y, { align: 'right', width: 50 });
      
      y += 20;
    }
    
    // Totals
    y += 20;
    doc.moveTo(col3, y).lineTo(580, y).stroke();
    y += 10;
    
    doc.text('Subtotal:', col3, y);
    doc.text(formatCurrency(invoice.subtotal), col5, y, { align: 'right', width: 50 });
    y += 15;
    
    if (Number(invoice.taxAmount) > 0) {
      doc.text('Tax:', col3, y);
      doc.text(formatCurrency(invoice.taxAmount), col5, y, { align: 'right', width: 50 });
      y += 15;
    }
    
    if (Number(invoice.discount) > 0) {
      doc.text('Discount:', col3, y);
      doc.text(`-${formatCurrency(invoice.discount)}`, col5, y, { align: 'right', width: 50 });
      y += 15;
    }
    
    doc.font('Helvetica-Bold');
    doc.text('Total:', col3, y);
    doc.text(formatCurrency(invoice.total), col5, y, { align: 'right', width: 50 });
    y += 15;
    
    if (Number(invoice.amountPaid) > 0) {
      doc.font('Helvetica').fillColor('#10b981');
      doc.text('Paid:', col3, y);
      doc.text(`-${formatCurrency(invoice.amountPaid)}`, col5, y, { align: 'right', width: 50 });
      doc.fillColor('#000000');
      y += 15;
    }
    
    doc.font('Helvetica-Bold').fontSize(14);
    const balanceColor = Number(invoice.balance) > 0 ? '#dc2626' : '#10b981';
    doc.fillColor(balanceColor);
    doc.text('Balance Due:', col3, y);
    doc.text(formatCurrency(invoice.balance), col5, y, { align: 'right', width: 50 });
    doc.fillColor('#000000');
    
    // Payment history
    if (invoice.payments && invoice.payments.length > 0) {
      doc.moveDown(3);
      doc.font('Helvetica-Bold').fontSize(10).text('Payment History:');
      doc.font('Helvetica').fontSize(9);
      
      for (const payment of invoice.payments) {
        doc.text(`${formatDate(payment.paidAt)} - ${payment.method} - ${formatCurrency(payment.amount)}${payment.reference ? ` (${payment.reference})` : ''}`);
      }
    }
    
    // Notes
    if (invoice.notes) {
      doc.moveDown(2);
      doc.font('Helvetica-Bold').fontSize(10).text('Notes:');
      doc.font('Helvetica').text(invoice.notes);
    }
    
    // Terms
    if (invoice.terms) {
      doc.moveDown(2);
      doc.font('Helvetica-Bold').fontSize(10).text('Terms:');
      doc.font('Helvetica').fontSize(8).text(invoice.terms);
    }
    
    // Footer
    doc.fontSize(8).text(
      'Thank you for your business!',
      50, 750,
      { align: 'center', width: 500 }
    );

    doc.end();
  });
}

// Save PDF to file
export async function savePDF(buffer, companyId, type, id) {
  const dir = path.join(UPLOAD_DIR, companyId, 'pdfs');
  ensureDir(dir);
  
  const filename = `${type}-${id}-${Date.now()}.pdf`;
  const filepath = path.join(dir, filename);
  
  fs.writeFileSync(filepath, buffer);
  
  return {
    path: filepath,
    filename,
    url: `/uploads/${companyId}/pdfs/${filename}`,
  };
}

export default {
  generateQuotePDF,
  generateInvoicePDF,
  savePDF,
};
