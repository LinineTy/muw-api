/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import JSZip from 'jszip'

// 内置主题制作模板:前端直接用这些文件现生成 zip,无需后端存放。
// 模板里带注释说明固定页名与预览图约定,用户下载后照抄即可。
const TEMPLATE_HOME = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>My Theme</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1f2937; background: #ffffff; }
  header { padding: 14px 24px; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; justify-content: space-between; }
  .brand { font-weight: 700; }
  nav a { margin-left: 16px; color: #6b7280; text-decoration: none; font-size: 14px; }
  .hero { padding: 64px 24px; text-align: center; }
  .hero h1 { font-size: 36px; margin: 0 0 12px; }
  .hero p { color: #6b7280; max-width: 560px; margin: 0 auto 24px; }
  .cta { display: inline-block; background: #2563eb; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; }
</style>
</head>
<body>
  <header>
    <span class="brand">My Theme</span>
    <nav>
      <a href="#">Home</a>
      <a href="#">About</a>
      <a href="#">Agreement</a>
      <a href="#">Privacy</a>
    </nav>
  </header>
  <main class="hero">
    <h1>Welcome to My Theme</h1>
    <p>Replace this placeholder with your own landing page. The theme is rendered in a sandboxed iframe, so any HTML / CSS / JS works.</p>
    <a class="cta" href="#">Get Started</a>
  </main>
</body>
</html>
`

const TEMPLATE_SIMPLE_PAGE = (title: string, note: string) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<style>
  body { margin: 0; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1f2937; padding: 24px; line-height: 1.6; }
</style>
</head>
<body>
  <h1>${title}</h1>
  <p>${note}</p>
</body>
</html>
`

const TEMPLATE_README = `# New API Theme Template

A starter for a public-site theme. Zip it up and import it in
**System Settings → Site → Theme Configuration**. The ZIP file name becomes the theme name.

## Files

| File | Required | Description |
|------|----------|-------------|
| home.html | ✅ | Landing page |
| about.html | — | About page |
| agreement.html | — | User Agreement |
| privacy.html | — | Privacy Policy |
| preview.{png,jpg,jpeg,webp} | — | Card thumbnail (≤200KB) |
| version.txt | — | Version text shown on the card |

Only \`home.html\` is required; file names are fixed, other files are ignored.

## Tips

- Pages can be full HTML documents; external CSS/JS is allowed (rendered in a sandboxed iframe).
- No preview image? The card auto-renders a live thumbnail of the home page.
- Importing a theme selects it immediately. Empty pages fall back to the built-in view.

## Limits

- ZIP ≤ 2MB, each page ≤ 500KB, preview image ≤ 200KB, version.txt ≤ 200 bytes.

---

# New API 主题模板

用于制作公开站主题的起步模板。压缩后到 **系统设置 → 网站设置 → 主题配置** 导入即可,ZIP 文件名即主题名。

## 文件

| 文件 | 必填 | 说明 |
|------|------|------|
| home.html | ✅ | 营销页(首页) |
| about.html | — | 关于 |
| agreement.html | — | 用户协议 |
| privacy.html | — | 隐私政策 |
| preview.{png,jpg,jpeg,webp} | — | 卡片缩略图(≤200KB) |
| version.txt | — | 卡片右下角展示的版本文字 |

只有 \`home.html\` 必填;页名固定,其它文件会被忽略。

## 提示

- 页面可以是完整 HTML 文档;允许外部 CSS/JS(在沙箱 iframe 中渲染)。
- 不带缩略图时,卡片会自动实时渲染首页作为缩略图。
- 导入后立即选中生效。空页面回退到内置页面。

## 限制

- ZIP ≤ 2MB,每页 ≤ 500KB,预览图 ≤ 200KB,version.txt ≤ 200 字节。
`

export const THEME_TEMPLATE_FILES: Record<string, string> = {
  'README.md': TEMPLATE_README,
  'home.html': TEMPLATE_HOME,
  'about.html': TEMPLATE_SIMPLE_PAGE(
    'About',
    'Edit this page, or remove the file if this theme should not cover the About page.'
  ),
  'agreement.html': TEMPLATE_SIMPLE_PAGE(
    'User Agreement',
    'Edit this page, or remove the file if this theme should not cover the User Agreement page.'
  ),
  'privacy.html': TEMPLATE_SIMPLE_PAGE(
    'Privacy Policy',
    'Edit this page, or remove the file if this theme should not cover the Privacy Policy page.'
  ),
  'version.txt': '1.0.0',
}

// 前端现生成模板 zip 并触发下载。
export async function downloadThemeTemplate(): Promise<void> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(THEME_TEMPLATE_FILES)) {
    zip.file(name, content)
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'theme-template.zip'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
