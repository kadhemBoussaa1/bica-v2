#!/bin/sh
# Mounted into /docker-entrypoint.d/, which the nginx image runs before it
# starts nginx. nginx reads certificates only at (re)load, and the certbot
# service renews them in its own container, so without this loop a renewed
# certificate is never served and the site expires 90 days after --ssl-init.
( while :; do sleep 12h; nginx -s reload; done ) &
