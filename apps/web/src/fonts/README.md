# Vendored fonts

`caveat-600-hand.woff2` is Caveat SemiBold (Google Fonts, SIL Open Font
License 1.1, `OFL-Caveat.txt`), subset to the characters the marketing
site's handwritten labels (`.hand`) can contain: ASCII letters, digits, space,
`.,:;!?%'"()&+-/` and the curly quotes, dashes and ellipsis. Contextual
alternates (`calt`, the alternate letterforms that vary repeated letters) are
dropped: they are most of the file, and at label sizes the difference is
hard to see. 16 KB instead of the 51 KB latin file Google serves for the same
weight, and it is the largest font on the page's critical path.

A glyph outside the set renders in the fallback cursive, so keep `.hand`
text within it, or regenerate with more characters. To regenerate (Python
`fonttools` and `brotli`), download the latin `woff2` from
`https://fonts.googleapis.com/css2?family=Caveat:wght@600` with a browser
User-Agent and run:

```sh
pyftsubset caveat-600-latin.woff2 \
  --text-file=chars.txt --layout-features=kern,liga \
  --flavor=woff2 --no-hinting --desubroutinize \
  --output-file=caveat-600-hand.woff2
```

Drop `--layout-features` to keep the alternates (39 KB).
