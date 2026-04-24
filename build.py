#!/usr/bin/env python3
"""SoraVault micro-builder — concatenates headers + core for each target."""
import shutil, os

SRC    = 'src'
DIST   = 'dist'
CHROME = os.path.join(DIST, 'chrome-extension')

os.makedirs(DIST, exist_ok=True)
os.makedirs(CHROME, exist_ok=True)

# Tampermonkey: headers.txt + core.js -> SoraVault.user.js
with open(f'{SRC}/headers.txt', encoding='utf-8') as h, \
     open(f'{SRC}/core.js', encoding='utf-8') as c:
    with open(f'{DIST}/SoraVault.user.js', 'w', encoding='utf-8') as out:
        out.write(h.read() + '\n' + c.read())

# Chrome Extension: copy core.js + static files
shutil.copy(f'{SRC}/core.js', f'{CHROME}/content.js')
for f in ['manifest.json', 'background.js', 'bridge.js']:
    shutil.copy(f'{SRC}/chrome/{f}', f'{CHROME}/{f}')
shutil.copytree(f'{SRC}/chrome/assets', f'{CHROME}/assets', dirs_exist_ok=True)
shutil.copytree(f'{SRC}/img', f'{CHROME}/img', dirs_exist_ok=True)

print('Built: dist/SoraVault.user.js + dist/chrome-extension/')
