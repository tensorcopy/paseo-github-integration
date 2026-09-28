# paseo-github-integration

GitHub inside [Paseo](https://paseo.sh): the issues and pull requests you are attached to, the ones
waiting on your review, your Projects boards, and the review actions that finish a pull request —
without leaving the app, and with one click to hand any of them to a coding agent.

The board also links a pull request back to its original Paseo chat. It matches the PR tracked
by each active or retained workspace to the first agent created there, then adds an **Open original
chat** action to the PR row and detail panel.

Every authenticated host reported by `gh auth status --json hosts` is queried together. One board
can therefore show github.com and GitHub Enterprise work at the same time, using each host's active
account and keeping reads and actions routed to the host that owns the item. With more than one host
on the board, the list is divided into a section per host rather than interleaving them.

Opening the surface does not wait on GitHub: a board the daemon already has is painted immediately
and refreshed behind it, and the refreshed one replaces it as soon as the sweep lands. Every open,
and every return to the app, asks the daemon; the daemon sweeps GitHub again when its own board is
more than a minute old, so a pull request merged elsewhere leaves the list within seconds of the
board being opened. The header says how old the board on screen is.

![The GitHub surface: the Pull requests / Issues / Discussions / Projects switcher, the relation
chips with their counts, the owner and repository pickers, the search box, and the list of pull
requests.](images/board.png)

## What it does

**Sweeps everything you are attached to, not just what you wrote.** The server runs one GitHub
search per relationship — review requested, mentioned, assigned, authored — plus one per watched
owner, and unions the results. A pull request someone else opened and asked you to review is on the
board; so is everything open under an organisation you watch.

**Filters it back down on the client.** Each card carries every relationship it matched, so the
chips (`Needs my review`, `Mentions me`, `Assigned to me`, `Mine`, `Other`) narrow the list with no
new request. Owner and repository pickers narrow it further, and both filter their own list, so a
long list of repositories is typed at rather than scrolled.

**Search with sigils.** A plain word matches a title, a repository or a number. `/name` restricts to
repositories, `#123` to numbers, `@login` to authors, and several terms are ANDed: `@dependabot
/trunk` is "opened by dependabot, in a trunk repository". Separators are ignored on both sides, so
`checkout frontend` finds `owner/checkout-frontend`.

**Three orderings.** Recently updated, recently created, and last commit — the last one being the
date that answers "what has actually moved". Each card reports the date the list is sorted on.

**Read and act without leaving.** Opening a card shows the body, the comments and the checks
rendered from Markdown, with images proxied through the daemon. From there: approve, merge with any
method the repository allows, edit labels, open on GitHub — or **send to chat**, which starts a
Paseo agent with a prompt template of your choosing, in a workspace of your choosing, with the
issue or pull request pinned to the top of the conversation.

For pull requests associated with a Paseo workspace, **Open original chat** jumps directly to the
first agent in that workspace.

![One pull request open in the detail panel: title, author, branches, checks, the Approve, Merge,
Send to chat and Open on GitHub actions, and the rendered body.](images/detail-panel.png)

**Projects.** The Projects v2 boards you and your watched owners own, grouped by their Status
column. Projects need a scope `gh auth login` does not grant, so a token without it gets the
command to run and a button to copy it, rather than an error.

## Install

Requires Paseo **0.8.0 or newer** on the daemon *and* on the app, plus the
[`gh` CLI](https://cli.github.com/) authenticated on the daemon machine — the plugin shells out to
it and never handles a token itself.

```bash
paseo plugin add alysnnix/paseo-github-integration
```

Then enable plugins on the daemon (Settings → Plugins) if they are not already on, and open
**GitHub** in the sidebar.

For Projects:

```bash
gh auth refresh -h github.com -s read:project
```

### With Nix

The flake packages the plugin as a source-only derivation, which pairs with a `directory` plugin
source so the installed version is pinned by your lock file rather than a branch that moves:

```nix
inputs.paseo-github.url = "github:alysnnix/paseo-github-integration";
# services.paseo.settings.plugins.github-integration = {
#   source = "directory";
#   path = "${pkgs.paseo-github-integration}";
#   enabled = true;
# };
```

## Limitations

- **The `gh` CLI does the talking.** Every query is a `gh api graphql` subprocess on the daemon
  machine, so `gh` has to be installed and authenticated there. The plugin never handles a token
  itself and cannot log you in.
- **Projects needs a scope `gh auth login` does not grant.** Without `read:project` the Projects
  tab shows the command to run instead of your boards.
- **The board is a `state:open` search.** Closed issues and merged pull requests leave it; there is
  no archive view, and nothing here searches history.
- **GitHub search backs the sweep**, so its rules apply: results are capped per query, and a
  watched owner with thousands of open items shows the most recently updated slice rather than all
  of them.
- **One account per host**, the one `gh` is authenticated as there. Every authenticated host is
  swept together, but there is no account switcher within a host.
- **Images from hosts neither GitHub nor your `gh` logins know are not loaded**, deliberately:
  they would report your IP address to whoever wrote the comment. They render as a link you can
  open yourself.

## Trust

Plugin code is **trusted and unsandboxed**: the server half runs beside the daemon with your files,
processes and credentials, including whatever `gh` is logged in as, and the client half runs inside
the Paseo app. That is true of every Paseo plugin, this one included. Read the code before you
install it.

Releases are verifiable: every release tag is signed, the published tarball ships with
`SHA256SUMS`, and the artifact carries GitHub build provenance.

```bash
git verify-tag v1.0.1
sha256sum -c SHA256SUMS
gh attestation verify paseo-github-integration-1.0.1.tar.gz --repo alysnnix/paseo-github-integration
```

## Development

The repository *is* the plugin: its root holds `paseo-plugin.json` and the two runtime entries.

```bash
npm install
npm run typecheck
npm run lint
npm test
paseo plugin install "$PWD" --id github-integration-dev
paseo plugin reload github-integration-dev   # after every source change
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the module layout and the rules the linter enforces.

## Credits

This started as a fork of [gpambrozio/paseo-plugins](https://github.com/gpambrozio/paseo-plugins),
whose `github-board` plugin is the origin of this one and the source of much of the code that
remains. The fork has since diverged: the relation sweep, the filters and search, the orderings,
review and merge, the Projects tab, the cache rewrite and the module layout are this repository's,
and the other plugins that lived beside it there are not carried here. Thanks to Gustavo for the
starting point and for the MIT licence that made it possible.

Licensed under the MIT licence — see [LICENSE](LICENSE).
