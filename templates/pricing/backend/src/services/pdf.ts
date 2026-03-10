import PDFDocument from 'pdfkit';
import { logger } from './logger';

interface CompanyInfo {
  name: string;
  logoUrl?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  licenseNumber?: string | null;
}

interface QuoteInfo {
  id: string;
  quoteNumber?: string | null;
  customerFirstName: string;
  customerLastName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerCity?: string | null;
  customerState?: string | null;
  customerZip?: string | null;
  subtotal: number;
  taxAmount: number;
  totalPrice: number;
  depositAmount?: number | null;
  notes?: string | null;
  presentedAt?: Date | null;
  signedAt?: Date | null;
  expiresAt?: Date | null;
}

interface LineItem {
  productName: string;
  categoryName?: string;
  tier: string;
  quantity: number;
  measurementValue?: number | null;
  measurementType?: string | null;
  unitPrice: number;
  sellingPrice: number;
}

interface AddonItem {
  name: string;
  price: number;
  quantity: number;
}

interface ContractInfo {
  contractText: string;
  customerSignatureSvg?: string | null;
  repSignatureSvg?: string | null;
  signedAt?: Date | null;
}

function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export async function generateQuotePdf(
  quote: QuoteInfo,
  lines: LineItem[],
  addons: AddonItem[],
  contract: ContractInfo | null,
  company: CompanyInfo
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        info: {
          Title: `Quote ${quote.quoteNumber || quote.id}`,
          Author: company.name,
        },
      });

      const chunks: Uint8Array[] = [];
      doc.on('data', (chunk: Uint8Array) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // --- Header ---
      doc.fontSize(20).font('Helvetica-Bold').text(company.name, 50, 50);
      doc.fontSize(9).font('Helvetica');
      let headerY = 75;
      if (company.address) {
        doc.text(company.address, 50, headerY);
        headerY += 12;
      }
      if (company.phone) {
        doc.text(`Phone: ${company.phone}`, 50, headerY);
        headerY += 12;
      }
      if (company.email) {
        doc.text(`Email: ${company.email}`, 50, headerY);
        headerY += 12;
      }
      if (company.licenseNumber) {
        doc.text(`License #: ${company.licenseNumber}`, 50, headerY);
        headerY += 12;
      }

      // Quote number on right
      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .text(`Quote #${quote.quoteNumber || quote.id.slice(0, 8)}`, 350, 50, {
          align: 'right',
        });
      doc.fontSize(9).font('Helvetica');
      doc.text(`Date: ${formatDate(quote.presentedAt || new Date())}`, 350, 70, { align: 'right' });
      if (quote.expiresAt) {
        doc.text(`Valid Until: ${formatDate(quote.expiresAt)}`, 350, 82, { align: 'right' });
      }

      // Divider
      const dividerY = Math.max(headerY, 100) + 10;
      doc.moveTo(50, dividerY).lineTo(562, dividerY).strokeColor('#333333').lineWidth(1).stroke();

      // --- Customer Info ---
      let currentY = dividerY + 15;
      doc.fontSize(12).font('Helvetica-Bold').text('Customer Information', 50, currentY);
      currentY += 18;
      doc.fontSize(9).font('Helvetica');
      doc.text(`${quote.customerFirstName} ${quote.customerLastName}`, 50, currentY);
      currentY += 12;
      if (quote.customerAddress) {
        doc.text(quote.customerAddress, 50, currentY);
        currentY += 12;
      }
      if (quote.customerCity || quote.customerState || quote.customerZip) {
        doc.text(
          `${quote.customerCity || ''}, ${quote.customerState || ''} ${quote.customerZip || ''}`.trim(),
          50,
          currentY
        );
        currentY += 12;
      }
      if (quote.customerPhone) {
        doc.text(`Phone: ${quote.customerPhone}`, 50, currentY);
        currentY += 12;
      }
      if (quote.customerEmail) {
        doc.text(`Email: ${quote.customerEmail}`, 50, currentY);
        currentY += 12;
      }

      currentY += 10;

      // --- Line Items Table ---
      doc.fontSize(12).font('Helvetica-Bold').text('Line Items', 50, currentY);
      currentY += 20;

      // Table header
      const colX = { product: 50, tier: 220, qty: 290, unit: 340, total: 440 };
      doc.fontSize(8).font('Helvetica-Bold');
      doc.text('Product', colX.product, currentY);
      doc.text('Tier', colX.tier, currentY);
      doc.text('Qty', colX.qty, currentY);
      doc.text('Unit Price', colX.unit, currentY);
      doc.text('Line Total', colX.total, currentY);
      currentY += 14;
      doc.moveTo(50, currentY).lineTo(562, currentY).strokeColor('#999999').lineWidth(0.5).stroke();
      currentY += 4;

      doc.fontSize(8).font('Helvetica');
      for (const line of lines) {
        if (currentY > 680) {
          doc.addPage();
          currentY = 50;
        }
        doc.text(line.productName, colX.product, currentY, { width: 165 });
        doc.text(line.tier, colX.tier, currentY);
        doc.text(String(line.quantity), colX.qty, currentY);
        doc.text(formatCurrency(line.unitPrice), colX.unit, currentY);
        doc.text(formatCurrency(line.sellingPrice), colX.total, currentY);
        currentY += 14;
      }

      // --- Addons ---
      if (addons.length > 0) {
        currentY += 8;
        if (currentY > 680) {
          doc.addPage();
          currentY = 50;
        }
        doc.fontSize(10).font('Helvetica-Bold').text('Add-Ons', 50, currentY);
        currentY += 16;
        doc.fontSize(8).font('Helvetica');
        for (const addon of addons) {
          if (currentY > 700) {
            doc.addPage();
            currentY = 50;
          }
          doc.text(addon.name, 60, currentY);
          doc.text(`x${addon.quantity}`, 340, currentY);
          doc.text(formatCurrency(addon.price * addon.quantity), 440, currentY);
          currentY += 12;
        }
      }

      // --- Totals ---
      currentY += 15;
      if (currentY > 680) {
        doc.addPage();
        currentY = 50;
      }
      doc.moveTo(340, currentY).lineTo(562, currentY).strokeColor('#333333').lineWidth(1).stroke();
      currentY += 8;
      doc.fontSize(9).font('Helvetica');
      doc.text('Subtotal:', 340, currentY);
      doc.text(formatCurrency(quote.subtotal), 440, currentY);
      currentY += 14;
      doc.text('Tax:', 340, currentY);
      doc.text(formatCurrency(quote.taxAmount), 440, currentY);
      currentY += 14;
      doc.fontSize(11).font('Helvetica-Bold');
      doc.text('Total:', 340, currentY);
      doc.text(formatCurrency(quote.totalPrice), 440, currentY);
      currentY += 14;

      if (quote.depositAmount) {
        doc.fontSize(9).font('Helvetica');
        doc.text('Deposit Required:', 340, currentY);
        doc.text(formatCurrency(quote.depositAmount), 440, currentY);
        currentY += 14;
      }

      // --- Notes ---
      if (quote.notes) {
        currentY += 10;
        if (currentY > 650) {
          doc.addPage();
          currentY = 50;
        }
        doc.fontSize(10).font('Helvetica-Bold').text('Notes', 50, currentY);
        currentY += 14;
        doc.fontSize(8).font('Helvetica').text(quote.notes, 50, currentY, { width: 500 });
        currentY += doc.heightOfString(quote.notes, { width: 500 }) + 10;
      }

      // --- Contract ---
      if (contract) {
        doc.addPage();
        currentY = 50;
        doc.fontSize(14).font('Helvetica-Bold').text('Contract Agreement', 50, currentY, {
          align: 'center',
          width: 512,
        });
        currentY += 30;
        doc.fontSize(8).font('Helvetica').text(contract.contractText, 50, currentY, {
          width: 512,
          lineGap: 3,
        });
        currentY += doc.heightOfString(contract.contractText, { width: 512, lineGap: 3 }) + 20;

        // Signature blocks
        if (currentY > 620) {
          doc.addPage();
          currentY = 50;
        }

        // Customer signature
        doc.fontSize(9).font('Helvetica-Bold').text('Customer Signature:', 50, currentY);
        currentY += 14;
        if (contract.customerSignatureSvg) {
          doc.fontSize(8).font('Helvetica').text('[Signature captured electronically]', 50, currentY);
        } else {
          doc.moveTo(50, currentY + 20).lineTo(250, currentY + 20).stroke();
        }

        // Rep signature
        doc.fontSize(9).font('Helvetica-Bold').text('Representative Signature:', 300, currentY - 14);
        if (contract.repSignatureSvg) {
          doc.fontSize(8).font('Helvetica').text('[Signature captured electronically]', 300, currentY);
        } else {
          doc.moveTo(300, currentY + 20).lineTo(500, currentY + 20).stroke();
        }
        currentY += 35;

        if (contract.signedAt) {
          doc.fontSize(8).font('Helvetica').text(`Signed: ${formatDate(contract.signedAt)}`, 50, currentY);
        }
        currentY += 20;
      }

      // --- Legal footer ---
      if (currentY > 680) {
        doc.addPage();
        currentY = 50;
      }
      doc
        .fontSize(7)
        .font('Helvetica')
        .fillColor('#666666')
        .text(
          'This document is a binding agreement between the customer and the company. Prices are valid for the period specified. All work is subject to the terms and conditions outlined in the contract above. The customer acknowledges their right to cancel within the rescission period as required by applicable state and federal law.',
          50,
          currentY,
          { width: 512, align: 'center' }
        );

      doc.end();
    } catch (err) {
      logger.error('PDF generation failed', { error: (err as Error).message });
      reject(err);
    }
  });
}
