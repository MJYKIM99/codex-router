from pathlib import Path
p=Path('apps/control-center/src/pages/usage-status.css');s=p.read_text()
for variant in ['subscription','router','aggregate']:
    old=f'.usage-page .us-summary-grid.is-{variant} {{ grid-template-columns:'
    assert s.count(old)==1
    s=s.replace(old,f'.usage-page .us-summary-grid:where(.is-{variant}) {{ grid-template-columns:')
s=s.replace('.usage-page .us-summary-grid:where(.is-subscription)', '/* Variant defaults must not outrank the narrower-window media rules below. */\n.usage-page .us-summary-grid:where(.is-subscription)',1)
old='''  text-overflow: clip;
  white-space: normal;
  overflow-wrap: anywhere;
}'''
assert s.count(old)==1
s=s.replace(old,'''  text-overflow: clip;
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.25;
}''')
p.write_text(s)
p=Path('apps/control-center/test/renderer.test.mjs');s=p.read_text()
old='''        const fits = await page.locator(".us-summary-grid .tone-cached dd").evaluate((element) =>
          element.scrollWidth <= element.clientWidth + 1
          && element.scrollHeight <= element.clientHeight + 1);
        assert.equal(fits, true, `${language} cache hit rate is clipped at ${width}px`);'''
new='''        const box = await page.locator(".us-summary-grid .tone-cached dd").evaluate((element) => ({
          width: element.clientWidth, contentWidth: element.scrollWidth,
          height: element.clientHeight, contentHeight: element.scrollHeight,
        }));
        assert.equal(box.contentWidth <= box.width + 1 && box.contentHeight <= box.height + 1,
          true, `${language} cache hit rate is clipped at ${width}px: ${JSON.stringify(box)}`);
        const columns = await page.locator(".us-summary-grid").evaluate((element) =>
          getComputedStyle(element).gridTemplateColumns.split(/\\s+/).length);
        assert.equal(columns, width <= 1120 ? 3 : 7, "summary variants must obey the responsive breakpoint");
        if (width === 960) await captureIntegrationView(page, `usage-narrow-${language}`);'''
assert s.count(old)==1;s=s.replace(old,new);p.write_text(s)
