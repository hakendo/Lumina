const { PDFDocument } = require('pdf-lib');

async function exportReportToPDF(baseUrl, pageIds = []) {
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  try {
    const targets = pageIds.length > 0
      ? pageIds.map((id) => `${baseUrl}&pageId=${id}`)
      : [baseUrl];

    const pagePdfs = [];
    for (const url of targets) {
      const tab = await browser.newPage();
      await tab.setViewport({ width: 1280, height: 900 });
      await tab.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
      await tab.waitForSelector('[data-report-ready]', { timeout: 10000 }).catch(() => {});
      const pdf = await tab.pdf({ format: 'A4', landscape: true, printBackground: true });
      pagePdfs.push(pdf);
      await tab.close();
    }

    if (pagePdfs.length === 1) return pagePdfs[0];

    // Merge all page PDFs into one document
    const merged = await PDFDocument.create();
    for (const buf of pagePdfs) {
      const src = await PDFDocument.load(buf);
      const copied = await merged.copyPages(src, src.getPageIndices());
      copied.forEach((p) => merged.addPage(p));
    }
    return Buffer.from(await merged.save());
  } finally {
    await browser.close();
  }
}

module.exports = { exportReportToPDF };
