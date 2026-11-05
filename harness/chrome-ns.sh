#!/bin/sh
# Start Google Chrome inside the network namespace given in $NETNS.
# Playwright uses this file as the Chrome executable (see
# docs/plan/01-architecture.md §3.1). `exec` replaces the shell, so
# Chrome inherits Playwright's control pipe.
: "${NETNS:?NETNS must name a network namespace, e.g. NETNS=ns_a}"
exec ip netns exec "$NETNS" google-chrome --no-sandbox "$@"
