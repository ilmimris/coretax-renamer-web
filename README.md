# coretax-renamer-web

PWA to batch-rename **Faktur Pajak** PDFs exported from Coretax.  
Works **100% client-side** — no server, fully offline-capable.

## What it does

Takes opaque Coretax filenames like:
```
OutputTaxInvoice-5e88af09-...-0958653362422000.pdf
```
and renames them to:
```
INV-26-04-007094 ANUGERAH EMPAT SAUDARA 05002600142255823.pdf
```

The buyer name, invoice reference, and faktur pajak code are extracted from the PDF's text layer using **pdf.js** — no OCR, no server calls.

## Features

- **Client-side only** — all processing happens in your browser
- **Offline support** — works without internet after first load (Service Worker caches pdf.js)
- **Configurable delimiter** — choose space, underscore, hyphen, dot, or custom separator
- **Custom filename template** — `{invoice}`, `{name}`, `{kode}`, `{d}` (delimiter)
- **Drag & drop** or file browse
- **Batch download** renamed PDFs
- **Collision handling** — auto-appends `(2)`, `(3)` for duplicate names

## Usage

1. Open the app in a browser
2. Drop Faktur Pajak PDFs onto the window, or click **Browse PDFs…**
3. The app parses each PDF and shows the proposed new filename
4. Adjust delimiter / template in **⚙️ Settings** if needed
5. Click **Apply** to download all renamed PDFs

## Install as PWA

After first load, browsers will offer "Install" to add it to your home screen / desktop. Once installed, it works fully offline.

## Development

```bash
# Serve locally (any static server works)
npx serve .

# Or with Python
python3 -m http.server 8080
```

## Building Icons

Generate PWA icons (or replace with your own):
```bash
# Using ImageMagick (requires source icon.png)
convert icon.png -resize 192x192 icon-192.png
convert icon.png -resize 512x512 icon-512.png
```

## License

Internal tool — owned by me.


## SEO & GEO readiness

This app includes technical discoverability enhancements for both classic search engines (SEO) and generative engines (GEO):

- Rich page metadata (title, description, canonical, Open Graph, Twitter Card)
- Structured data (`WebApplication` schema in JSON-LD)
- Crawl directives in `robots.txt`
- Discoverability via `sitemap.xml`
- LLM-oriented context via `llms.txt`
