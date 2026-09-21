from pathlib import Path
import re
r = Path.cwd()
for f in ['apps/macos/ModelRouterTray/Sources/Localization.swift', 'apps/macos/RouterUsageWidget/RouterUsageWidget/RouterUsageWidget.swift']:
    p = r / f
    s = p.read_text()
    old = 'tag.split(separator: "-").prefix { $0.count != 1 }.joined(separator: "-")'
    assert s.count(old) == 1
    p.write_text(s.replace(old, 'tag.components(separatedBy: "-").prefix(while: { $0.count != 1 }).joined(separator: "-")'))
p = r / 'apps/control-center/src/App.tsx'
s = p.read_text().replace('// The tray context menu is built in the main process, which has no\n    // dictionary of its own; hand it the labels this renderer already resolved.', '// The main process owns its menu dictionaries. Send only the resolved\n    // language ID through its existing trusted-renderer boundary.')
p.write_text(s)
p = r / 'apps/control-center/test/renderer.test.mjs'
s = p.read_text().replace('''        providers.customEndpoints.push({
          id, ...input, kind: "api", generic: true, configured: true, enabled: true,''', '''        const { credential, ...publicFields } = input;
        providers.customEndpoints.push({
          id, ...publicFields, kind: "api", generic: true, configured: true, enabled: true,''')
s = s.replace('hasKey: Boolean(input.credential), credentialLabel: "API key",', 'hasKey: Boolean(credential), credentialLabel: "API key",')
s = s.replace('''      assert.equal(await editing.locator("#custom-endpoint-name").inputValue(), name);''', '''      // React populates the edit form in an effect after the dialog opens.
      // Wait for that observable state, not a fixed delay or mere DOM presence.
      await page.waitForFunction((expected) => document.querySelector("#custom-endpoint-name")?.value === expected, name);
      assert.equal(await editing.locator("#custom-endpoint-name").inputValue(), name);''')
s = s.replace('''      await dialog.getByLabel(copy.key, { exact: true }).fill("test-only-not-a-real-key");''', '''      await captureIntegrationView(page, `custom-endpoint-add-${language}`);
      await dialog.getByLabel(copy.key, { exact: true }).fill("test-only-not-a-real-key");''')
s = s.replace('''      assert.doesNotMatch(await notice.innerText(), /test-only-not-a-real-key/);''', '''      assert.doesNotMatch(await notice.innerText(), /test-only-not-a-real-key/);
      await captureIntegrationView(page, `custom-endpoint-diagnostic-${language}`);''')
s = s.replace('''      assert.equal(await editing.locator("#custom-endpoint-key").inputValue(), "", "stored credentials must not be rendered back");''', '''      assert.equal(await editing.locator("#custom-endpoint-key").inputValue(), "", "stored credentials must not be rendered back");
      await captureIntegrationView(page, `custom-endpoint-edit-${language}`);''')
s = s.replace('''      await page.getByText("2.5k (25%)", { exact: true }).waitFor();''', '''      await page.getByText("2.5k (25%)", { exact: true }).waitFor();
      await captureIntegrationView(page, `usage-account-groups-${language}`);''')
marker = '// Independent expectations for the newly merged Usage and custom-endpoint'
assert marker in s
s = s.replace(marker, '''async function captureIntegrationView(page, name) {
  const artifacts = process.env.CODEX_ROUTER_UI_ARTIFACTS;
  if (!artifacts) return;
  mkdirSync(artifacts, { recursive: true });
  // Test data only; credential fields are empty at the capture sites.
  await page.screenshot({ path: path.join(artifacts, `${name}.png`) });
}

''' + marker)
p.write_text(s)
p = r / 'apps/control-center/src/locales/zh-TW.ts'
s = p.read_text()
changes = {
    '"harness.row.agent": "Agent"': '"harness.row.agent": "代理程式"',
    '"harness.row.agentCount": "Agent · {count}"': '"harness.row.agentCount": "代理程式 · {count}"',
    '"usage.chart.tokensTotal": "{count} tokens"': '"usage.chart.tokensTotal": "{count} 個 token"',
    '"dashboard.tooltip.tokens": "{count} tokens"': '"dashboard.tooltip.tokens": "{count} 個 token"',
    '"status.model.req": "{count} req"': '"status.model.req": "{count} 次"',
}
for a, b in changes.items():
    assert a in s
    s = s.replace(a, b)
p.write_text(s.replace('Token maxxing', 'Token 精簡'))
p = r / 'apps/panel/messages.mjs'
s = p.read_text()
start = s.index('"zh-TW":')
end = s.index('\n  "ar":', start)
section = s[start:end].replace('Token maxxing', 'Token 精簡').replace('"connections.githubToken": "GitHub token"', '"connections.githubToken": "GitHub 權杖"')
p.write_text(s[:start] + section + s[end:])
p = r / 'apps/macos/ModelRouterTray/Sources/RouterTraditionalChineseText.swift'
s = re.sub(r'(:\s*")([^"\n]*)', lambda m: m.group(1) + m.group(2).replace('Token maxxing', 'Token 精簡'), p.read_text())
p.write_text(s)
p = r / 'test/chinese-i18n-contract.test.mjs'
p.write_text(p.read_text() + '''

test("ordinary Traditional Chinese labels do not retain untranslated English prose", () => {
  const t = createTranslator("zh-TW");
  assert.equal(t("settings.context.title"), "Token 精簡");
  assert.equal(t("harness.row.agent"), "代理程式");
  assert.equal(t("harness.row.agentCount", { count: 2 }), "代理程式 · 2");
  assert.equal(t("status.model.req", { count: 3 }), "3 次");
  try {
    setLanguage("zh-TW");
    assert.equal(panelText("connections.githubToken"), "GitHub 權杖");
    assert.equal(panelText("models.compactOldToolResults"), "Token 精簡");
  } finally { setLanguage("en"); }
});
''')
