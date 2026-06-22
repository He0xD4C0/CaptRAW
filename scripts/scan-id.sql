\set old_id '''ansxgukcp9b6000k'''
\set new_id '''airj4tzdc4'''

\echo '=== Step 1: Scanning varchar/text columns ==='

DO $$
DECLARE
    r RECORD;
    cnt INTEGER;
    old_id TEXT := 'ansxgukcp9b6000k';
BEGIN
    FOR r IN
        SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
        WHERE c.table_schema = 'public'
          AND c.data_type IN ('character varying', 'text')
          AND t.table_type = 'BASE TABLE'
          AND c.table_name NOT LIKE 'migration%'
        ORDER BY c.table_name, c.column_name
    LOOP
        BEGIN
            EXECUTE format('SELECT count(*) FROM %I WHERE %I = %L', r.table_name, r.column_name, old_id) INTO cnt;
            IF cnt > 0 THEN
                RAISE NOTICE 'HIT: %.% -> % rows', r.table_name, r.column_name, cnt;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END LOOP;
END $$;

\echo '=== Step 2: Scanning array columns ==='

DO $$
DECLARE
    r RECORD;
    cnt INTEGER;
    old_id TEXT := 'ansxgukcp9b6000k';
BEGIN
    FOR r IN
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND udt_name LIKE '%[]'
          AND table_name NOT LIKE 'migration%'
        ORDER BY table_name
    LOOP
        BEGIN
            EXECUTE format('SELECT count(*) FROM %I WHERE %L = ANY(%I)', r.table_name, old_id, r.column_name) INTO cnt;
            IF cnt > 0 THEN
                RAISE NOTICE 'HIT (array): %.% -> % rows', r.table_name, r.column_name, cnt;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END LOOP;
END $$;

\echo '=== Step 3: Current user record ==='

SELECT id, username, host, "createdAt" FROM "user" WHERE username = 'He0xD4C0';

\echo '=== Scan complete ==='
