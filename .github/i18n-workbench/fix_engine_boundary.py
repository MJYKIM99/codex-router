"""Apply the locally validated, tree-hash-gated renderer boundary correction."""
from pathlib import Path
import subprocess
import sys

root = Path(sys.argv[1]).resolve()
expected_base = '588b2609a16c802dc8127045f2e2f33e00c551e8'
expected_final = '3cda5287fabcad8bd4ec64a945e86f93ff95fc21'
def git(*args):
    return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()
assert git('rev-parse', 'HEAD^{tree}') == expected_base
assert not git('status', '--porcelain')
p = root / 'apps/control-center/src/i18n.ts'
s = p.read_text()
old = 'import { createContext, useContext } from "react";\n'
assert s.count(old) == 1
s = s.replace(old, '')
old = '\nexport const I18nContext = createContext<Translate>(createTranslator("en"));\nexport function useI18n(): Translate { return useContext(I18nContext); }\n'
assert s.count(old) == 1
p.write_text(s.replace(old, ''))
(root / 'apps/control-center/src/i18n-react.ts').write_text('''import { createContext, useContext } from "react";
import { createTranslator, type Translate } from "./i18n.ts";

// React belongs to the renderer package. Keep the message engine, backend
// adapter and formatters importable with only the root package installed.
export const I18nContext = createContext<Translate>(createTranslator("en"));
export function useI18n(): Translate { return useContext(I18nContext); }
''')
for p in (root / 'apps/control-center/src').rglob('*.tsx'):
    s = p.read_text()
    original = s
    if p.name == 'App.tsx':
        assert s.count('  I18nContext,\n') == 1
        s = 'import { I18nContext } from "./i18n-react";\n' + s.replace('  I18nContext,\n', '')
    else:
        for prefix in ['.', '..']:
            s = s.replace(f'import {{ useI18n }} from "{prefix}/i18n";', f'import {{ useI18n }} from "{prefix}/i18n-react";')
            s = s.replace(f'import {{ useI18n, type Translate }} from "{prefix}/i18n";', f'import {{ useI18n }} from "{prefix}/i18n-react";\nimport type {{ Translate }} from "{prefix}/i18n";')
    if s != original:
        p.write_text(s)
p = root / 'docs/LOCALIZATION.md'
s = p.read_text()
old = '- Render with the existing `Translate` function (`t("section.intent", values)`).'
assert s.count(old) == 1
p.write_text(s.replace(old, '- Keep `i18n.ts`, its dictionaries and formatters framework-independent. React\n  context and hooks live in `i18n-react.ts`; root tests must not require the\n  renderer package to be installed.\n' + old))
(root / 'test/control-center-i18n-standalone.test.mjs').write_bytes(Path(__file__).with_name('standalone.test.mjs').read_bytes())
git('add', '-u')
git('add', 'apps/control-center/src/i18n-react.ts', 'test/control-center-i18n-standalone.test.mjs')
git('diff', '--cached', '--check')
actual = git('write-tree')
assert actual == expected_final, (actual, expected_final)
print(actual)
