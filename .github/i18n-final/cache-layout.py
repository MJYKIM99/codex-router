from pathlib import Path
p=Path('apps/control-center/src/pages/usage-status.css')
s=p.read_text(); needle='.usage-page .us-summary-grid .tone-cached dd { color: var(--token-cached); }'
assert s.count(needle)==1
s=s.replace(needle, '''/* The upstream cache counter now includes a hit rate. A narrow summary cell
   must wrap the rate instead of hiding it behind an ellipsis in any locale. */
.usage-page .us-summary-grid .tone-cached dd {
  color: var(--token-cached);
  overflow: visible;
  text-overflow: clip;
  white-space: normal;
  overflow-wrap: anywhere;
}''')
p.write_text(s)
p=Path('apps/control-center/test/renderer.test.mjs');s=p.read_text()
needle='''      await page.getByText("2.5k (25%)", { exact: true }).waitFor();
      await captureIntegrationView(page, `usage-account-groups-${language}`);'''
assert s.count(needle)==1
s=s.replace(needle, '''      await page.getByText("2.5k (25%)", { exact: true }).waitFor();
      // A present string can still be invisible behind CSS text-overflow.
      // Verify that both the counter and rate fit at supported window sizes.
      for (const width of [960, 1280, 1600]) {
        await page.setViewportSize({ width, height: 900 });
        const fits = await page.locator(".us-summary-grid .tone-cached dd").evaluate((element) =>
          element.scrollWidth <= element.clientWidth + 1
          && element.scrollHeight <= element.clientHeight + 1);
        assert.equal(fits, true, `${language} cache hit rate is clipped at ${width}px`);
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await captureIntegrationView(page, `usage-account-groups-${language}`);''')
p.write_text(s)
