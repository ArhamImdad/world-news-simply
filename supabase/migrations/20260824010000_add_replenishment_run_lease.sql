-- Database-backed ownership for autonomous replenishment runs. The lease is
-- private, expires automatically, and is checked in the enqueue transaction.

CREATE TABLE IF NOT EXISTS public.replenishment_run_leases (
  system_key text PRIMARY KEY,
  run_id uuid NOT NULL,
  acquired_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT replenishment_run_leases_expiry_check CHECK (expires_at > heartbeat_at)
);

CREATE TABLE IF NOT EXISTS public.article_replenishment_attribution (
  article_id uuid PRIMARY KEY REFERENCES public.articles(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  attributed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS article_replenishment_attribution_run_idx
  ON public.article_replenishment_attribution (run_id, attributed_at);

ALTER TABLE public.replenishment_run_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_replenishment_attribution ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.acquire_replenishment_run_lease(
  p_system_key text,
  p_run_id uuid,
  p_ttl_seconds integer DEFAULT 180
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  lease_acquired boolean := false;
  lease_now timestamptz := clock_timestamp();
  bounded_ttl integer := greatest(15, least(coalesce(p_ttl_seconds, 180), 900));
BEGIN
  IF nullif(btrim(p_system_key), '') IS NULL OR p_run_id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.replenishment_run_leases (
    system_key, run_id, acquired_at, heartbeat_at, expires_at
  ) VALUES (
    p_system_key, p_run_id, lease_now, lease_now, lease_now + make_interval(secs => bounded_ttl)
  )
  ON CONFLICT (system_key) DO UPDATE SET
    run_id = EXCLUDED.run_id,
    acquired_at = CASE
      WHEN replenishment_run_leases.run_id = EXCLUDED.run_id THEN replenishment_run_leases.acquired_at
      ELSE EXCLUDED.acquired_at
    END,
    heartbeat_at = EXCLUDED.heartbeat_at,
    expires_at = EXCLUDED.expires_at
  WHERE replenishment_run_leases.run_id = EXCLUDED.run_id
     OR replenishment_run_leases.expires_at <= lease_now
  RETURNING true INTO lease_acquired;

  RETURN coalesce(lease_acquired, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_replenishment_run_lease(
  p_system_key text,
  p_run_id uuid,
  p_ttl_seconds integer DEFAULT 180
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  renewed boolean := false;
  lease_now timestamptz := clock_timestamp();
  bounded_ttl integer := greatest(15, least(coalesce(p_ttl_seconds, 180), 900));
BEGIN
  UPDATE public.replenishment_run_leases
  SET heartbeat_at = lease_now,
      expires_at = lease_now + make_interval(secs => bounded_ttl)
  WHERE system_key = p_system_key
    AND run_id = p_run_id
    AND expires_at > lease_now
  RETURNING true INTO renewed;
  RETURN coalesce(renewed, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.owns_replenishment_run_lease(
  p_system_key text,
  p_run_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.replenishment_run_leases
    WHERE system_key = p_system_key
      AND run_id = p_run_id
      AND expires_at > clock_timestamp()
  );
$$;

CREATE OR REPLACE FUNCTION public.release_replenishment_run_lease(
  p_system_key text,
  p_run_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  released boolean := false;
BEGIN
  DELETE FROM public.replenishment_run_leases
  WHERE system_key = p_system_key AND run_id = p_run_id
  RETURNING true INTO released;
  RETURN coalesce(released, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_ready_article_owned(
  p_article jsonb,
  p_max_queue_depth integer,
  p_permitted_source_ids text[],
  p_system_key text,
  p_replenishment_run_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inserted_id uuid;
  lease_is_owned boolean := false;
BEGIN
  -- The row lock serializes enqueue with expiry takeover. The lease cannot be
  -- replaced between this ownership check and the article/attribution insert.
  SELECT run_id = p_replenishment_run_id AND expires_at > clock_timestamp()
  INTO lease_is_owned
  FROM public.replenishment_run_leases
  WHERE system_key = p_system_key
  FOR UPDATE;

  IF NOT coalesce(lease_is_owned, false) THEN
    RETURN NULL;
  END IF;

  inserted_id := public.enqueue_ready_article(
    p_article, p_max_queue_depth, p_permitted_source_ids
  );
  IF inserted_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.article_replenishment_attribution (article_id, run_id)
  VALUES (inserted_id, p_replenishment_run_id);
  RETURN inserted_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.article_replenishment_run_id(p_article_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT run_id
  FROM public.article_replenishment_attribution
  WHERE article_id = p_article_id;
$$;

REVOKE ALL ON TABLE public.replenishment_run_leases FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.article_replenishment_attribution FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acquire_replenishment_run_lease(text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_replenishment_run_lease(text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.owns_replenishment_run_lease(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_replenishment_run_lease(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_ready_article_owned(jsonb, integer, text[], text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.article_replenishment_run_id(uuid) FROM PUBLIC, anon, authenticated;

-- The legacy three-argument enqueue RPC would allow a pre-lease orphan to
-- bypass ownership checks. Keep it callable only from the owned wrapper.
REVOKE ALL ON FUNCTION public.enqueue_ready_article(jsonb, integer, text[]) FROM service_role;

GRANT EXECUTE ON FUNCTION public.acquire_replenishment_run_lease(text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_replenishment_run_lease(text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.owns_replenishment_run_lease(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_replenishment_run_lease(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_ready_article_owned(jsonb, integer, text[], text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.article_replenishment_run_id(uuid) TO service_role;

COMMENT ON TABLE public.replenishment_run_leases IS 'Private expiring ownership fence for autonomous replenishment.';
COMMENT ON TABLE public.article_replenishment_attribution IS 'Private run-level attribution for automatically prepared articles.';
