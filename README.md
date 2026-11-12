# Amatu Draw

Aplikasi desain grafis vektor bergaya CorelDRAW yang berjalan di peramban — https://liemyo.github.io/corel/

Tanpa build: modul ES biasa (`index.html` + `js/` + `css/`). Pustaka pihak ketiga dimuat dari jsDelivr saat dibutuhkan:
paper.js (boolean), Clipper (offset), opentype.js (teks → kurva), jsPDF + svg2pdf.js (PDF), ImageTracer.js (trace bitmap), qrcode-generator, Fontsource (huruf).

## Struktur

| Berkas | Isi |
| --- | --- |
| `js/geom.js` | matriks afin, jalur bézier (node + pegangan), flatten, parser jalur SVG |
| `js/shapes.js` | geometri persegi/elips/poligon/spiral + ±70 Bentuk Sempurna dengan pegangan ◆ |
| `js/fonts.js` | registri font, tata letak teks artistik/paragraf, teks ke kurva, teks di jalur |
| `js/objgeom.js` | objek → geometri dunia (amplop, perspektif, distorsi), kotak batas, penghubung |
| `js/effects.js` | campuran, kontur, ekstrusi, bayangan blok, bayangan perspektif |
| `js/render.js` | dokumen → SVG (isian gradasi/pola/tekstur, kerangka, panah, lensa, PowerClip, transparansi) |
| `js/ops.js` | Las/Pangkas/Irisan/Sederhanakan, kombinasi, grup, urutan, rata & distribusi, PowerClip, konversi |
| `js/tools/*` | Alat Pilih, Bentuk, kuas deformasi, potong/pisau/penghapus, alat gambar, teks, alat efek interaktif |
| `js/ui/*` | menu, toolbar, bilah properti kontekstual, docker, dialog, layar sambutan, tema liquid glass |
| `js/trace/*`, `js/ui/autotrace.js` | Trace Otomatis: gambar → garis vektor halus & presisi (tepi sub-piksel, latar & bayangan dibuang, kurva Bézier, isian warna opsional) — Bitmap › Trace Otomatis, Berkas › Impor gambar & Trace Otomatis |
| `js/io.js` | `.adraw`, impor SVG/gambar, ekspor SVG/PNG/JPG/WebP/PDF, cetak, simpan otomatis, PowerTRACE |

## Deploy

Edit berkas lalu `git commit` + `git push` (GitHub Pages, cabang `main`, root).
