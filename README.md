Reproducers for the cost of parsing many positional arguments with Optique
==========================================================================

Three single-file scripts for [`@optique/core`], written in answer to the
maintainer's [request for a reproducer].  Each imports nothing but
*@optique/core*, checks its own result so that a broken run cannot look like a
fast one, and prints one JSON line.

[`@optique/core`]: https://github.com/dahlia/optique
[request for a reproducer]: https://github.com/Aquaticats/Monochromatic/commit/4879a44e6a2460ab3c2531744e24a1f2aef27aeb#commitcomment-209502949


What each script shows
----------------------

*mismatch-count.ts* counts how many mismatch diagnostics option parsers build
during one successful parse of positional tokens, using a function-valued
`errors.noMatch` as the reproduction in [issue 988] does.  The count involves no
timing.  On 1.3.6 it equals tokens times options (30,000 for the defaults); on
builds that include [pull request 997] it is zero.

*commit-paths.ts* times a parse of `--message x` followed by a thousand paths
through a parser with the option set of `git commit`, which is the parser this
project used.  With `--separator` it puts `--` before the paths.  That second
form is where the 1.4 pre-releases take longer than 1.3.6: every option probe
there builds a short-option scope, and no suggestion work is left to hide it.

*token-scaling.ts* parses 500 to 8,000 positional tokens through a parser with
one option and fits the exponent of time against token count, where 1 is linear
and 2 is quadratic.  It comes out near 2 on every version tried, 1.1.1 through
the 1.4 pre-releases, because the input trace copies its whole map for each
token it records.

[issue 988]: https://github.com/dahlia/optique/issues/988
[pull request 997]: https://github.com/dahlia/optique/pull/997


Running them
------------

With Node 23.6 or newer, or Bun, install a version beside the scripts:

~~~~ bash
npm install --no-save --save-exact @optique/core@1.3.6
node mismatch-count.ts
node commit-paths.ts --separator
node token-scaling.ts
~~~~

With Deno, point an import map at an npm version and install nothing:

~~~~ bash
deno run --import-map maps/npm-1.3.6.json commit-paths.ts --separator
~~~~

To measure a checkout of Optique, for example a branch, copy
*maps/src-checkout.json*, replace `/path/to/optique` in it with the checkout's
absolute path, and run the scripts with Deno and that map.  No build step is
needed.

Every script takes `--help`.


What the workflow asserts
-------------------------

*.github/workflows/reproduce.yaml* installs pinned versions, verifies each
tarball's SHA-256, runs the scripts on Node, and then asserts what one would
expect of a parser.  A job is red on its asserting step when the behaviour
reproduces:

 -  *Diagnostics for discarded mismatches*: a parse that succeeds builds no
    mismatch diagnostic.  Red on 1.3.6, green on `1.4.0-dev.2971`.
 -  *Parse time against token count*: the fitted exponent is below 1.5.  Red on
    both versions.
 -  *A thousand paths after `--`*: `1.4.0-dev.2971` takes less than 1.3 times as
    long as 1.3.6, over five alternating rounds.  Red.

The first assertion is a count and cannot flake.  The other two are ratios of
timings taken in the same job; on our own machine they were 1.75 to 1.97 for the
exponent and 1.5 to 2.1 for the ratio.


About these scripts
-------------------

The scripts and this text were written with AI assistance (Claude Code and
DeepSeek through Pi) and run on Node, Deno and Bun before being published.
