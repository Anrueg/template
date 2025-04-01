FROM geldata/gel:nightly

ENV GEL_SERVER_DATADIR="/data"
ENV GEL_SERVER_PORT="5656"

HEALTHCHECK --interval=1m --timeout=10s --start-period=20s --retries=5 CMD "curl -s http://localhost:5656/server/status/alive | grep -q 'OK' || exit 1"
