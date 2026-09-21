"""Reproduce a reviewed tree from pinned public source and checked build inputs."""
from pathlib import Path
import base64
import hashlib
import json
import lzma
import os
import shutil
import subprocess
import sys

here = Path(__file__).resolve().parent
workspace = Path(os.environ['RUNNER_TEMP']) / 'chinese-i18n-candidate'
workspace.mkdir()
packed = base64.b64decode(''.join((here / f'part-{i}.b64').read_text() for i in range(1, 5)), validate=True)
assert hashlib.sha256(packed).hexdigest() == '6e34def2fd71ad1971371da668983bff836ce1dbef00c5ffb335dfdee80ff56c'
raw = lzma.decompress(packed)
assert hashlib.sha256(raw).hexdigest() == '5f24514f17a44ba00053f54022c7cacc1b3c93547f69a538b5f16b1fe36a077e'
bundle = json.loads(raw)
assert bundle['expected_tree'] == '588b2609a16c802dc8127045f2e2f33e00c551e8'
inputs = workspace / 'i18n-workbench'
inputs.mkdir()
for name, sha in bundle['sources'].items():
    assert name in {'pr839', 'base', 'upstream', 'zhTW'} and len(sha) == 40
    archive = workspace / f'{name}.tar.gz'
    subprocess.run(['curl', '--fail', '--silent', '--show-error', '--location', '--retry', '2',
                    f'https://codeload.github.com/duolahypercho/codex-router/tar.gz/{sha}', '-o', str(archive)], check=True)
    destination = inputs / name
    destination.mkdir()
    subprocess.run(['tar', '-xzf', str(archive), '--strip-components=1', '-C', str(destination)], check=True)
shutil.copy2(shutil.which('node'), inputs / 'node24')
root = workspace / 'codex-router-integration'
shutil.copytree(inputs / 'pr839', root)

def git(*args):
    return subprocess.check_output(['git', *args], cwd=root).decode().strip()

git('init', '-q')
git('config', 'user.name', 'Localization validation')
git('config', 'user.email', 'validation@example.invalid')
git('config', 'core.autocrlf', 'false')
git('config', 'core.hooksPath', '/dev/null')
git('add', '-f', '.')
assert git('write-tree') == 'c1cc182b7561d8a34c0fadd8781dd295b7198158', 'PR snapshot is not exact'
git('commit', '-qm', 'Pinned source snapshot')
tools = workspace / 'i18n-tools'
tools.mkdir()
(workspace / 'i18n-evidence').mkdir()
parser = Path(os.environ['I18N_TYPESCRIPT'])
for name, content in bundle['scripts'].items():
    assert Path(name).name == name
    (tools / name).write_text(content.replace('__WORKSPACE__', str(workspace)).replace('__TYPESCRIPT__', str(parser)))
for name in bundle['sequence']:
    print('Reproduce:', name, flush=True)
    subprocess.run(['node' if name.endswith('.mjs') else 'python3', str(tools / name)], check=True)
    if name == 'write_catalogs.py':
        for path, content in bundle['core'].items():
            (root / path).write_text(content)
patch = workspace / 'supplement.patch'
patch.write_text(bundle['post_patch'])
git('apply', '--check', str(patch))
git('apply', str(patch))
git('add', '-A')
tree = git('write-tree')
assert tree == bundle['expected_tree'], f'Reproduction drift: {tree}'
git('diff', '--cached', '--check')
with (Path(os.environ['RUNNER_TEMP']) / 'candidate-source.tar').open('wb') as output:
    subprocess.run(['git', 'archive', tree], cwd=root, stdout=output, check=True)
(Path(os.environ['RUNNER_TEMP']) / 'candidate-tree.txt').write_text(tree + '\n')
print('Verified exact candidate tree:', tree, flush=True)
