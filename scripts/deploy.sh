#!/bin/bash
set -euo pipefail

RELEASE_SHA="${1:?Release SHA is required}"

RELEASE_DIR="/opt/webapp/releases/${RELEASE_SHA}"
APP_DIR="${RELEASE_DIR}/app"
CURRENT_LINK="/opt/webapp/current"
SERVICE_NAME="webapp"
SERVICE_FILE="${RELEASE_DIR}/deploy/webapp.service"

echo "Deploying release: ${RELEASE_SHA}"

rm -rf "${RELEASE_DIR}"
mkdir -p "${RELEASE_DIR}"

tar -xzf "/tmp/webapp-${RELEASE_SHA}.tar.gz" -C "${RELEASE_DIR}"

chown -R webapp:webapp "${RELEASE_DIR}"

PREVIOUS_RELEASE=""

if [ -L "${CURRENT_LINK}" ]; then
    PREVIOUS_RELEASE=$(readlink "${CURRENT_LINK}")
fi

if [ ! -d "${APP_DIR}" ]; then
    echo "ERROR: ${APP_DIR} not found"
    exit 1
fi

if [ ! -f "${SERVICE_FILE}" ]; then
    echo "ERROR: ${SERVICE_FILE} not found"
    exit 1
fi

cp "${SERVICE_FILE}" "/etc/systemd/system/webapp.service"
chmod 644 "/etc/systemd/system/webapp.service"

ln -sfn "${APP_DIR}" "${CURRENT_LINK}"

systemctl daemon-reload
systemctl restart "${SERVICE_NAME}"

echo "Waiting for application health..."

for _ in $(seq 1 30); do
    if curl -fsS http://localhost:3000/health >/dev/null; then
        echo "Health check passed."
        exit 0
    fi

    sleep 1
done

echo "Health check failed. Rolling back..."

if [ -n "${PREVIOUS_RELEASE}" ] && [ -d "${PREVIOUS_RELEASE}" ]; then
    ln -sfn "${PREVIOUS_RELEASE}" "${CURRENT_LINK}"
    systemctl restart "${SERVICE_NAME}"
    echo "Rolled back to: ${PREVIOUS_RELEASE}"
else
    echo "No previous release available for rollback."
fi

exit 1