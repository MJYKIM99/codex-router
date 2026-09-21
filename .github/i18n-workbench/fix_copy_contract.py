"""Reproduce the exact UI copy correction; refuse a different candidate tree."""
from pathlib import Path
import json
import subprocess
import sys

root = Path(sys.argv[1]).resolve()

def git(*args):
    return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()

assert git('rev-parse', 'HEAD^{tree}') == '3cda5287fabcad8bd4ec64a945e86f93ff95fc21'
assert not git('status', '--porcelain')
changes = {
    'en': {'models.route.thinking': ('Thinking', 'Reasoning effort')},
    'zh-CN': {
        'models.route.thinking': ('思考中', '推理强度'),
        'models.method.apiKey': ('API key', 'API 密钥'),
        'models.credential.apiKey': ('API key', 'API 密钥'),
    },
    'zh-TW': {
        'models.route.thinking': ('思考', '推理強度'),
        'harness.title': ('Harness', '工具鏈'),
        'context.title': ('Context Manager', 'Context 管理'),
    },
}
for language, entries in changes.items():
    file = root / 'apps/control-center/src/locales' / f'{language}.ts'
    source = file.read_text()
    for key, (old, new) in entries.items():
        before = json.dumps(key, ensure_ascii=False) + ': ' + json.dumps(old, ensure_ascii=False)
        after = json.dumps(key, ensure_ascii=False) + ': ' + json.dumps(new, ensure_ascii=False)
        assert source.count(before) == 1, (language, key)
        source = source.replace(before, after)
    file.write_text(source)
file = root / 'test/chinese-i18n-contract.test.mjs'
source = file.read_text()
needle = 'test("all UI surfaces distinguish script, region and persisted locale ids consistently", () => {'
block = '''test("page headings and reasoning controls retain their meaning in each locale", () => {
  const en = createTranslator("en"), cn = createTranslator("zh-CN"), tw = createTranslator("zh-TW");
  // These are UI contract expectations, not values read back from a catalog:
  // a settings column must not become the transient "Thinking" activity state.
  assert.equal(en("models.route.thinking"), "Reasoning effort");
  assert.equal(cn("models.route.thinking"), "推理强度");
  assert.equal(tw("models.route.thinking"), "推理強度");
  assert.equal(tw("harness.title"), "工具鏈");
  assert.equal(tw("context.title"), "Context 管理");
  for (const key of ["models.method.apiKey", "models.credential.apiKey"]) {
    assert.equal(cn(key), "API 密钥");
    assert.equal(tw(key), "API 金鑰");
  }
});

'''
assert source.count(needle) == 1
file.write_text(source.replace(needle, block + needle))
git('add', '-u')
git('diff', '--cached', '--check')
actual = git('write-tree')
assert actual == 'e6ff72c27b1c5dba2e36626b89d8f44325c1313c', actual
print(actual)
