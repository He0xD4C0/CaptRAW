#!/bin/bash
# SPDX-FileCopyrightText: syuilo and misskey-project
# SPDX-License-Identifier: AGPL-3.0-only
#
# PostgreSQL initialization script for CaptRAW.
# Runs only on first container start (when the data directory is empty).

set -e

echo "[init-db] Creating extensions..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS "pg_trgm";
    CREATE EXTENSION IF NOT EXISTS "unaccent";
EOSQL

echo "[init-db] Database initialized successfully."
