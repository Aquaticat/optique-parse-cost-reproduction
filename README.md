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
Upstream tracks that as [issue 1120].

*token-scaling.ts* parses 500 to 8,000 positional tokens through a parser with
one option and fits the exponent of time against token count, where 1 is linear
and 2 is quadratic.  It came out between 1.56 and 1.92 in every run we have, on
1.3.6 and on `1.4.0-dev.2971`, because the input trace copies its whole map for
each token it records.

[issue 988]: https://github.com/dahlia/optique/issues/988
[pull request 997]: https://github.com/dahlia/optique/pull/997
[issue 1120]: https://github.com/dahlia/optique/issues/1120


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
deno run --no-config --import-map maps/npm-1.3.6.json commit-paths.ts --separator
~~~~

`--no-config` is needed because of the *package.json* beside the scripts:
without it Deno 2 looks for the package in *node\_modules* and stops with
"Could not find a matching package".

To measure a checkout of Optique, for example a branch, copy
*maps/src-checkout.json*, replace `/path/to/optique` in it with the checkout's
absolute path, and run the scripts with Deno, `--no-config` and that map.  No
build step is needed.

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
timings taken in the same job.  In the workflow's first two runs the exponent
was 1.70 on 1.3.6 and 1.56 on `1.4.0-dev.2971`, and the ratio 1.86.


Measured on three runtimes
--------------------------

On 2026-11-13 every script was run as this file says, in a two-CPU container
with no network, on Node 26.13.1, Deno 2.9.8 and Bun 1.4.4:

 -  *mismatch-count.ts* printed 30,000 on 1.3.6 and 0 on `1.4.0-dev.2971` on
    all three.
 -  *token-scaling.ts* fitted 1.85 and 1.75 on Node, 1.92 and 1.78 on Deno, and
    1.63 and 1.57 on Bun (1.3.6 first).
 -  *commit-paths.ts --separator*, five alternating rounds: `1.4.0-dev.2971`
    took 1.90 times as long as 1.3.6 on Node (1.80 to 2.11), 1.85 on Deno
    (1.77 to 2.00) and 2.61 on Bun (2.51 to 2.75).


About these scripts
-------------------

The scripts and this text were written with AI assistance (Claude Code and
DeepSeek through Pi).
