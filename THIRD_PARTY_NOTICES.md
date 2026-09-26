# Third-party notices

The extension code in this repository is original work (MIT, see `LICENSE`).
The tag data files are derived from third-party datasets, credited below.

## danbooru-tag-csv (newtextdoc1111)

- `danbooru_tags.csv` is taken from this dataset.
- `related_tags.csv` (Release download) is generated from its `danbooru_tags_cooccurrence.csv`
  by `tools/build_related.py` (top related tags per tag, as a percentage of the tag's post count).

Source: https://huggingface.co/datasets/newtextdoc1111/danbooru-tag-csv
Built from: [trojblue/danbooru2025-metadata](https://huggingface.co/datasets/trojblue/danbooru2025-metadata)
and [itterative/danbooru_wikis_full](https://huggingface.co/datasets/itterative/danbooru_wikis_full) (both MIT).
Tag names and counts originate from [Danbooru](https://danbooru.donmai.us/).

License: MIT, as declared on the dataset card. The copyright holder is the dataset author (newtextdoc1111).

```
MIT License

Copyright (c) newtextdoc1111

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Inspiration

The feature set (category colors, related-tags-on-click) follows
[ComfyUI-Autocomplete-Plus](https://github.com/newtextdoc1111/ComfyUI-Autocomplete-Plus) (MIT).
No code was copied from it.
