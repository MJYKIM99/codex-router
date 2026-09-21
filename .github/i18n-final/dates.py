from pathlib import Path
r = Path.cwd()
p = r / 'apps/control-center/src/pages/DashboardPage.tsx'
s = p.read_text().replace('import type { Translate } from "../i18n";', 'import { translatorLocale, type Translate } from "../i18n";')
s = s.replace('buildTrafficBuckets(events, providerUsage, eventHours, trafficRange, Date.now())', 'buildTrafficBuckets(events, providerUsage, eventHours, trafficRange, Date.now(), t)')
s = s.replace('() => buildTokenActivity(events, providerUsage, Date.now()),\n    [events, providerUsage],', '() => buildTokenActivity(events, providerUsage, Date.now(), t),\n    [events, providerUsage, t],')
for fn in ['buildTokenActivity', 'buildTrafficBuckets', 'buildHourlyTrafficBuckets', 'buildDailyTrafficBuckets']:
    start = s.index('function ' + fn + '(')
    end = s.index('):', start)
    part = s[start:end]
    assert 'now: number,' in part
    part = part.replace('now: number,', 'now: number,\n  t: Translate,')
    s = s[:start] + part + s[end:]
s = s.replace('buildHourlyTrafficBuckets(events, hours, now)', 'buildHourlyTrafficBuckets(events, hours, now, t)').replace('buildDailyTrafficBuckets(events, providerUsage, range, now)', 'buildDailyTrafficBuckets(events, providerUsage, range, now, t)').replace('hourlyBucketsFromRollup(hours);', 'hourlyBucketsFromRollup(hours, t);')
block = '''const HOUR_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", { hour: "numeric" });
const HOUR_FULL_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
});

'''
assert block in s
s = s.replace(block, '')
s = s.replace('function hourlyBucketsFromRollup(hours: UsageEventHour[]): TrafficBucket[] {', '''function hourlyBucketsFromRollup(hours: UsageEventHour[], t: Translate): TrafficBucket[] {
  const hourLabelFormatter = new Intl.DateTimeFormat(translatorLocale(t), { hour: "numeric" });
  const hourFullLabelFormatter = new Intl.DateTimeFormat(translatorLocale(t), {
    month: "short", day: "numeric", hour: "numeric",
  });''')
s = s.replace('HOUR_LABEL_FORMATTER.format', 'hourLabelFormatter.format').replace('HOUR_FULL_LABEL_FORMATTER.format', 'hourFullLabelFormatter.format').replace('new Intl.DateTimeFormat("en-US",', 'new Intl.DateTimeFormat(translatorLocale(t),')
p.write_text(s)
p = r / 'apps/control-center/src/pages/UsagePage.tsx'
s = p.read_text().replace('import type { Translate } from "../i18n";', 'import { translatorLocale, type Translate } from "../i18n";')
for expr in ['buckets[0]?.startDate', 'buckets.at(-1)?.startDate', 'latestReportedBucket.startDate', 'bucket.startDate']:
    s = s.replace('formatBucketDate(' + expr + ')', 'formatBucketDate(' + expr + ', t)')
s = s.replace('function formatBucketDate(value?: string): string {\n  if (!value) return "No data";', 'function formatBucketDate(value: string | undefined, t: Translate): string {\n  if (!value) return t("display.noData");')
s = s.replace('new Intl.DateTimeFormat("en-US",', 'new Intl.DateTimeFormat(translatorLocale(t),').replace('          {days}D', '          {t("display.daysD", { days })}')
p.write_text(s)
p = r / 'apps/control-center/src/lib.ts'
s = p.read_text().replace('formatBalance(Number(metric.value), metric.currency)', 'formatBalance(Number(metric.value), metric.currency, t)').replace('function formatBalance(value: number, currency?: string): string {', 'function formatBalance(value: number, currency: string | undefined, t: Translate): string {').replace('new Intl.NumberFormat("en-US",', 'new Intl.NumberFormat(translatorLocale(t),')
p.write_text(s)
p = r / 'test/router-dashboard-ui.test.mjs'
s = p.read_text().replace('hourlyBucketsFromRollup(hours)', 'hourlyBucketsFromRollup(hours, t)')
s += '''

test("chart dates follow the active translator without changing UTC bucket ownership", async () => {
  const dashboard = await readFile(new URL("../apps/control-center/src/pages/DashboardPage.tsx", import.meta.url), "utf8");
  const usage = await readFile(new URL("../apps/control-center/src/pages/UsagePage.tsx", import.meta.url), "utf8");
  for (const source of [dashboard, usage]) {
    assert.doesNotMatch(source, /new Intl\\.DateTimeFormat\\("en-US"/);
    assert.match(source, /new Intl\\.DateTimeFormat\\(translatorLocale\\(t\\)/);
  }
  assert.match(dashboard, /buildTokenActivity\\(events, providerUsage, Date\\.now\\(\\), t\\)/);
  assert.match(dashboard, /\\[events, providerUsage, t\\]/);
  assert.match(dashboard, /timeZone: "UTC"/);
  assert.match(usage, /formatBucketDate\\(buckets\\[0\\]\\?\\.startDate, t\\)/);
});
'''
p.write_text(s)
p = r / 'apps/macos/ModelRouterTray/Sources/RouterTraditionalChineseText.swift'
s = p.read_text()
changes = {
    '"Applying…": "應用程式中…"': '"Applying…": "正在套用…"',
    '"Apply the checked-out router revision, then run the Codex doctor": "應用程式已檢出的路由版本，然後運行 Codex doctor"': '"Apply the checked-out router revision, then run the Codex doctor": "套用目前簽出的路由器版本，然後執行 Codex doctor"',
    '"Model settings applied. Restart Codex to refresh its picker.": "模型設置已應用程式。請重啓 Codex 以重新整理模型選擇器。"': '"Model settings applied. Restart Codex to refresh its picker.": "已套用模型設定。請重新啟動 Codex 以重新整理模型選擇器。"',
}
for a, b in changes.items():
    assert a in s
    s = s.replace(a, b)
p.write_text(s.replace('Token 精簡 已關閉', 'Token 精簡已關閉'))
for name in ['apps/control-center/src/locales/zh-TW.ts', 'apps/panel/messages.mjs']:
    p = r / name
    p.write_text(p.read_text().replace('Token 精簡 狀態', 'Token 精簡狀態').replace('Token 精簡 將保持', 'Token 精簡將保持').replace('Token 精簡 已關閉', 'Token 精簡已關閉'))
p = r / 'apps/control-center/test/renderer.test.mjs'
s = p.read_text()
needle = '''      await page.getByText(copy.selected, { exact: true }).waitFor();
      await page.getByText(copy.others, { exact: true }).waitFor();'''
assert needle in s
s = s.replace(needle, needle + '''
      if (language !== "en") {
        const axis = await page.locator(".us-chart-caption").innerText();
        assert.doesNotMatch(axis, /Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/);
        assert.match(axis, /月|\\d+\\/\\d+/);
      }''')
start = s.index('// Independent expectations for the newly merged Usage and custom-endpoint')
s = s[:start] + s[start:].replace('await page.getByRole("button", { name: copy.addModels, exact: true }).click();', 'await page.locator(".pm-connection-menu").getByRole("button", { name: copy.addModels, exact: true }).click();')
s = s.replace('''      assert.equal(await catalogDialog.locator(".pm-add-models-toolbar input").inputValue(), name);''', '''      await page.waitForFunction((expected) => document.querySelector(".pm-add-models-toolbar input")?.value === expected, name);
      assert.equal(await catalogDialog.locator(".pm-add-models-toolbar input").inputValue(), name);''')
p.write_text(s)
p = r / 'test/control-center-usage.test.mjs'
s = p.read_text().replace('LANGUAGE_OPTIONS, translate', 'LANGUAGE_OPTIONS, translate, createTranslator')
s += '''

test("explicit interface locale formats balances without changing their source values", () => {
  const metric = { kind: "balance", value: 12.5, currency: "USD" };
  const original = { ...metric };
  for (const [language, locale] of [["en", "en-US"], ["zh-CN", "zh-CN"], ["zh-TW", "zh-TW"]]) {
    const t = createTranslator(language);
    assert.equal(metricValue(metric, t), new Intl.NumberFormat(locale, {
      style: "currency", currency: "USD", maximumFractionDigits: 2,
    }).format(12.5));
    assert.equal(metricValue({ kind: "balance", value: 8.25, currency: "DIEM" }, t), "8.25 DIEM");
  }
  assert.deepEqual(metric, original);
});
'''
p.write_text(s)
