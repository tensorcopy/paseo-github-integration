# Changelog

Notable changes to this plugin.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Nothing here is published to a
registry: `paseo plugin add` follows a branch unless you pin `--ref <tag>`, so a version is a tag to
pin and a line to read before you move.

## [Unreleased]

### Added

- **Every authenticated GitHub host is now swept together.** The hosts `gh auth status` reports are
  all queried at once, each with its own account, so one board can show github.com and GitHub
  Enterprise work side by side. Reads and actions stay routed to the host that owns the item, and
  with more than one host on the board the list is divided into one section per host rather than
  interleaving them. An Enterprise repository's screenshots come through the daemon too, fetched
  with that host's own token; hosts neither GitHub nor your logins know are still never fetched.
- **Open the original chat from a pull request.** A pull request that a Paseo workspace tracks is
  linked to the first agent created in that workspace — the originating conversation — and a new
  action on the row and in the panel jumps straight to that chat.
- **The board is painted before GitHub answers.** A board the daemon already has is shown at once
  and refreshed behind it, and the header says how old the board on screen is.

### Fixed

- **The search limit is now spent per relation, not as one shared budget.** A full review queue
  used to take the whole list and push the viewer's own work off the board. Pull request checks
  are also asked for in batches of 100 ids, an expired login on one host no longer blanks the
  board for the hosts that are fine, and the board no longer runs minutes behind GitHub: the
  daemon re-sweeps once its board is more than a minute old, and a sweep in which a column failed
  is not remembered.

## [1.0.1] — 2026-09-12

### Changed

- Screenshots moved to `images/`, which is where plugin directories look for them, and the README
  gained a **Limitations** section: what the plugin needs (`gh` authenticated on the daemon, the
  `read:project` scope for Projects), what it deliberately does not do (load images hosted outside
  GitHub, search closed work), and where GitHub's own search caps apply.

## [1.0.0] — 2026-09-12

First release of this repository, and the first under the id `github-integration`. The versions
below it were released as `github-board`, one folder of the fork this started from; their entries
are kept because the code they describe is still here.

### Changed

- **The plugin is now its own repository, and its id is `github-integration`.** It used to be one
  folder of a fork carrying two other people's plugins, one of which only ran on macOS. The
  repository root is now the plugin root, so `paseo plugin add alysnnix/paseo-github-integration`
  needs no path suffix. Your saved login and launch defaults are read from the old
  `plugins/github-board/settings.json` when the new path has none, so the rename costs you nothing;
  the filters, watched owners and prompt templates live in Paseo's own settings store and were
  never affected. A Nix install must point at the new attribute and the new config key.
- **The two files that were the whole plugin are now feature modules.** `client/board.tsx` (5146
  lines) and `server/board.ts` (2410) became `client/{board,detail,launch,projects,settings,theme,
  lib}` and `server/{github,board,items,projects,cache}`, with nothing over 400 lines. Nothing a
  user sees changed.
- **One cache instead of nine.** The five module globals on the daemon and the four in the app are
  gone. The daemon has a single cache with a TTL per entry, single-flight so two clients asking at
  once cost one sweep, and persistence to disk so a plugin reload or a daemon restart no longer
  re-sweeps GitHub from scratch. The app uses the query cache Paseo already owns. Both mattered for
  the same reason: the surface unmounts on every workspace switch, and the old design spent GitHub
  rate limit re-answering questions it had just answered.
- **The GraphQL budget is now watched.** Every query asks GitHub what it cost and what is left, the
  cost is logged, and a sweep is refused with the reset time when the remaining budget falls below
  a floor, instead of failing with GitHub's own error at the worst moment.

### Security

An audit was run against this code before the repository was published; every finding below is
fixed here rather than shipped.

- **The GitHub token no longer touches the disk.** Memoising `gh auth token` in the persistent
  cache wrote the credential to `~/.local/state/paseo-github-integration/cache/github-token.json`
  at mode 0644, where `gh` itself keeps the same token at 0600. It is now held in memory for the
  life of the process and nowhere else.
- **Cache files are private.** Everything the daemon caches — the titles, bodies and comment
  threads of private issues and pull requests, and the absolute path of every project on the
  machine — was written world-readable. Files are now created 0600 inside a 0700 directory, and a
  file an older build left at 0644 is hardened on the first write.
- **The image proxy is pinned to attachments.** The allowlist bound the host but not the path, so
  a comment author could choose which `github.com` URL the daemon fetched with the user's token
  attached. `github.com` is now accepted only under `/user-attachments/`, and redirects are
  followed manually with the host re-checked before the credential travels another hop.
- **A comment can no longer crash the board.** The Markdown and HTML renderers recursed once per
  nesting level with no cap, so a body of 65,000 `>` characters — which anyone able to comment on
  a watched issue could write — overflowed the stack during render, with no error boundary to
  contain it. Nesting is capped at 20 levels and the remainder renders as plain text. Two regexes
  that backtracked quadratically on hostile input were rewritten to scan linearly.
- **Images hosted outside GitHub are no longer loaded automatically.** They reported the reader's
  IP address and user agent to whatever host the comment author picked, which is the exact reason
  GitHub proxies them through Camo. They render as a link you choose to open.
- **The watched-owner list is bounded** and each entry must look like a GitHub login, which also
  closes the search-qualifier smuggling that an arbitrary string allowed.

### Internal

- Tests (vitest) over the logic that is pure: search parsing, the orderings, prompt templates, the
  relation merge, and the cache. CI runs typecheck, lint, tests and the Nix build.
- The project's own rules are enforced by zero-dependency scripts rather than a linter plugin tree:
  lowercase kebab-case filenames, 400 code lines per file, no duplicated function bodies, the SDK
  import boundaries, and version agreement across `package.json`, `nix/plugin.nix` and this file.
- Releases are cut from a signed tag, with notes taken verbatim from this file, a `SHA256SUMS`
  beside the tarball, and GitHub build provenance to verify with `gh attestation verify`.

### Added

- **Approve and merge a pull request from its panel.** Until now every write the board
  offered was a label: a pull request you had already read here still had to be finished on
  GitHub. **Approve** submits an approving review, and reads **Approved** once your own
  latest review is one, or **Your pull request** on your own work, which GitHub refuses to
  let you approve. **Merge** opens the repository's allowed methods, one button each, and
  the press that picks is the press that merges, because there is nothing to confirm twice.
  A button nobody can press names its blocker instead: **Draft**, **Conflicts**, **No merge
  access**, or **Checking...** while GitHub computes the test merge. A merged pull request
  leaves the board with the merge, since the columns are a `state:open` search, and the open
  panel stays behind reading **Merged**.

- **The board now sweeps every pull request and issue you are attached to, not only the ones
  you wrote.** It searches review requests, mentions, assignments and authorship, and unions
  the results, so a pull request waiting on your review is on the board even though someone
  else opened it. Each card carries every relationship it matched, and a row of chips filters
  by one: **Needs my review**, **Mentions me**, **Assigned to me**, **Mine**, and **Other**,
  each with the count it would leave. The chips are scoped to what the list can mean, so
  **Needs my review** is offered on pull requests and nowhere else, and a choice the current
  list cannot honour falls back to **All** without being forgotten.
- **Watched owners.** Settings takes a list of users and organisations, and the board sweeps
  each one whole rather than waiting for something to name you. That is how a team's open work
  shows up on a board of your own.
- **One list at a time, with a switcher.** **Pull requests**, **Issues**, **Discussions** and
  **Projects** replace the four side-by-side columns, which never fit a narrow window. Drafts
  and open pull requests are one chronological list.
- **Projects.** The new tab lists the Projects v2 boards the login and the watched owners own,
  and opens one grouped by its Status column. Projects need a scope `gh auth login` does not
  grant, so a token without it gets the command to run and a button to copy it rather than an
  error.
- **Owner and repository filters, and a search box that reads sigils.** Both pickers filter
  their own list, so a long list of repositories is typed at rather than scrolled. In the
  search box a plain word still matches a title, a repository or a number, and three sigils
  narrow it: `/name` searches repositories, `#123` searches numbers, and `@login` searches
  authors. Words are combined, so `@dependabot /trunk` is "opened by dependabot, in a trunk
  repository". Separators are ignored on both sides, which is what was breaking before:
  `checkout frontend` and `octo-org/` both find `octo-org/checkout-frontend`, where a
  literal match found nothing unless the hyphens were typed exactly.
- **Three orderings, beside the filters.** The list was always newest-updated first, which a
  comment is enough to disturb. **Recently created** orders by the date the issue or pull
  request was opened, and **Last commit** by the head commit's date, which is the one that
  answers "what has actually moved". Each card's date follows the ordering — *opened*,
  *committed*, *updated* — so the order a list is in is readable from the rows themselves,
  and a pull request GitHub reports no commit for falls back to its update date and sorts
  last instead of to the top. **Last commit** is offered on pull requests only, since nothing
  else has commits, and the choice is remembered between sessions.

## [0.5.0] — 2026-09-08

### Added

- **An agent you start from a card now opens with the issue or pull request at the top of its
  conversation** — the repository and number, the title, who opened it, and its labels, as a card
  you can click to open the original on GitHub. Before this, the only trace of where the work came
  from was whatever your prompt template happened to mention, so a template that did not name the
  issue left the conversation with no way back to it. The card is saved with the conversation, so
  it is still there tomorrow, on your other devices, and after a restart. Agents you started before
  this release are unchanged.

## [0.4.0] — 2026-09-08

### Changed

- **Now requires Paseo 0.8.0 or newer**, on the computer running the daemon *and* on whatever you
  are looking at the board on. Paseo 0.8 changed how plugins are built, and this is the version
  that follows it. On an older Paseo the board reports itself as incompatible rather than half
  working.
- **Your prompt templates, your repository filter and the width of the detail panel are now kept by
  Paseo itself.** They were already saved; what is new is that a change on one device shows up on
  your others without a reload, and that the board no longer has to fetch them before it can draw.
  Your existing settings move across automatically the first time you open the board — you should
  not have to set anything up again. If you had already changed something on this version before
  the move happened, what you changed is kept.
- **The prompt and login settings also live under Settings → Plugins → GitHub board**, alongside
  everything else you configure in Paseo. The gear button on the board still opens the same
  editor; this is a second way in, not a replacement, and both show the same values.
- **The send dialog is now a proper sheet on a phone and a proper dialog on a desktop**, and the
  keyboard raises the message field instead of covering it. That last part never worked on Android
  before.
  - Tapping outside the dialog now closes it — but only if you have not edited the message. If you
    have, it stays put and points you at **Cancel**, so a stray tap cannot lose what you wrote.
- **Confirmations appear as brief messages rather than boxes you have to dismiss.** Creating a
  workspace no longer pops up a dialog while it is taking you to the new agent. Errors that need
  your attention — a board that would not load — still stay on screen.

### Removed

- **The fallback that opened a new chat by reloading the app.** Every Paseo that can run this
  version can be asked to navigate directly, so the reload is gone.

## [0.3.1] — 2026-09-03

### Fixed

- **Descriptions written in HTML now read the way they do on GitHub.** Dependabot's pull requests
  were the worst case: the panel showed the release notes as a wall of angle brackets. They now
  show as collapsible sections, closed by default like on GitHub, with the quoted changelog,
  headings, bullet lists, links and code inside them. The same goes for HTML anyone else pastes
  into a description or comment — line breaks, bold, links, images, quotes and tables.

## [0.3.0] — 2026-09-02

### Changed

- **Clicking a card opens it in a panel beside the board instead of in your browser.** The panel
  shows the title, who opened it, how many comments it has, its labels, whether it is still open
  or has since been closed or merged, who it is assigned to, and the full description, formatted
  the way GitHub shows it. A pull request also shows which branch it comes from and which it
  targets. **Open on GitHub** is in the panel next to **Send to chat**, so the browser is still one
  click away. The rest of the board dims and blurs while the panel is open; click it, or the
  close button, to go back.
- **The header buttons are icons now.** Refresh is an arrow, the prompt settings are a gear.

### Added

- **Load comments** at the bottom of the panel shows the conversation: the comments on an issue or
  pull request, or a discussion's comments with replies indented under them. The first 50 are
  shown, and the panel says if there are more.
- **Screenshots and other images** pasted into a description or a comment are shown in the panel,
  including on private repositories. Side-by-side image tables show as tables. Click an image to
  open the original.
- **The panel can be made wider or narrower** by dragging its left edge. The width you choose is
  kept, even after a restart, and scales with the window.
- **A refresh button in the panel** reloads the description and comments if they were edited on
  GitHub since you opened them.

## [0.2.0] — 2026-08-31

### Changed

- **Send to chat opens the new agent through the host, not a hand-built URL.** Paseo 0.7.0-beta.3
  ([getpaseo/paseo#3901](https://github.com/getpaseo/paseo/pull/3901)) gives plugin surfaces a
  `navigation` prop, so the board asks the app to open the agent instead of constructing the app's
  private route and forcing the client onto it. On web and the desktop renderer this removes a
  `history.pushState`, a synthesized `popstate`, a 600 ms settle timer and the full page reload that
  fired whenever the router ignored the push — the agent's tab now opens directly, keeping client
  state.
- `@getpaseo/plugin` and `@getpaseo/client` move to 0.7.0 together, as the former peer-depends on
  the exact version of the latter. The contracts are byte-identical to 0.7.0-beta.3, where the
  navigation prop landed, so 0.7.0-beta.3 remains the honest floor for it.

### Compatibility

- **The old route is still live, and the gate is the app's version rather than the daemon's.** The
  `navigation` prop is supplied client-side, so whether the board gets it depends on the app
  rendering the surface, and one daemon serves several. Measured against a single 0.7.0-beta.3
  daemon on 2026-08-31: desktop navigated through the new API while the phone, whose app ships on
  its own cadence, received no prop and took the deep link. Both paths reach the same screen, so
  there is nothing to configure — but do not read the fallback as dead code.
- Nothing else changes for hosts older than 0.7.0-beta.3, and the plugin's floor is still Paseo
  0.5.2 for `paseo.projects.list()`.

## [0.1.0]

Everything before the versions above: the board itself. Issues, pull requests and discussions in
four columns; issues folded into the pull requests that close them; CI status on open pull requests;
right-click label editing; per-column prompt templates; repository filtering; the two-layer cache in
front of `gh`; the phone and tablet layout; and **Send to chat**, which creates the workspace,
starts the agent and sends the first message. See the git history for how each arrived.
