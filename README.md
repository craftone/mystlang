# mystlang README

mystlang is an extension for editing MyST markdown text in a Sphinx project.

## Features

- [x] ID Completion
- [x] Jump to Definition
- [x] Find All References
- [ ] Rename ID


### Assumptions
This extension does not fully parse documents as MyST Markdown but rather searches for specific keywords.

When using this extension, it operates under the following assumptions:

- An ID comprises characters from the sets `A-Z`, `a-z`, `0-9`, `-`, `:`, `+`, `,`, `.`, `@`.
- IDs are defined in one of the following formats:
  - `{#...id...}` for Section IDs.
  - `:name: ...id...` for Directive IDs.
  - ```` ```{figure-md} ...id... ```` for figure-md IDs within Backtick Fences.
  - `:::{figure-md} ...id...` for figure-md IDs within Colon Fences.
- References are indicated in either of the following ways:
  - `[...optional text...](...id...`
  - `` {numref}`...id...` ``

The scope of the search is limited to the Sphinx project containing the Markdown file being edited. The extension identifies the project's range by locating `conf.py`. The directory containing `conf.py` is considered the root of the project.

## Requirements

nothing

## Extension Settings

Not yet

## Known Issues

Not yet

## Release Notes

Users appreciate release notes as you update your extension.

### 0.0.1

Initial release

