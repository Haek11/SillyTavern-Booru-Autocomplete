# Changelog

## 1.1.1

**Fixes**

- The suggestion list no longer pushes the prompt box around while you type. It now floats over the popup instead of taking up space inside it.
- The list shows up on top of the popup's blurred background instead of underneath it.
- The list and its "Related to" header have a solid background, so the popup's buttons no longer show through.
- Fixed a formatting error in `manifest.json` that could stop SillyTavern from loading the extension.

## 1.1.0

- Click a tag that's already in your prompt to see related tags, ranked by how often they appear together on Danbooru. This needs `related_tags.csv` from the [Releases page](https://github.com/Haek11/SillyTavern-Booru-Autocomplete/releases/latest).
- New "Max related tags" setting (10 to 100).

## 1.0.0

- First release: Danbooru tag autocomplete in the image generation "Review and edit the prompt" popup, custom snippets, and category colors.
