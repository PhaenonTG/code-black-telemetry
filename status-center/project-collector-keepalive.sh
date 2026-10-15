#!/bin/sh
# Existing cron / @reboot entry: recover even before a user manager is available.
set -eu
COMMAND='/usr/bin/python3 /srv/codeblack/services/project-collector/collector.py --host edge --registry /srv/codeblack/services/status-collector/registry.json'
pgrep -f "^$COMMAND\$" >/dev/null && exit 0
if systemctl --user start codeblack-project-collector.service >/dev/null 2>&1; then exit 0; fi
export CODEBLACK_PROJECT_CONFIG=/srv/codeblack/services/project-landscape/config
export CODEBLACK_PROJECT_STATE=/srv/codeblack/data/status-collector/project-inventory
nohup /usr/bin/python3 /srv/codeblack/services/project-collector/collector.py --host edge --registry /srv/codeblack/services/status-collector/registry.json >> /srv/codeblack/logs/status-collector.log 2>&1 </dev/null &
