async function exportReportToPDF(reportUrl) {
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(reportUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('[data-report-ready]', { timeout: 10000 }).catch(() => {});
    const pdf = await page.pdf({ format: 'A4', landscape: true, printBackground: true });
    return pdf;
  } finally {
    await browser.close();
  }
}

module.exports = { exportReportToPDF };
